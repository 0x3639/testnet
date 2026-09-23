import cookieParser from "cookie-parser";
import express from "express";
import { createECDH } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { clearSessionCookie, login, logout, requireAuth, sessionTokenFromRequest, setSessionCookie, type AuthedRequest } from "./auth.js";
import { createAccount, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, resetAccountPassword } from "./accounts.js";
import { decryptText, encryptText, randomId, sha256 } from "./crypto.js";
import { buildGenesis, buildNodeConfig, finalizeBlockers, readiness, toPublicPillar } from "./genesis.js";
import { buildPillarPackage, buildSeedNodePackage, buildSporkPackage } from "./packages.js";
import { enodeFromPublicKey, multiaddrFromEnode, multiaddrFromPublicKey } from "./libp2p.js";
import { bootstrapInstallScript } from "./bootstrap-script.js";
import { resolveGitRef } from "./git-refs.js";
import { duplicateSporkIds, genesisSettingsKey, publishInputsKey, settingsSnapshot } from "./settings.js";
import { AttemptLimiter } from "./rate-limit.js";
import { checkCommit, checkGitRef, checkRepoUrl, loadRepoPolicy, redactUrl, releasePolicyErrors } from "./repo-policy.js";
import { isPublicIp, probeSeedNode, validateSeedNodeIp } from "./seeders.js";
import { DEFAULT_DEPLOYMENT_REPO, DEFAULT_GO_ZENON_REPO, readState, updateState } from "./storage.js";
import { createWallet, toStoredWallet } from "./wallets.js";
import type {
  AppState,
  ManagedUser,
  NetworkSettings,
  NetworkSettingsSnapshot,
  NodeStatusReport,
  PillarNodeStatus,
  PillarRecord,
  PublishedArtifacts,
  PublishedArtifactsInfo,
  PublicNetworkSettings,
  PublicStats,
  SeedNodeRecord
} from "../shared/types.js";

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_GENESIS_PATH = "/genesis.json";
const PUBLIC_CONFIG_PATH = "/config.json";
const PUBLIC_NODE_PLAN_PATH = "/node-plan.json";
const NODE_STATUS_HISTORY_LIMIT = 24 * 60;
// Nodes report once a minute. Samples that arrive faster than this only refresh `latest`, so a
// misbehaving token holder cannot grow the on-disk history faster than a well-behaved agent.
const NODE_STATUS_HISTORY_MIN_INTERVAL_MS = 50_000;
// Optional fixed public origin (e.g. https://testnet.example.com) used in generated scripts and
// manifests instead of trusting Host / X-Forwarded-* request headers.
const PUBLIC_URL = normalizePublicUrl(process.env.PUBLIC_URL);
// Which upstream proxies may set X-Forwarded-* (express "trust proxy" setting). Defaults to
// loopback only; the compose stacks set TRUST_PROXY=uniquelocal because their Caddy reaches the app
// over a private Docker network. Anything in the trusted range can forge forwarded addresses, so
// keep it as narrow as the deployment allows.
const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);

// Which repositories operator nodes may be told to clone and execute as root.
const REPO_POLICY = loadRepoPolicy(process.env, [DEFAULT_GO_ZENON_REPO, DEFAULT_DEPLOYMENT_REPO]);

// Login attempts are counted per (account, client address) so a remote guesser cannot lock the
// real admin out from another address, plus a looser per-address cap and a bound on how many
// password checks may run at once (each one is a deliberately expensive scrypt).
const LOGIN_WINDOW_MS = 15 * 60_000;
const loginLimiterByAccountAndAddress = new AttemptLimiter({ maxAttempts: 10, windowMs: LOGIN_WINDOW_MS });
const loginLimiterByAddress = new AttemptLimiter({ maxAttempts: 50, windowMs: LOGIN_WINDOW_MS });
const MAX_CONCURRENT_LOGINS = 8;
let loginsInFlight = 0;

const loginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH)
});

// Values that end up as arguments to `git clone` and the deployment script on operator nodes.
const repoUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .superRefine((value, context) => {
    const check = checkRepoUrl(value, REPO_POLICY);
    if (!check.ok) context.addIssue({ code: z.ZodIssueCode.custom, message: check.reason });
  });
const gitRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .superRefine((value, context) => {
    const check = checkGitRef(value);
    if (!check.ok) context.addIssue({ code: z.ZodIssueCode.custom, message: check.reason });
  });
const gitCommitSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .superRefine((value, context) => {
    const check = checkCommit(value);
    if (!check.ok) context.addIssue({ code: z.ZodIssueCode.custom, message: check.reason });
  });
const optionalCommitSchema = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((value) => value || undefined)
  .pipe(gitCommitSchema.optional());

const nodeNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, numbers, dots, underscores, or hyphens");

const nodeRegistrationSchema = z.discriminatedUnion("nodeType", [
  z.object({
    nodeType: z.literal("pillar"),
    pillarName: nodeNameSchema
  }),
  z.object({
    nodeType: z.literal("seed"),
    nodeName: nodeNameSchema,
    publicIp: z.string().trim().refine(validateSeedNodeIp, "Seed node public IP must be an IP address"),
    p2pPort: z.number().int().min(1).max(65535).default(35995)
  })
]);

