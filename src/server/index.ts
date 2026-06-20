import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import { z } from "zod";
import { clearSessionCookie, login, logout, requireAuth, sessionTokenFromRequest, setSessionCookie, type AuthedRequest } from "./auth.js";
import { createAccount, resetAccountPassword } from "./accounts.js";
import { decryptText, encryptText, randomId, sha256 } from "./crypto.js";
import { buildGenesis, buildNodeConfig, readiness, toPublicPillar } from "./genesis.js";
import { buildPillarPackage, buildSporkPackage } from "./packages.js";
import { probeSeedNode, validateSeedNodeIp } from "./seeders.js";
import { readState, updateState } from "./storage.js";
import { createWallet, toStoredWallet } from "./wallets.js";
import type {
  AppState,
  ManagedUser,
  NetworkSettings,
  NetworkSettingsSnapshot,
  NodeStatusReport,
  PillarRecord,
  PublishedArtifacts,
  PublishedArtifactsInfo,
  PublicNetworkSettings
} from "../shared/types.js";

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_GENESIS_PATH = "/genesis.json";
const PUBLIC_CONFIG_PATH = "/config.json";
const PUBLIC_NODE_PLAN_PATH = "/node-plan.json";
const NODE_STATUS_HISTORY_LIMIT = 24 * 60;

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
  goZenonRepo: z.string().trim().min(1).max(300),
  goZenonRef: z.string().trim().min(1).max(160),
  goZenonCommit: z.string().trim().max(80).optional(),
  deploymentRepo: z.string().trim().min(1).max(300),
  deploymentRef: z.string().trim().min(1).max(160),
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

const optionalShortText = z.string().trim().max(256).optional();

