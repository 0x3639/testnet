import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import { z } from "zod";
import { clearSessionCookie, login, logout, requireAuth, sessionTokenFromRequest, setSessionCookie, type AuthedRequest } from "./auth.js";
import { createAccount, resetAccountPassword } from "./accounts.js";
import { randomId } from "./crypto.js";
import { buildGenesis, buildNodeConfig, readiness, toPublicPillar } from "./genesis.js";
import { buildPillarPackage, buildSporkPackage } from "./packages.js";
import { probeSeedNode, validateSeedNodeIp } from "./seeders.js";
import { readState, updateState } from "./storage.js";
import { createWallet, toStoredWallet } from "./wallets.js";
import type { AppState, ManagedUser, NetworkSettings, PublishedArtifacts, PublishedArtifactsInfo, PublicNetworkSettings } from "../shared/types.js";

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_GENESIS_PATH = "/genesis.json";
const PUBLIC_CONFIG_PATH = "/config.json";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

const pillarSchema = z.object({
  pillarName: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, numbers, dots, underscores, or hyphens")
});

const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, numbers, dots, underscores, or hyphens");

const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(200);

const accountCreateSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(["user", "admin"]).default("user")
});

const accountPasswordSchema = z.object({
  password: passwordSchema
});

const settingsSchema = z.object({
  chainIdentifier: z.number().int().positive(),
  extraData: z.string().min(1).max(240),
  expectedPillars: z.number().int().min(1).max(100),
  minPillars: z.number().int().min(1).max(100),
  genesisTimestampSec: z.number().int().positive(),
  seeders: z.array(z.string().trim().min(1)).max(100),
  sporks: z.array(
    z.object({
      id: z.string().regex(/^[0-9a-fA-F]{64}$/),
      name: z.string().min(1).max(80),
      description: z.string().max(400),
      activated: z.boolean(),
      enforcementHeight: z.number().int().min(0)
    })
  )
});

const seedNodeProbeSchema = z.object({
  ip: z.string().trim().refine(validateSeedNodeIp, "Seed node must be an IP address"),
  rpcPort: z.number().int().min(1).max(65535).default(35997),
  p2pPort: z.number().int().min(1).max(65535).default(35995)
});

function publicSettings(settings: NetworkSettings): PublicNetworkSettings {
  const { sporkWallet, ...rest } = settings;
  return {
    ...rest,
    sporkWalletAddress: sporkWallet?.address
  };
}