const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, numbers, dots, underscores, or hyphens");

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH);

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
  releaseApplyAtSec: z.number().int().positive().optional(),
  goZenonRepo: repoUrlSchema,
  goZenonRef: gitRefSchema,
  goZenonCommit: optionalCommitSchema,
  deploymentRepo: repoUrlSchema,
  deploymentRef: gitRefSchema,
  deploymentCommit: optionalCommitSchema,
  wipeDataOnPublish: z.boolean().default(false),
  seeders: z.array(z.string().trim().min(1)).max(100),
  bootstrapPeers: z.array(z.string().trim().min(1)).max(100).optional(),
  sporks: z
    .array(
      z.object({
        id: z.string().regex(/^[0-9a-fA-F]{64}$/),
        name: z.string().min(1).max(80),
        description: z.string().max(400),
        activated: z.boolean(),
        enforcementHeight: z.number().int().min(0)
      })
    )
    .refine((sporks) => duplicateSporkIds(sporks).length === 0, {
      message: "Spork IDs must be unique; go-zenon stores sporks by ID, so a duplicate would overwrite the other record"
    }),
  genesisFunds: z
    .array(
      z.object({
        address: z.string().trim().regex(/^z1[0-9a-z]{38}$/, "Address must be a z1... Zenon address"),
        znn: z.number().int().min(0),
        qsr: z.number().int().min(0),
        fusedQsr: z.number().int().min(0)
      })
    )
    .max(100)
    .optional()
});

const seedNodeProbeSchema = z.object({
  ip: z
    .string()
    .trim()
    .refine(validateSeedNodeIp, "Seed node must be an IP address")
    .refine(isPublicIp, "Seed node must have a public IP address; loopback, private, and link-local addresses cannot be probed"),
  rpcPort: z.number().int().min(1).max(65535).default(35997),
  p2pPort: z.number().int().min(1).max(65535).default(35995)
});

const adminSeedNodeCreateSchema = z.object({
  userId: z.string().min(1),
  nodeName: nodeNameSchema,
  publicIp: z.string().trim().refine(validateSeedNodeIp, "Seed node public IP must be an IP address"),
  p2pPort: z.number().int().min(1).max(65535).default(35995)
});

const optionalShortText = z.string().trim().max(256).optional();
const optionalNullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value ?? undefined);
const optionalNullableInt = (schema: z.ZodNumber) => schema.nullish().transform((value) => value ?? undefined);

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

const nodeStatusReportSchema = z.object({
  eventId: z.string().trim().max(120).optional(),
  reportedAt: z.string().trim().max(80).optional(),
  node: z
    .object({
      hostname: optionalShortText,
      serviceActive: z.boolean().optional(),
      waitingForRelease: z.boolean().optional(),
      installedRepo: optionalNullableText(300),
      installedRef: optionalNullableText(256),
      installedCommit: optionalNullableText(256),
      genesisSha256: optionalNullableText(256),
      configSha256: optionalNullableText(256),
      lastError: optionalNullableText(512)
    })
    .optional(),
  sync: z
    .object({
      state: optionalNullableInt(z.number().int().min(0).max(10)),
      currentHeight: optionalNullableInt(z.number().int().min(0)),
      targetHeight: optionalNullableInt(z.number().int().min(0))
    })
    .optional(),
  network: z
    .object({
      peerCount: optionalNullableInt(z.number().int().min(0).max(10000)),
      selfPublicKey: optionalNullableText(256),
      selfIp: optionalNullableText(128),
      peers: z
        .array(
          z.object({
            publicKey: optionalNullableText(256),
            ip: optionalNullableText(128),
            name: optionalNullableText(128),
            version: optionalNullableText(128)
          })
        )
        .max(100)
        .optional()
    })
    .optional(),
  process: z
    .object({
      version: optionalNullableText(128),
      commit: optionalNullableText(128)
    })
    .optional(),
  logs: z
    .object({
      errorCountLastMinute: z.number().int().min(0).max(10000).optional(),
      warningCountLastMinute: z.number().int().min(0).max(10000).optional(),
      recent: z.array(z.string().max(500)).max(20).optional()
    })
    .optional()
});

function publicSettings(settings: NetworkSettings): PublicNetworkSettings {
  const { sporkWallet, ...rest } = settings;
  return {
    ...rest,
    sporkWalletAddress: sporkWallet?.address
  };
}

function publicSeedNode(record: SeedNodeRecord) {
  return {
    id: record.id,
    userId: record.userId,
    nodeName: record.nodeName,
    publicIp: record.publicIp,
    p2pPort: record.p2pPort,
    publicKey: record.publicKey,
    enode: record.enode,
    multiaddr: record.multiaddr,
    createdAt: record.createdAt,
    packageDownloadedAt: record.packageDownloadedAt,
    nodeStatus: record.nodeStatus
      ? {
          latest: record.nodeStatus.latest,
          historyCount: record.nodeStatus.history.length
        }
      : undefined
  };
}

function createNetworkKey() {
  const ecdh = createECDH("secp256k1");
  ecdh.generateKeys();
  const privateKey = ecdh.getPrivateKey("hex").padStart(64, "0");
  const publicKey = ecdh.getPublicKey("hex", "uncompressed").slice(2);
  return { privateKey, publicKey };
}

type BootstrapNode =
  | {
      nodeType: "pillar";
      pillar: PillarRecord;
    }
  | {
      nodeType: "seed";
      seedNode: SeedNodeRecord;
    };