const nodeStatusReportSchema = z.object({
  eventId: z.string().trim().max(120).optional(),
  reportedAt: z.string().trim().max(80).optional(),
  node: z
    .object({
      hostname: optionalShortText,
      serviceActive: z.boolean().optional(),
      installedRepo: z.string().trim().max(300).optional(),
      installedRef: optionalShortText,
      installedCommit: optionalShortText,
      genesisSha256: optionalShortText,
      configSha256: optionalShortText
    })
    .optional(),
  sync: z
    .object({
      state: z.number().int().min(0).max(10).optional(),
      currentHeight: z.number().int().min(0).optional(),
      targetHeight: z.number().int().min(0).optional()
    })
    .optional(),
  network: z
    .object({
      peerCount: z.number().int().min(0).max(10000).optional(),
      selfPublicKey: z.string().trim().max(256).optional(),
      selfIp: z.string().trim().max(128).optional(),
      peers: z
        .array(
          z.object({
            publicKey: z.string().trim().max(256).optional(),
            ip: z.string().trim().max(128).optional(),
            name: z.string().trim().max(128).optional(),
            version: z.string().trim().max(128).optional()
          })
        )
        .max(100)
        .optional()
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

function createStatusTokenFields(): Pick<PillarRecord, "statusTokenHash" | "statusTokenCipher"> {
  const token = randomId(32);
  return {
    statusTokenHash: sha256(token),
    statusTokenCipher: encryptText(token)
  };
}

function ensureStatusToken(pillar: PillarRecord): void {
  if (pillar.statusTokenHash && pillar.statusTokenCipher) return;
  Object.assign(pillar, createStatusTokenFields());
}

async function ensurePillarStatusTokens(): Promise<void> {
  await updateState((state) => {
    for (const pillar of state.pillars) {
      ensureStatusToken(pillar);
    }
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
      ...createStatusTokenFields(),
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
    nodePlanPath: published.nodePlan ? PUBLIC_NODE_PLAN_PATH : undefined,
    chainIdentifier: published.chainIdentifier,
    seeders: published.seeders,
    release: published.nodePlan
      ? {
          goZenon: published.nodePlan.goZenon,
          deployment: published.nodePlan.deployment
        }
      : undefined
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function settingsSnapshot(settings: NetworkSettings): NetworkSettingsSnapshot {
  const { sporkWallet: _sporkWallet, ...snapshot } = settings;
  return cloneJson(snapshot);
}

function genesisSettingsKey(settings: NetworkSettings): string {
  return JSON.stringify({
    chainIdentifier: settings.chainIdentifier,
    extraData: settings.extraData,
    expectedPillars: settings.expectedPillars,
    minPillars: settings.minPillars,
    genesisTimestampSec: settings.genesisTimestampSec,
    seeders: settings.seeders,
    sporks: settings.sporks
  });
}

function requestOrigin(request: express.Request): string {
  const forwardedProto = request.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.get("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = forwardedProto || request.protocol;
  const host = forwardedHost || request.get("host") || `127.0.0.1:${PORT}`;
  return `${proto}://${host}`;
}

function statusToken(pillar: PillarRecord): string {
  return pillar.statusTokenCipher ? decryptText(pillar.statusTokenCipher) : "";
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

function releaseTarget(settings: NetworkSettings | NetworkSettingsSnapshot) {
  return {
    goZenon: {
      repoUrl: settings.goZenonRepo,
      ref: settings.goZenonRef,
      commit: settings.goZenonCommit || undefined
    },
    deployment: {
      repoUrl: settings.deploymentRepo,
      ref: settings.deploymentRef
    }
  };
}

function buildPublishedNodePlan(settings: NetworkSettingsSnapshot, publishedAt: string, finalizedAt?: string) {
  return {
    schemaVersion: 1,
    eventId: publishedAt,
    publishedAt,
    finalizedAt,
    ...releaseTarget(settings)
  };
}

function bootstrapManifest(request: express.Request, published: PublishedArtifacts, pillar: PillarRecord) {
  const origin = requestOrigin(request);
  const nodePlan = published.nodePlan;
  if (!nodePlan) throw new Error("node plan has not been published");
  return {
    schemaVersion: nodePlan.schemaVersion,
    eventId: nodePlan.eventId,
    publishedAt: published.publishedAt,
    finalizedAt: nodePlan.finalizedAt,
    pillarName: pillar.pillarName,
    pillarAddress: pillar.pillarWallet.address,
    rewardAddress: pillar.rewardWallet.address,
    producerAddress: pillar.producerWallet.address,
    genesisUrl: `${origin}${PUBLIC_GENESIS_PATH}`,
    configUrl: `${origin}/api/bootstrap/pillar-config.json`,
    producerKeyFileUrl: `${origin}/api/bootstrap/producer.json`,
    producerPasswordUrl: `${origin}/api/bootstrap/producer-password.txt`,
    nodePlanUrl: `${origin}${PUBLIC_NODE_PLAN_PATH}`,
    statusUrl: `${origin}/api/bootstrap/status`,
    goZenon: nodePlan.goZenon,
    deployment: nodePlan.deployment
  };
}

async function withBootstrapPillar(
  request: express.Request,
  response: express.Response,
  handler: (state: AppState, pillar: PillarRecord) => Promise<void> | void
): Promise<void> {
  const token = bearerToken(request);
  if (!token) {
    response.status(401).json({ error: "Missing bearer token" });
    return;
  }

  const tokenHash = sha256(token);
  const state = await readState();
  const pillar = state.pillars.find((candidate) => candidate.statusTokenHash === tokenHash);
  if (!pillar) {
    response.status(401).json({ error: "Invalid bootstrap token" });
    return;
  }

  await handler(state, pillar);
}

function bootstrapInstallScript(origin: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script as root, usually via sudo." >&2
  exit 1
fi

: "\${ZNN_BOOTSTRAP_TOKEN:?Set ZNN_BOOTSTRAP_TOKEN to the pillar bootstrap token from the testnet builder.}"

BASE_URL="\${ZNN_TESTNET_URL:-${origin}}"
ZNN_DIR="\${ZNN_DIR:-/root/.znn}"
DEPLOYMENT_DIR="\${ZNN_DEPLOYMENT_DIR:-/opt/zenon-deployment}"
SERVICE_NAME="\${ZNN_SERVICE_NAME:-go-zenon}"
RPC_URL="\${ZNN_RPC_URL:-http://127.0.0.1:35997}"

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git jq
fi

api() {
  curl -fsSL -H "Authorization: Bearer \${ZNN_BOOTSTRAP_TOKEN}" "$1"
}

manifest="$(api "\${BASE_URL}/api/bootstrap/manifest")"
go_repo="$(printf '%s' "$manifest" | jq -r '.goZenon.repoUrl')"
go_ref="$(printf '%s' "$manifest" | jq -r '.goZenon.ref')"
deployment_repo="$(printf '%s' "$manifest" | jq -r '.deployment.repoUrl')"
deployment_ref="$(printf '%s' "$manifest" | jq -r '.deployment.ref')"
genesis_url="$(printf '%s' "$manifest" | jq -r '.genesisUrl')"
config_url="$(printf '%s' "$manifest" | jq -r '.configUrl')"
producer_url="$(printf '%s' "$manifest" | jq -r '.producerKeyFileUrl')"
producer_password_url="$(printf '%s' "$manifest" | jq -r '.producerPasswordUrl')"

rm -rf "$DEPLOYMENT_DIR"
git clone --depth 1 --branch "$deployment_ref" "$deployment_repo" "$DEPLOYMENT_DIR"
chmod +x "$DEPLOYMENT_DIR/zenon.sh"

cd "$DEPLOYMENT_DIR"
./zenon.sh --deploy zenon "$go_repo" "$go_ref"

systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true

mkdir -p "$ZNN_DIR/wallet"
api "$genesis_url" > "$ZNN_DIR/genesis.json"
api "$config_url" > "$ZNN_DIR/config.json"
api "$producer_url" > "$ZNN_DIR/wallet/producer.json"
api "$producer_password_url" > "$ZNN_DIR/wallet/producer-password.txt"

chmod 700 "$ZNN_DIR" "$ZNN_DIR/wallet"
chmod 600 "$ZNN_DIR/genesis.json" "$ZNN_DIR/config.json" "$ZNN_DIR/wallet/producer.json" "$ZNN_DIR/wallet/producer-password.txt"

cat > /usr/local/bin/znn-testnet-agent <<'AGENT'
#!/usr/bin/env bash
set -euo pipefail

: "\${ZNN_BOOTSTRAP_TOKEN:?Missing ZNN_BOOTSTRAP_TOKEN.}"

BASE_URL="\${ZNN_TESTNET_URL:-${origin}}"
RPC_URL="\${ZNN_RPC_URL:-http://127.0.0.1:35997}"
SERVICE_NAME="\${ZNN_SERVICE_NAME:-go-zenon}"
STATE_DIR="\${ZNN_AGENT_STATE_DIR:-/var/lib/znn-testnet-agent}"
STATE_FILE="$STATE_DIR/state.json"

mkdir -p "$STATE_DIR"

rpc() {
  curl -fsS --max-time 5 -H "Content-Type: application/json" \\
    -d "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"$1\\",\\"params\\":[]}" \\
    "$RPC_URL" | jq -c '.result // {}'
}

sync_json="$(rpc stats.syncInfo || echo '{}')"
network_json="$(rpc stats.networkInfo || echo '{}')"
service_active=false
if systemctl is-active --quiet "$SERVICE_NAME"; then
  service_active=true
fi

logs="$(journalctl -u "$SERVICE_NAME" --since '1 minute ago' --no-pager 2>/dev/null | grep -Eai 'error|warn|panic|fatal|failed|exception' | tail -20 || true)"
error_count="$(printf '%s\\n' "$logs" | grep -Eai 'error|panic|fatal|failed|exception' | grep -c . || true)"
warn_count="$(printf '%s\\n' "$logs" | grep -Eai 'warn' | grep -c . || true)"
recent_json="$(printf '%s\\n' "$logs" | jq -R . | jq -s .)"

manifest="$(curl -fsSL -H "Authorization: Bearer $ZNN_BOOTSTRAP_TOKEN" "$BASE_URL/api/bootstrap/manifest")"
go_repo="$(printf '%s' "$manifest" | jq -r '.goZenon.repoUrl')"
go_ref="$(printf '%s' "$manifest" | jq -r '.goZenon.ref')"
go_commit="$(printf '%s' "$manifest" | jq -r '.goZenon.commit // empty')"

payload="$(jq -n \\
  --arg reportedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
  --arg hostname "$(hostname)" \\
  --arg goRepo "$go_repo" \\
  --arg goRef "$go_ref" \\
  --arg goCommit "$go_commit" \\
  --argjson serviceActive "$service_active" \\
  --argjson sync "$sync_json" \\
  --argjson network "$network_json" \\
  --argjson errors "$error_count" \\
  --argjson warnings "$warn_count" \\
  --argjson recent "$recent_json" \\
  '{
    reportedAt: $reportedAt,
    node: {
      hostname: $hostname,
      serviceActive: $serviceActive,
      installedRepo: $goRepo,
      installedRef: $goRef,
      installedCommit: $goCommit
    },
    sync: {
      state: $sync.state,
      currentHeight: $sync.currentHeight,
      targetHeight: $sync.targetHeight
    },
    network: {
      peerCount: (($network.peers // []) | length),
      selfPublicKey: $network.self.publicKey,
      selfIp: $network.self.ip,
      peers: (($network.peers // []) | map({
        publicKey: .publicKey,
        ip: .ip,
        name: .name,
        version: .version
      }) | .[0:20])
    },
    logs: {
      errorCountLastMinute: $errors,
      warningCountLastMinute: $warnings,
      recent: $recent
    }
  }')"

curl -fsS -X POST "$BASE_URL/api/bootstrap/status" \\
  -H "Authorization: Bearer $ZNN_BOOTSTRAP_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "$payload" >/dev/null

printf '%s\\n' "$payload" > "$STATE_FILE"
AGENT

chmod 700 /usr/local/bin/znn-testnet-agent

cat > /etc/cron.d/znn-testnet-agent <<EOF
ZNN_BOOTSTRAP_TOKEN=$ZNN_BOOTSTRAP_TOKEN
ZNN_TESTNET_URL=$BASE_URL
ZNN_RPC_URL=$RPC_URL
ZNN_SERVICE_NAME=$SERVICE_NAME
*/1 * * * * root flock -n /var/lock/znn-testnet-agent.lock /usr/local/bin/znn-testnet-agent
EOF
chmod 600 /etc/cron.d/znn-testnet-agent

systemctl restart "$SERVICE_NAME"
/usr/local/bin/znn-testnet-agent || true

echo "Zenon testnet node installed and configured."
`;
}

function historySample(report: NodeStatusReport): NodeStatusReport {
  return {
    ...report,
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
      if (!pillar) throw new Error("Invalid node status token");

      const latest: NodeStatusReport = {
        ...parsed.data,
        receivedAt: new Date().toISOString(),
        remoteAddress: request.ip
      };

      const history = [...(pillar.nodeStatus?.history ?? []), historySample(latest)].slice(-NODE_STATUS_HISTORY_LIMIT);
      pillar.nodeStatus = {
        latest,
        history
      };

      return {
        pillarName: pillar.pillarName,
        receivedAt: latest.receivedAt
      };
    });
    response.json({ ok: true, ...result });
  } catch (error: unknown) {
    response.status(401).json({ error: (error as Error).message });
  }
}

async function main() {
  await ensureSporkWallet();
  await ensurePillarStatusTokens();

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

  app.get(PUBLIC_NODE_PLAN_PATH, async (_request, response) => {
    const state = await readState();
    if (!state.publishedArtifacts?.nodePlan) {
      response.status(404).json({ error: "node-plan.json has not been published" });
      return;
    }
    sendJsonFile(response, state.publishedArtifacts.nodePlan);
  });

  app.post("/api/bootstrap/status", receiveNodeStatus);
  app.post("/api/node/status", receiveNodeStatus);

  app.get("/api/bootstrap/install.sh", (request, response) => {
    response.setHeader("Content-Type", "text/x-shellscript; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.send(bootstrapInstallScript(requestOrigin(request)));
  });

  app.get("/api/bootstrap/manifest", async (request, response) => {
    await withBootstrapPillar(request, response, (state, pillar) => {
      if (!state.publishedArtifacts?.nodePlan) {
        response.status(404).json({ error: "No published release is available yet" });
        return;
      }
      response.json(bootstrapManifest(request, state.publishedArtifacts, pillar));
    });
  });

  app.get("/api/bootstrap/pillar-config.json", async (request, response) => {
    await withBootstrapPillar(request, response, (state, pillar) => {
      if (!state.publishedArtifacts?.settings) {
        response.status(404).json({ error: "No published release is available yet" });
        return;
      }
      sendJsonFile(response, pillarConfigForDeployment(state.publishedArtifacts.settings, pillar));
    });
  });

  app.get("/api/bootstrap/producer.json", async (request, response) => {
    await withBootstrapPillar(request, response, (_state, pillar) => {
      sendJsonFile(response, pillar.producerWallet.keyFile);
    });
  });

  app.get("/api/bootstrap/producer-password.txt", async (request, response) => {
    await withBootstrapPillar(request, response, (_state, pillar) => {
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.send(`${producerPassword(pillar)}\n`);
    });
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
    response.json({
      user,
      pillar: pillar ? toPublicPillar(pillar) : undefined,
      bootstrap: pillar?.statusTokenCipher ? { statusToken: statusToken(pillar) } : undefined
    });
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
      const beforeGenesisSettings = genesisSettingsKey(state.settings);
      state.settings = {
        ...state.settings,
        ...parsed.data,
        minPillars: Math.min(parsed.data.minPillars, parsed.data.expectedPillars),
        goZenonCommit: parsed.data.goZenonCommit || undefined
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

      const settings = settingsSnapshot(state.settings);
      state.publishedArtifacts = {
        publishedAt: now,
        genesis,
        config: buildNodeConfig(settings),
        nodePlan: buildPublishedNodePlan(settings, now, state.finalizedGenesis.finalizedAt),
        settings,
        chainIdentifier: settings.chainIdentifier,
        seeders: [...settings.seeders]
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