function managedUsers(state: AppState): ManagedUser[] {
  return state.users
    .map((user) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      pillarName: state.pillars.find((pillar) => pillar.userId === user.id)?.pillarName
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

async function ensureSporkWallet(): Promise<void> {
  await updateState(async (state) => {
    if (state.settings.sporkWallet && state.settings.sporkAddress) return;
    const wallet = await createWallet();
    state.settings.sporkWallet = toStoredWallet(wallet);
    state.settings.sporkAddress = wallet.address;
  });
}

async function createPillar(userId: string, pillarName: string) {
  const [pillarWallet, rewardWallet, producerWallet] = await Promise.all([createWallet(), createWallet(), createWallet()]);
  return updateState((state) => {
    if (state.pillars.some((pillar) => pillar.userId === userId)) {
      throw new Error("This account already has a pillar registration");
    }
    if (state.pillars.some((pillar) => pillar.pillarName.toLowerCase() === pillarName.toLowerCase())) {
      throw new Error("Pillar name is already registered");
    }

    const record = {
      id: randomId(),
      userId,
      pillarName,
      pillarWallet: toStoredWallet(pillarWallet),
      rewardWallet: toStoredWallet(rewardWallet),
      producerWallet: toStoredWallet(producerWallet),
      producerIndex: 0,
      createdAt: new Date().toISOString()
    };
    state.pillars.push(record);
    state.finalizedGenesis = undefined;
    return record;
  });
}

function sendDownload(response: express.Response, filename: string, contentType: string, body: Buffer | string): void {
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  response.send(body);
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sendJsonFile(response: express.Response, value: unknown): void {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.send(prettyJson(value));
}

function publishedInfo(published?: PublishedArtifacts): PublishedArtifactsInfo | undefined {
  if (!published) return undefined;
  return {
    publishedAt: published.publishedAt,
    genesisPath: PUBLIC_GENESIS_PATH,
    configPath: PUBLIC_CONFIG_PATH,
    chainIdentifier: published.chainIdentifier,
    seeders: published.seeders
  };
}

async function main() {
  await ensureSporkWallet();

  const app = express();
  app.disable("x-powered-by");
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get(PUBLIC_GENESIS_PATH, async (_request, response) => {
    const state = await readState();
    if (!state.publishedArtifacts) {
      response.status(404).json({ error: "genesis.json has not been published" });
      return;
    }
    sendJsonFile(response, state.publishedArtifacts.genesis);
  });

  app.get(PUBLIC_CONFIG_PATH, async (_request, response) => {
    const state = await readState();
    if (!state.publishedArtifacts) {
      response.status(404).json({ error: "config.json has not been published" });
      return;
    }
    sendJsonFile(response, state.publishedArtifacts.config);
  });

  app.post("/api/auth/login", async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid login" });
      return;
    }

    const result = await login(parsed.data.username, parsed.data.password);
    if (!result) {
      response.status(401).json({ error: "Invalid username or password" });
      return;
    }

    setSessionCookie(response, result.token);
    response.json({ user: result.user });
  });

  app.post("/api/auth/logout", async (request, response) => {
    await logout(sessionTokenFromRequest(request));
    clearSessionCookie(response);
    response.json({ ok: true });
  });

  app.get("/api/me", requireAuth(), async (request, response) => {
    const user = (request as AuthedRequest).user;
    const state = await readState();
    const pillar = state.pillars.find((candidate) => candidate.userId === user.id);
    response.json({ user, pillar: pillar ? toPublicPillar(pillar) : undefined });
  });

  app.post("/api/pillar", requireAuth(), async (request, response) => {
    const user = (request as AuthedRequest).user;
    const parsed = pillarSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid pillar name" });
      return;
    }

    try {
      const pillar = await createPillar(user.id, parsed.data.pillarName);
      response.status(201).json({ pillar: toPublicPillar(pillar) });
    } catch (error: unknown) {
      response.status(409).json({ error: (error as Error).message });
    }
  });

  app.get("/api/pillar/package", requireAuth(), async (request, response) => {
    const user = (request as AuthedRequest).user;
    const state = await readState();
    const pillar = state.pillars.find((candidate) => candidate.userId === user.id);
    if (!pillar) {
      response.status(404).json({ error: "No pillar registered" });
      return;
    }

    const body = await buildPillarPackage(state.settings, pillar);
    await updateState((draft) => {
      const target = draft.pillars.find((candidate) => candidate.id === pillar.id);
      if (target) target.packageDownloadedAt = new Date().toISOString();
    });
    sendDownload(response, `${pillar.pillarName}-pillar-package.zip`, "application/zip", body);
  });

  app.get("/api/admin/overview", requireAuth("admin"), async (request, response) => {
    const user = (request as AuthedRequest).user;
    const state = await readState();
    response.json({
      user,
      settings: publicSettings(state.settings),
      users: managedUsers(state),
      pillars: state.pillars.map(toPublicPillar),
      readiness: readiness(state),
      genesis: state.finalizedGenesis?.genesis ?? buildGenesis(state.settings, state.pillars),
      configTemplate: buildNodeConfig(state.settings),
      finalizedAt: state.finalizedGenesis?.finalizedAt,
      published: publishedInfo(state.publishedArtifacts)
    });
  });

  app.put("/api/admin/settings", requireAuth("admin"), async (request, response) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" });
      return;
    }

    const settings = await updateState((state) => {
      state.settings = {
        ...state.settings,
        ...parsed.data,
        minPillars: Math.min(parsed.data.minPillars, parsed.data.expectedPillars)
      };
      state.finalizedGenesis = undefined;
      return publicSettings(state.settings);
    });
    response.json({ settings });
  });

  app.post("/api/admin/users", requireAuth("admin"), async (request, response) => {
    const parsed = accountCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid user" });
      return;
    }

    try {
      const { user } = await createAccount(parsed.data.username, parsed.data.role, parsed.data.password);
      const state = await readState();
      response.status(201).json({ user: managedUsers(state).find((candidate) => candidate.id === user.id) });
    } catch (error: unknown) {
      response.status(409).json({ error: (error as Error).message });
    }
  });

  app.put("/api/admin/users/:userId/password", requireAuth("admin"), async (request, response) => {
    const parsed = accountPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid password" });
      return;
    }

    const admin = (request as AuthedRequest).user;
    const userId = String(request.params.userId);
    try {
      await resetAccountPassword(userId, parsed.data.password, admin.id);
      const state = await readState();
      response.json({ user: managedUsers(state).find((candidate) => candidate.id === userId) });
    } catch (error: unknown) {
      response.status(404).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/admin/users/:userId", requireAuth("admin"), async (request, response) => {
    const admin = (request as AuthedRequest).user;
    const userId = String(request.params.userId);
    if (userId === admin.id) {
      response.status(400).json({ error: "You cannot delete your own admin account" });
      return;
    }

    try {
      const result = await updateState((state) => {
        const user = state.users.find((candidate) => candidate.id === userId);
        if (!user) throw new Error("User not found");

        const adminCount = state.users.filter((candidate) => candidate.role === "admin").length;
        if (user.role === "admin" && adminCount <= 1) {
          throw new Error("At least one admin account is required");
        }

        const hadPillar = state.pillars.some((pillar) => pillar.userId === user.id);
        state.users = state.users.filter((candidate) => candidate.id !== user.id);
        state.sessions = state.sessions.filter((session) => session.userId !== user.id);
        state.pillars = state.pillars.filter((pillar) => pillar.userId !== user.id);
        if (hadPillar) state.finalizedGenesis = undefined;

        return { deletedUserId: user.id, deletedPillar: hadPillar };
      });
      response.json(result);
    } catch (error: unknown) {
      response.status(404).json({ error: (error as Error).message });
    }
  });

  app.delete("/api/admin/pillars/:pillarId", requireAuth("admin"), async (request, response) => {
    const pillarId = String(request.params.pillarId);
    try {
      const pillar = await updateState((state) => {
        const index = state.pillars.findIndex((candidate) => candidate.id === pillarId);
        if (index < 0) throw new Error("Pillar not found");

        const [deleted] = state.pillars.splice(index, 1);
        state.finalizedGenesis = undefined;
        return toPublicPillar(deleted);
      });
      response.json({ pillar });
    } catch (error: unknown) {
      response.status(404).json({ error: (error as Error).message });
    }
  });

  app.post("/api/admin/seeders/probe", requireAuth("admin"), async (request, response) => {
    const parsed = seedNodeProbeSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid seed node" });
      return;
    }

    try {
      const seed = await probeSeedNode(parsed.data);
      const settings = await updateState((state) => {
        state.settings.seeders = Array.from(new Set([...state.settings.seeders, seed.enode]));
        return publicSettings(state.settings);
      });
      response.json({ seed, settings });
    } catch (error: unknown) {
      response.status(502).json({ error: (error as Error).message });
    }
  });

  app.post("/api/admin/finalize", requireAuth("admin"), async (_request, response) => {
    const result = await updateState((state) => {
      const genesis = buildGenesis(state.settings, state.pillars);
      state.finalizedGenesis = {
        genesis,
        finalizedAt: new Date().toISOString()
      };
      return state.finalizedGenesis;
    });
    response.json(result);
  });

  app.post("/api/admin/publish", requireAuth("admin"), async (_request, response) => {
    const result = await updateState((state) => {
      const genesis = state.finalizedGenesis?.genesis ?? buildGenesis(state.settings, state.pillars);
      const now = new Date().toISOString();
      if (!state.finalizedGenesis) {
        state.finalizedGenesis = {
          finalizedAt: now,
          genesis
        };
      }

      state.publishedArtifacts = {
        publishedAt: now,
        genesis,
        config: buildNodeConfig(state.settings),
        chainIdentifier: state.settings.chainIdentifier,
        seeders: [...state.settings.seeders]
      };
      return state.publishedArtifacts;
    });
    response.json({ published: publishedInfo(result) });
  });

  app.get("/api/admin/genesis.json", requireAuth("admin"), async (_request, response) => {
    const state = await readState();
    sendDownload(response, "genesis.json", "application/json", prettyJson(state.finalizedGenesis?.genesis ?? buildGenesis(state.settings, state.pillars)));
  });

  app.get("/api/admin/config-template.json", requireAuth("admin"), async (_request, response) => {
    const state = await readState();
    sendDownload(response, "config-template.json", "application/json", prettyJson(buildNodeConfig(state.settings)));
  });

  app.get("/api/admin/spork-package.zip", requireAuth("admin"), async (_request, response) => {
    const state = await readState();
    const body = await buildSporkPackage(state.settings);
    sendDownload(response, "spork-wallet-package.zip", "application/zip", body);
  });

  const webDir = path.join(process.cwd(), "dist", "web");
  app.use(express.static(webDir));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(webDir, "index.html"));
  });

  app.listen(PORT, () => {
    console.log(`Zenon testnet builder API listening on ${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