function managedUsers(state: AppState): ManagedUser[] {
  return state.users
    .map((user) => {
      const pillar = state.pillars.find((candidate) => candidate.userId === user.id);
      const seedNode = state.seedNodes.find((candidate) => candidate.userId === user.id);
      const nodeType: ManagedUser["nodeType"] = pillar ? "pillar" : seedNode ? "seed" : undefined;
      return {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        pillarName: pillar?.pillarName,
        nodeName: pillar?.pillarName ?? seedNode?.nodeName,
        nodeType
      };
    })
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

function createStatusTokenFields(): { statusTokenHash: string; statusTokenCipher: string } {
  const token = randomId(32);
  return {
    statusTokenHash: sha256(token),
    statusTokenCipher: encryptText(token)
  };
}

function ensureStatusToken(record: { statusTokenHash?: string; statusTokenCipher?: string }): void {
  if (record.statusTokenHash && record.statusTokenCipher) return;
  Object.assign(record, createStatusTokenFields());
}

async function ensurePillarStatusTokens(): Promise<void> {
  await updateState((state) => {
    for (const pillar of state.pillars) {
      ensureStatusToken(pillar);
    }
    for (const seedNode of state.seedNodes) {
      ensureStatusToken(seedNode);
    }
  });
}

async function createPillar(userId: string, pillarName: string) {
  const [pillarWallet, rewardWallet, producerWallet] = await Promise.all([createWallet(), createWallet(), createWallet()]);
  return updateState((state) => {
    if (state.pillars.some((pillar) => pillar.userId === userId)) {
      throw new Error("This account already has a pillar registration");
    }
    if (state.seedNodes.some((seedNode) => seedNode.userId === userId)) {
      throw new Error("This account already has a seed node registration");
    }
    if (state.pillars.some((pillar) => pillar.pillarName.toLowerCase() === pillarName.toLowerCase())) {
      throw new Error("Pillar name is already registered");
    }
    if (state.seedNodes.some((seedNode) => seedNode.nodeName.toLowerCase() === pillarName.toLowerCase())) {
      throw new Error("Node name is already registered");
    }

    const record = {
      id: randomId(),
      userId,
      pillarName,
      pillarWallet: toStoredWallet(pillarWallet),
      rewardWallet: toStoredWallet(rewardWallet),
      producerWallet: toStoredWallet(producerWallet),
      producerIndex: 0,
      ...createStatusTokenFields(),
      createdAt: new Date().toISOString()
    };
    state.pillars.push(record);
    state.finalizedGenesis = undefined;
    return record;
  });
}

async function createSeedNode(userId: string, nodeName: string, publicIp: string, p2pPort: number) {
  const { privateKey, publicKey } = createNetworkKey();
  const enode = enodeFromPublicKey(publicIp, p2pPort, publicKey);
  const multiaddr = multiaddrFromPublicKey(publicIp, p2pPort, publicKey);

  return updateState((state) => {
    const user = state.users.find((candidate) => candidate.id === userId);
    if (!user) {
      throw new Error("User not found");
    }
    if (user.role !== "user") {
      throw new Error("Seed nodes must be assigned to an operator user");
    }
    if (state.pillars.some((pillar) => pillar.userId === userId)) {
      throw new Error("This account already has a pillar registration");
    }
    if (state.seedNodes.some((seedNode) => seedNode.userId === userId)) {
      throw new Error("This account already has a seed node registration");
    }
    if (state.pillars.some((pillar) => pillar.pillarName.toLowerCase() === nodeName.toLowerCase())) {
      throw new Error("Node name is already registered");
    }
    if (state.seedNodes.some((seedNode) => seedNode.nodeName.toLowerCase() === nodeName.toLowerCase())) {
      throw new Error("Seed node name is already registered");
    }

    const record: SeedNodeRecord = {
      id: randomId(),
      userId,
      nodeName,
      publicIp,
      p2pPort,
      publicKey,
      enode,
      multiaddr,
      networkPrivateKeyCipher: encryptText(privateKey),
      ...createStatusTokenFields(),
      createdAt: new Date().toISOString()
    };
    state.seedNodes.push(record);
    state.settings.seeders = Array.from(new Set([...state.settings.seeders, enode]));
    state.settings.bootstrapPeers = Array.from(new Set([...(state.settings.bootstrapPeers ?? []), multiaddr]));
    return record;
  });
}

function sendDownload(response: express.Response, filename: string, contentType: string, body: Buffer | string): void {
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  response.setHeader("Cache-Control", "private, no-store");
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
    nodePlanPath: published.nodePlan ? PUBLIC_NODE_PLAN_PATH : undefined,
    chainIdentifier: published.chainIdentifier,
    seeders: published.seeders,
    bootstrapPeers: published.bootstrapPeers ?? [],
    genesisStartAt: published.nodePlan?.genesisStartAt,
    release: published.nodePlan
      ? {
          goZenon: published.nodePlan.goZenon,
          deployment: published.nodePlan.deployment
        }
      : undefined,
    actions: published.nodePlan?.actions
  };
}


function normalizePublicUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`PUBLIC_URL is not a valid URL: ${trimmed}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("PUBLIC_URL must use http or https");
  return url.origin;
}

function parseTrustProxy(value: string | undefined): boolean | string | number {
  const trimmed = value?.trim();
  if (!trimmed) return "loopback";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

// Host header values are interpolated into generated shell scripts, so only accept the characters
// a hostname, IPv6 literal, or port can contain.
const HOST_HEADER_PATTERN = /^[A-Za-z0-9.\-\[\]:]{1,253}$/;

function requestOrigin(request: express.Request): string {
  if (PUBLIC_URL) return PUBLIC_URL;
  // Express compiles "trust proxy" into a per-peer predicate; only honor X-Forwarded-Host when the
  // immediate peer is a trusted proxy, exactly as request.protocol does for X-Forwarded-Proto.
  const trustProxy = request.app.get("trust proxy fn") as ((address: string | undefined, hop: number) => boolean) | undefined;
  const peerTrusted = Boolean(trustProxy?.(request.socket.remoteAddress, 0));
  const proto = request.protocol === "https" ? "https" : "http";
  const forwardedHost = peerTrusted ? request.get("x-forwarded-host")?.split(",")[0]?.trim() : undefined;
  const host = forwardedHost || request.get("host") || "";
  if (!HOST_HEADER_PATTERN.test(host)) return `http://127.0.0.1:${PORT}`;
  return `${proto}://${host}`;
}

function statusToken(record: { statusTokenCipher?: string }): string {
  return record.statusTokenCipher ? decryptText(record.statusTokenCipher) : "";
}

function producerPassword(pillar: PillarRecord): string {
  return decryptText(pillar.producerWallet.passwordCipher);
}

function bearerToken(request: express.Request): string | undefined {
  const header = request.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return undefined;
  const token = header.slice("bearer ".length).trim();
  return token || undefined;
}

function pillarConfigForDeployment(settings: NetworkSettings, pillar: PillarRecord): unknown {
  return buildNodeConfig(settings, pillar, producerPassword(pillar), {
    dataPath: "/root/.znn",
    walletPath: "/root/.znn/wallet",
    genesisFile: "/root/.znn/genesis.json",
    producerKeyFilePath: "/root/.znn/wallet/producer.json"
  });
}

function seedNodeConfigForDeployment(settings: NetworkSettings, seedNode: SeedNodeRecord): unknown {
  const config = buildNodeConfig(settings, undefined, undefined, {
    dataPath: "/root/.znn",
    walletPath: "/root/.znn/wallet",
    genesisFile: "/root/.znn/genesis.json"
  });
  return {
    ...config,
    Name: seedNode.nodeName,
    Producer: undefined,
    Net: {
      ...config.Net,
      Seeders: settings.seeders.filter((seeder) => seeder !== seedNode.enode),
      BootstrapPeers: (settings.bootstrapPeers ?? []).filter((bootstrapPeer) => bootstrapPeer !== seedNode.multiaddr)
    }
  };
}

function releaseTarget(settings: NetworkSettings | NetworkSettingsSnapshot) {
  return {
    goZenon: {
      repoUrl: settings.goZenonRepo,
      ref: settings.goZenonRef,
      commit: settings.goZenonCommit || undefined
    },
    deployment: {
      repoUrl: settings.deploymentRepo,
      ref: settings.deploymentRef,
      commit: settings.deploymentCommit || undefined
    }
  };
}

/**
 * Policy violations in an already-published node plan. Published plans must carry both commit
 * pins; legacy plans that predate pinning are withheld from nodes until a new release is published.
 */
function nodePlanPolicyErrors(nodePlan: PublishedArtifacts["nodePlan"]): string[] {
  if (!nodePlan) return [];
  return releasePolicyErrors(
    {
      goZenonRepo: nodePlan.goZenon.repoUrl,
      goZenonRef: nodePlan.goZenon.ref,
      goZenonCommit: nodePlan.goZenon.commit,
      deploymentRepo: nodePlan.deployment.repoUrl,
      deploymentRef: nodePlan.deployment.ref,
      deploymentCommit: nodePlan.deployment.commit
    },
    REPO_POLICY,
    { requirePins: true }
  );
}

class PublishError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function redactedNodePlan<T extends PublishedArtifacts["nodePlan"]>(nodePlan: T): T {
  if (!nodePlan) return nodePlan;
  return {
    ...nodePlan,
    goZenon: { ...nodePlan.goZenon, repoUrl: redactUrl(nodePlan.goZenon.repoUrl) },
    deployment: { ...nodePlan.deployment, repoUrl: redactUrl(nodePlan.deployment.repoUrl) }
  };
}

function buildPublishedNodePlan(settings: NetworkSettingsSnapshot, publishedAt: string, finalizedAt?: string) {
  return {
    schemaVersion: 1,
    eventId: publishedAt,
    publishedAt,
    finalizedAt,
    genesisStartAt: new Date(settings.genesisTimestampSec * 1000).toISOString(),
    actions: {
      wipeData: settings.wipeDataOnPublish,
      applyAt: settings.releaseApplyAtSec ? new Date(settings.releaseApplyAtSec * 1000).toISOString() : undefined
    },
    ...releaseTarget(settings)
  };
}

function bootstrapManifest(request: express.Request, published: PublishedArtifacts, node: BootstrapNode) {
  const origin = requestOrigin(request);
  const nodePlan = published.nodePlan;
  if (!nodePlan) throw new Error("node plan has not been published");
  const base = {
    schemaVersion: nodePlan.schemaVersion,
    eventId: nodePlan.eventId,
    publishedAt: published.publishedAt,
    finalizedAt: nodePlan.finalizedAt,
    genesisUrl: `${origin}${PUBLIC_GENESIS_PATH}`,
    configUrl: `${origin}/api/bootstrap/node-config.json`,
    nodePlanUrl: `${origin}${PUBLIC_NODE_PLAN_PATH}`,
    statusUrl: `${origin}/api/bootstrap/status`,
    genesisStartAt: nodePlan.genesisStartAt,
    actions: nodePlan.actions,
    goZenon: nodePlan.goZenon,
    deployment: nodePlan.deployment
  };

  if (node.nodeType === "pillar") {
    return {
      ...base,
      nodeType: "pillar",
      pillarName: node.pillar.pillarName,
      nodeName: node.pillar.pillarName,
      pillarAddress: node.pillar.pillarWallet.address,
      rewardAddress: node.pillar.rewardWallet.address,
      producerAddress: node.pillar.producerWallet.address,
      producerKeyFileUrl: `${origin}/api/bootstrap/producer.json`,
      producerPasswordUrl: `${origin}/api/bootstrap/producer-password.txt`
    };
  }

  return {
    ...base,
    nodeType: "seed",
    nodeName: node.seedNode.nodeName,
    publicIp: node.seedNode.publicIp,
    p2pPort: node.seedNode.p2pPort,
    publicKey: node.seedNode.publicKey,
    enode: node.seedNode.enode,
    multiaddr: node.seedNode.multiaddr,
    networkPrivateKeyUrl: `${origin}/api/bootstrap/network-private-key`
  };
}

async function withBootstrapNode(
  request: express.Request,
  response: express.Response,
  handler: (state: AppState, node: BootstrapNode) => Promise<void> | void
): Promise<void> {
  const token = bearerToken(request);
  if (!token) {
    response.status(401).json({ error: "Missing bearer token" });
    return;
  }

  const tokenHash = sha256(token);
  const state = await readState();
  const pillar = state.pillars.find((candidate) => candidate.statusTokenHash === tokenHash);
  if (pillar) {
    await handler(state, { nodeType: "pillar", pillar });
    return;
  }

  const seedNode = state.seedNodes.find((candidate) => candidate.statusTokenHash === tokenHash);
  if (seedNode) {
    await handler(state, { nodeType: "seed", seedNode });
    return;
  }

  response.status(401).json({ error: "Invalid bootstrap token" });
}


function historySample(report: NodeStatusReport): NodeStatusReport {
  // History only needs the numeric time series; drop per-peer detail, log lines, and the last
  // error text so the state file stays small regardless of what a node reports.
  const { lastError: _lastError, ...node } = report.node ?? {};
  return {
    ...report,
    node: report.node ? node : undefined,
    network: report.network
      ? {
          peerCount: report.network.peerCount,
          selfPublicKey: report.network.selfPublicKey,
          selfIp: report.network.selfIp
        }
      : undefined,
    logs: report.logs
      ? {
          errorCountLastMinute: report.logs.errorCountLastMinute,
          warningCountLastMinute: report.logs.warningCountLastMinute
        }
      : undefined
  };
}

async function receiveNodeStatus(request: express.Request, response: express.Response): Promise<void> {
  const token = bearerToken(request);
  if (!token) {
    response.status(401).json({ error: "Missing bearer token" });
    return;
  }

  const parsed = nodeStatusReportSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid node status report" });
    return;
  }

  const tokenHash = sha256(token);
  try {
    const result = await updateState((state) => {
      const pillar = state.pillars.find((candidate) => candidate.statusTokenHash === tokenHash);
      const seedNode = state.seedNodes.find((candidate) => candidate.statusTokenHash === tokenHash);
      const target = pillar ?? seedNode;
      if (!target) throw new Error("Invalid node status token");

      const latest: NodeStatusReport = {
        ...parsed.data,
        receivedAt: new Date().toISOString(),
        remoteAddress: request.ip
      };

      const previousHistory = target.nodeStatus?.history ?? [];
      const lastSampleAt = previousHistory.at(-1)?.receivedAt;
      const appendSample = !lastSampleAt || Date.now() - new Date(lastSampleAt).getTime() >= NODE_STATUS_HISTORY_MIN_INTERVAL_MS;
      const history = (appendSample ? [...previousHistory, historySample(latest)] : previousHistory).slice(-NODE_STATUS_HISTORY_LIMIT);
      target.nodeStatus = {
        latest,
        history
      };

      const nodeName = pillar?.pillarName ?? seedNode?.nodeName ?? "unknown";
      return {
        nodeType: pillar ? "pillar" : "seed",
        nodeName,
        pillarName: pillar?.pillarName,
        receivedAt: latest.receivedAt
      };
    });
    response.json({ ok: true, ...result });
  } catch (error: unknown) {
    response.status(401).json({ error: (error as Error).message });
  }
}

async function warnAboutStoredSettings(): Promise<void> {
  const state = await readState();
  for (const reason of releasePolicyErrors(state.settings, REPO_POLICY)) {
    console.warn(`Stored release settings violate the repository policy (${reason}). Publishing is blocked until they are fixed.`);
  }
  if (state.publishedArtifacts?.nodePlan && nodePlanPolicyErrors(state.publishedArtifacts.nodePlan).length) {
    console.warn("The currently published release violates the repository policy; nodes will not receive it until a compliant release is published.");
  }
  if (!PUBLIC_URL && process.env.NODE_ENV === "production") {
    console.warn("PUBLIC_URL is not set; generated bootstrap scripts will derive their origin from request headers. Set PUBLIC_URL to the public https origin.");
  }
}

async function main() {
  await ensureSporkWallet();
  await ensurePillarStatusTokens();
  await warnAboutStoredSettings();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", TRUST_PROXY);
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "same-origin");
    next();
  });
  app.use("/api", (_request, response, next) => {
    // API responses include session data, wallet secrets, and tokens; never let them be cached.
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/public/stats", async (_request, response) => {
    const state = await readState();
    const now = Date.now();
    const isActive = (nodeStatus?: PillarNodeStatus) => {
      const receivedAt = nodeStatus?.latest?.receivedAt;
      return Boolean(receivedAt) && now - new Date(receivedAt as string).getTime() < 5 * 60_000;
    };
    const nodes = [...state.pillars, ...state.seedNodes];
    // Public figures describe the published network; draft settings are only a fallback before
    // the first publish.
    const published = state.publishedArtifacts?.settings;
    const stats: PublicStats = {
      chainIdentifier: published?.chainIdentifier ?? state.settings.chainIdentifier,
      genesisTimestampSec: published?.genesisTimestampSec ?? state.settings.genesisTimestampSec,
      // Report what nodes actually run: the published release, falling back to the draft settings.
      goZenonRepo: redactUrl(
        state.publishedArtifacts?.nodePlan?.goZenon.repoUrl ?? state.publishedArtifacts?.settings?.goZenonRepo ?? state.settings.goZenonRepo
      ),
      goZenonRef: state.publishedArtifacts?.nodePlan?.goZenon.ref ?? state.publishedArtifacts?.settings?.goZenonRef ?? state.settings.goZenonRef,
      goZenonCommit:
        state.publishedArtifacts?.nodePlan?.goZenon.commit ?? state.publishedArtifacts?.settings?.goZenonCommit ?? state.settings.goZenonCommit,
      pillarCount: state.pillars.length,
      expectedPillars: published?.expectedPillars ?? state.settings.expectedPillars,
      seedNodeCount: state.seedNodes.length,
      activeNodes: nodes.filter((node) => isActive(node.nodeStatus)).length,
      totalNodes: nodes.length,
      publishedAt: state.publishedArtifacts?.publishedAt
    };
    response.setHeader("Cache-Control", "no-store");
    response.json(stats);
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

  app.get(PUBLIC_NODE_PLAN_PATH, async (_request, response) => {
    const state = await readState();
    if (!state.publishedArtifacts?.nodePlan) {
      response.status(404).json({ error: "node-plan.json has not been published" });
      return;
    }
    sendJsonFile(response, redactedNodePlan(state.publishedArtifacts.nodePlan));
  });

  app.post("/api/bootstrap/status", receiveNodeStatus);
  app.post("/api/node/status", receiveNodeStatus);

  app.get("/api/bootstrap/install.sh", (request, response) => {
    response.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.send(bootstrapInstallScript(requestOrigin(request)));
  });

  app.get("/api/bootstrap/manifest", async (request, response) => {
    await withBootstrapNode(request, response, (state, node) => {
      if (!state.publishedArtifacts?.nodePlan) {
        response.status(404).json({ error: "No published release is available yet" });
        return;
      }
      if (nodePlanPolicyErrors(state.publishedArtifacts.nodePlan).length) {
        response.status(409).json({ error: "The published release violates the repository policy; wait for a compliant release" });
        return;
      }
      response.json(bootstrapManifest(request, state.publishedArtifacts, node));
    });
  });

  app.get("/api/bootstrap/node-config.json", async (request, response) => {
    await withBootstrapNode(request, response, (state, node) => {
      if (!state.publishedArtifacts?.settings) {
        response.status(404).json({ error: "No published release is available yet" });
        return;
      }
      const config =
        node.nodeType === "pillar"
          ? pillarConfigForDeployment(state.publishedArtifacts.settings, node.pillar)
          : seedNodeConfigForDeployment(state.publishedArtifacts.settings, node.seedNode);
      sendJsonFile(response, config);
    });
  });

  app.get("/api/bootstrap/pillar-config.json", async (request, response) => {
    await withBootstrapNode(request, response, (state, node) => {
      if (node.nodeType !== "pillar") {
        response.status(404).json({ error: "Seed nodes do not have pillar config" });
        return;
      }
      if (!state.publishedArtifacts?.settings) {
        response.status(404).json({ error: "No published release is available yet" });
        return;
      }
      sendJsonFile(response, pillarConfigForDeployment(state.publishedArtifacts.settings, node.pillar));
    });
  });

  app.get("/api/bootstrap/producer.json", async (request, response) => {
    await withBootstrapNode(request, response, (_state, node) => {
      if (node.nodeType !== "pillar") {
        response.status(404).json({ error: "Seed nodes do not have producer wallets" });
        return;
      }
      sendJsonFile(response, node.pillar.producerWallet.keyFile);
    });
  });

  app.get("/api/bootstrap/producer-password.txt", async (request, response) => {
    await withBootstrapNode(request, response, (_state, node) => {
      if (node.nodeType !== "pillar") {
        response.status(404).json({ error: "Seed nodes do not have producer wallets" });
        return;
      }
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.send(`${producerPassword(node.pillar)}\n`);
    });
  });

  app.get("/api/bootstrap/network-private-key", async (request, response) => {
    await withBootstrapNode(request, response, (_state, node) => {
      if (node.nodeType !== "seed") {
        response.status(404).json({ error: "Pillar nodes do not have managed network private keys" });
        return;
      }
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.send(`${decryptText(node.seedNode.networkPrivateKeyCipher)}\n`);
    });
  });

  app.post("/api/auth/login", async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid login" });
      return;
    }

    const addressKey = request.ip ?? "unknown";
    const accountKey = `${parsed.data.username.trim().toLowerCase()}|${addressKey}`;
    // Count the attempt before verifying so concurrent requests cannot exceed the limit together.
    const retryAfterMs = Math.max(loginLimiterByAddress.admit(addressKey), loginLimiterByAccountAndAddress.admit(accountKey));
    if (retryAfterMs > 0) {
      response.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      response.status(429).json({ error: "Too many login attempts. Try again later." });
      return;
    }
    if (loginsInFlight >= MAX_CONCURRENT_LOGINS) {
      response.setHeader("Retry-After", "2");
      response.status(429).json({ error: "Too many logins in progress. Try again shortly." });
      return;
    }

    loginsInFlight += 1;
    let result: Awaited<ReturnType<typeof login>>;
    try {
      result = await login(parsed.data.username, parsed.data.password);
    } finally {
      loginsInFlight -= 1;
    }
    if (!result) {
      response.status(401).json({ error: "Invalid username or password" });
      return;
    }

    loginLimiterByAccountAndAddress.reset(accountKey);
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
    const seedNode = state.seedNodes.find((candidate) => candidate.userId === user.id);
    const bootstrapRecord = pillar ?? seedNode;
    response.json({
      user,
      pillar: pillar ? toPublicPillar(pillar) : undefined,
      seedNode: seedNode ? publicSeedNode(seedNode) : undefined,
      bootstrap: bootstrapRecord?.statusTokenCipher ? { statusToken: statusToken(bootstrapRecord) } : undefined
    });
  });

  app.post("/api/pillar", requireAuth(), async (request, response) => {
    const user = (request as AuthedRequest).user;
    const parsed = nodeRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid node registration" });
      return;
    }

    try {
      if (parsed.data.nodeType === "pillar") {
        const pillar = await createPillar(user.id, parsed.data.pillarName);
        response.status(201).json({ pillar: toPublicPillar(pillar) });
        return;
      }

      const seedNode = await createSeedNode(user.id, parsed.data.nodeName, parsed.data.publicIp, parsed.data.p2pPort);
      response.status(201).json({ seedNode: publicSeedNode(seedNode) });
    } catch (error: unknown) {
      response.status(409).json({ error: (error as Error).message });
    }
  });

  app.get("/api/pillar/package", requireAuth(), async (request, response) => {
    const user = (request as AuthedRequest).user;
    const state = await readState();
    const pillar = state.pillars.find((candidate) => candidate.userId === user.id);
    const seedNode = state.seedNodes.find((candidate) => candidate.userId === user.id);
    if (!pillar && !seedNode) {
      response.status(404).json({ error: "No node registered" });
      return;
    }

    if (pillar) {
      const body = await buildPillarPackage(state.settings, pillar);
      await updateState((draft) => {
        const target = draft.pillars.find((candidate) => candidate.id === pillar.id);
        if (target) target.packageDownloadedAt = new Date().toISOString();
      });
      sendDownload(response, `${pillar.pillarName}-pillar-package.zip`, "application/zip", body);
      return;
    }
    if (!seedNode) {
      response.status(404).json({ error: "No seed node registered" });
      return;
    }

    const body = await buildSeedNodePackage(state.settings, seedNode);
    await updateState((draft) => {
      const target = draft.seedNodes.find((candidate) => candidate.id === seedNode.id);
      if (target) target.packageDownloadedAt = new Date().toISOString();
    });
    sendDownload(response, `${seedNode.nodeName}-seed-node-package.zip`, "application/zip", body);
  });

  app.get("/api/admin/overview", requireAuth("admin"), async (request, response) => {
    const user = (request as AuthedRequest).user;
    const state = await readState();
    response.json({
      user,
      settings: publicSettings(state.settings),
      repoPolicy: REPO_POLICY,
      users: managedUsers(state),
      pillars: state.pillars.map(toPublicPillar),
      seedNodes: state.seedNodes.map(publicSeedNode),
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
      const beforeGenesisSettings = genesisSettingsKey(state.settings);
      const bootstrapPeers =
        parsed.data.bootstrapPeers ??
        uniqueStrings([...(state.settings.bootstrapPeers ?? []), ...parsed.data.seeders.map((seeder) => multiaddrFromEnode(seeder))]);
      state.settings = {
        ...state.settings,
        ...parsed.data,
        minPillars: Math.min(parsed.data.minPillars, parsed.data.expectedPillars),
        goZenonCommit: parsed.data.goZenonCommit || undefined,
        deploymentCommit: parsed.data.deploymentCommit || undefined,
        bootstrapPeers,
        genesisFunds: parsed.data.genesisFunds ?? state.settings.genesisFunds
      };
      if (genesisSettingsKey(state.settings) !== beforeGenesisSettings) {
        state.finalizedGenesis = undefined;
      }
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
        const deletedSeedNodes = state.seedNodes.filter((seedNode) => seedNode.userId === user.id);
        const deletedSeedEnodes = deletedSeedNodes.map((seedNode) => seedNode.enode);
        const deletedBootstrapPeers = deletedSeedNodes.map((seedNode) => seedNode.multiaddr);
        state.users = state.users.filter((candidate) => candidate.id !== user.id);
        state.sessions = state.sessions.filter((session) => session.userId !== user.id);
        state.pillars = state.pillars.filter((pillar) => pillar.userId !== user.id);
        state.seedNodes = state.seedNodes.filter((seedNode) => seedNode.userId !== user.id);
        if (deletedSeedEnodes.length) {
          state.settings.seeders = state.settings.seeders.filter((seeder) => !deletedSeedEnodes.includes(seeder));
          state.settings.bootstrapPeers = (state.settings.bootstrapPeers ?? []).filter((bootstrapPeer) => !deletedBootstrapPeers.includes(bootstrapPeer));
        }
        if (hadPillar) state.finalizedGenesis = undefined;

        return { deletedUserId: user.id, deletedPillar: hadPillar, deletedSeedNodes: deletedSeedEnodes.length };
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

  app.delete("/api/admin/seed-nodes/:seedNodeId", requireAuth("admin"), async (request, response) => {
    const seedNodeId = String(request.params.seedNodeId);
    try {
      const seedNode = await updateState((state) => {
        const index = state.seedNodes.findIndex((candidate) => candidate.id === seedNodeId);
        if (index < 0) throw new Error("Seed node not found");

        const [deleted] = state.seedNodes.splice(index, 1);
        state.settings.seeders = state.settings.seeders.filter((seeder) => seeder !== deleted.enode);
        state.settings.bootstrapPeers = (state.settings.bootstrapPeers ?? []).filter((bootstrapPeer) => bootstrapPeer !== deleted.multiaddr);
        return publicSeedNode(deleted);
      });
      response.json({ seedNode });
    } catch (error: unknown) {
      response.status(404).json({ error: (error as Error).message });
    }
  });

  app.post("/api/admin/seed-nodes", requireAuth("admin"), async (request, response) => {
    const parsed = adminSeedNodeCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid seed node" });
      return;
    }

    try {
      const seedNode = await createSeedNode(parsed.data.userId, parsed.data.nodeName, parsed.data.publicIp, parsed.data.p2pPort);
      const state = await readState();
      response.status(201).json({
        seedNode: publicSeedNode(seedNode),
        settings: publicSettings(state.settings),
        user: managedUsers(state).find((candidate) => candidate.id === parsed.data.userId)
      });
    } catch (error: unknown) {
      response.status(409).json({ error: (error as Error).message });
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
        state.settings.bootstrapPeers = Array.from(new Set([...(state.settings.bootstrapPeers ?? []), seed.multiaddr]));
        return publicSettings(state.settings);
      });
      response.json({ seed, settings });
    } catch (error: unknown) {
      response.status(502).json({ error: (error as Error).message });
    }
  });

  app.post("/api/admin/finalize", requireAuth("admin"), async (_request, response) => {
    try {
      const result = await updateState((state) => {
        const blockers = finalizeBlockers(state);
        if (blockers.length) throw new PublishError(400, `Cannot finalize: ${blockers.join("; ")}`);
        const genesis = buildGenesis(state.settings, state.pillars);
        state.finalizedGenesis = {
          genesis,
          finalizedAt: new Date().toISOString()
        };
        return state.finalizedGenesis;
      });
      response.json(result);
    } catch (error: unknown) {
      if (error instanceof PublishError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  app.post("/api/admin/publish", requireAuth("admin"), async (_request, response) => {
    const current = await readState();
    const policyErrors = releasePolicyErrors(current.settings, REPO_POLICY);
    if (policyErrors.length) {
      response.status(400).json({ error: `Release settings violate the repository policy: ${policyErrors.join("; ")}` });
      return;
    }

    // Every published release is immutable: a pin the admin left empty is resolved to the current
    // commit of the ref now, and the published plan carries both pins.
    const release = {
      goZenonRepo: current.settings.goZenonRepo,
      goZenonRef: current.settings.goZenonRef,
      goZenonCommit: current.settings.goZenonCommit,
      deploymentRepo: current.settings.deploymentRepo,
      deploymentRef: current.settings.deploymentRef,
      deploymentCommit: current.settings.deploymentCommit
    };
    try {
      if (!release.goZenonCommit) release.goZenonCommit = await resolveGitRef(release.goZenonRepo, release.goZenonRef);
      if (!release.deploymentCommit) release.deploymentCommit = await resolveGitRef(release.deploymentRepo, release.deploymentRef);
    } catch (error: unknown) {
      response.status(502).json({
        error: `Could not resolve the commit for the release refs (${(error as Error).message}). Set the commit pins explicitly and try again.`
      });
      return;
    }

    let result: PublishedArtifacts;
    try {
      result = await updateState((state) => {
        // Validate against the settings actually being published, inside the serialized update.
        const errors = releasePolicyErrors(state.settings, REPO_POLICY);
        if (errors.length) throw new PublishError(400, `Release settings violate the repository policy: ${errors.join("; ")}`);
        // Every published input (settings, the pillar set, the finalized genesis) must be exactly
        // what the admin saw when they clicked publish; ref resolution above took real time.
        if (publishInputsKey(state) !== publishInputsKey(current)) {
          throw new PublishError(409, "Settings or registrations changed while publishing; review them and publish again");
        }

        if (!state.finalizedGenesis) {
          // Publishing without an explicit finalize finalizes implicitly, under the same rules.
          const blockers = finalizeBlockers(state);
          if (blockers.length) throw new PublishError(400, `Cannot finalize the genesis for publishing: ${blockers.join("; ")}`);
        }
        const genesis = state.finalizedGenesis?.genesis ?? buildGenesis(state.settings, state.pillars);
        const now = new Date().toISOString();
        if (!state.finalizedGenesis) {
          state.finalizedGenesis = {
            finalizedAt: now,
            genesis
          };
        }

        const settings: NetworkSettingsSnapshot = {
          ...settingsSnapshot(state.settings),
          goZenonCommit: release.goZenonCommit,
          deploymentCommit: release.deploymentCommit
        };
        state.publishedArtifacts = {
        publishedAt: now,
        genesis,
        config: buildNodeConfig(settings),
        nodePlan: buildPublishedNodePlan(settings, now, state.finalizedGenesis.finalizedAt),
        settings,
        chainIdentifier: settings.chainIdentifier,
        seeders: [...settings.seeders],
        bootstrapPeers: [...(settings.bootstrapPeers ?? [])]
      };
        state.settings.wipeDataOnPublish = false;
        state.settings.releaseApplyAtSec = undefined;
        return state.publishedArtifacts;
      });
    } catch (error: unknown) {
      if (error instanceof PublishError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
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
