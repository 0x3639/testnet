import cookieParser from "cookie-parser";
import express from "express";
import { createECDH } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { clearSessionCookie, login, logout, requireAuth, sessionTokenFromRequest, setSessionCookie, type AuthedRequest } from "./auth.js";
import { createAccount, resetAccountPassword } from "./accounts.js";
import { decryptText, encryptText, randomId, sha256 } from "./crypto.js";
import { buildGenesis, buildNodeConfig, readiness, toPublicPillar } from "./genesis.js";
import { buildPillarPackage, buildSeedNodePackage, buildSporkPackage } from "./packages.js";
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
  PublicNetworkSettings,
  SeedNodeRecord
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
  releaseApplyAtSec: z.number().int().positive().optional(),
  goZenonRepo: z.string().trim().min(1).max(300),
  goZenonRef: z.string().trim().min(1).max(160),
  goZenonCommit: z.string().trim().max(80).optional(),
  deploymentRepo: z.string().trim().min(1).max(300),
  deploymentRef: z.string().trim().min(1).max(160),
  wipeDataOnPublish: z.boolean().default(false),
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
      configSha256: optionalNullableText(256)
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
  const enode = `enode://${publicKey}@${publicIp}:${p2pPort}`;

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
      networkPrivateKeyCipher: encryptText(privateKey),
      ...createStatusTokenFields(),
      createdAt: new Date().toISOString()
    };
    state.seedNodes.push(record);
    state.settings.seeders = Array.from(new Set([...state.settings.seeders, enode]));
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
      Seeders: settings.seeders.filter((seeder) => seeder !== seedNode.enode)
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

function bootstrapInstallScript(origin: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script as root, usually via sudo." >&2
  exit 1
fi

: "\${ZNN_BOOTSTRAP_TOKEN:?Set ZNN_BOOTSTRAP_TOKEN to the node bootstrap token from the testnet builder.}"

BASE_URL="\${ZNN_TESTNET_URL:-${origin}}"
ZNN_DIR="\${ZNN_DIR:-/root/.znn}"
DEPLOYMENT_DIR="\${ZNN_DEPLOYMENT_DIR:-/opt/zenon-deployment}"
DEPLOYMENT_MIN_CPU_CORES="\${ZNN_DEPLOYMENT_MIN_CPU_CORES:-2}"
SERVICE_NAME="\${ZNN_SERVICE_NAME:-go-zenon}"
RPC_URL="\${ZNN_RPC_URL:-http://127.0.0.1:35997}"

if ! [[ "$DEPLOYMENT_MIN_CPU_CORES" =~ ^[0-9]+$ ]] || (( DEPLOYMENT_MIN_CPU_CORES < 1 )); then
  DEPLOYMENT_MIN_CPU_CORES=2
fi

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git jq util-linux
fi

cat > /usr/local/bin/znn-testnet-agent <<'AGENT'
#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="\${ZNN_AGENT_ENV_FILE:-/etc/cron.d/znn-testnet-agent}"
if [[ -z "\${ZNN_BOOTSTRAP_TOKEN:-}" && -r "$ENV_FILE" ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      ZNN_BOOTSTRAP_TOKEN|ZNN_TESTNET_URL|ZNN_DIR|ZNN_DEPLOYMENT_DIR|ZNN_DEPLOYMENT_MIN_CPU_CORES|ZNN_RPC_URL|ZNN_SERVICE_NAME|ZNN_AGENT_STATE_DIR)
        [[ -n "$value" ]] && export "$key=$value"
        ;;
    esac
  done < <(grep -E '^(ZNN_BOOTSTRAP_TOKEN|ZNN_TESTNET_URL|ZNN_DIR|ZNN_DEPLOYMENT_DIR|ZNN_DEPLOYMENT_MIN_CPU_CORES|ZNN_RPC_URL|ZNN_SERVICE_NAME|ZNN_AGENT_STATE_DIR)=' "$ENV_FILE" || true)
fi

: "\${ZNN_BOOTSTRAP_TOKEN:?Missing ZNN_BOOTSTRAP_TOKEN.}"

BASE_URL="\${ZNN_TESTNET_URL:-${origin}}"
ZNN_DIR="\${ZNN_DIR:-/root/.znn}"
DEPLOYMENT_DIR="\${ZNN_DEPLOYMENT_DIR:-/opt/zenon-deployment}"
DEPLOYMENT_MIN_CPU_CORES="\${ZNN_DEPLOYMENT_MIN_CPU_CORES:-2}"
RPC_URL="\${ZNN_RPC_URL:-http://127.0.0.1:35997}"
SERVICE_NAME="\${ZNN_SERVICE_NAME:-go-zenon}"
STATE_DIR="\${ZNN_AGENT_STATE_DIR:-/var/lib/znn-testnet-agent}"
INSTALL_STATE_FILE="$STATE_DIR/install-state.json"
STATUS_FILE="$STATE_DIR/status.json"

mkdir -p "$STATE_DIR"

if ! [[ "$DEPLOYMENT_MIN_CPU_CORES" =~ ^[0-9]+$ ]] || (( DEPLOYMENT_MIN_CPU_CORES < 1 )); then
  DEPLOYMENT_MIN_CPU_CORES=2
fi

auth_get() {
  curl -fsSL -H "Authorization: Bearer $ZNN_BOOTSTRAP_TOKEN" "$1"
}

try_auth_get() {
  local tmp code
  tmp="$(mktemp)"
  code="$(curl -sS -H "Authorization: Bearer $ZNN_BOOTSTRAP_TOKEN" -w "%{http_code}" -o "$tmp" "$1" || true)"
  if [[ "$code" == "200" ]]; then
    cat "$tmp"
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

rpc() {
  curl -fsS --max-time 5 -H "Content-Type: application/json" \\
    -d "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"$1\\",\\"params\\":[]}" \\
    "$RPC_URL" | jq -c '.result // {}'
}

wipe_data_dir() {
  local item base
  mkdir -p "$ZNN_DIR"
  shopt -s dotglob nullglob
  for item in "$ZNN_DIR"/*; do
    base="$(basename "$item")"
    case "$base" in
      wallet|genesis.json|config.json|network-private-key)
        continue
        ;;
    esac
    rm -rf -- "$item"
  done
  shopt -u dotglob nullglob
}

patch_deployment_preflight() {
  local preflight_file="$DEPLOYMENT_DIR/lib/preflight.sh"
  [[ -f "$preflight_file" ]] || return 0

  sed -i -E "s/cores < [0-9]+/cores < $DEPLOYMENT_MIN_CPU_CORES/" "$preflight_file"
  sed -i -E "s/Minimum [0-9]+ required\\./Minimum $DEPLOYMENT_MIN_CPU_CORES required./" "$preflight_file"
  sed -i -E '/mem_total_gb < [0-9]+/,/fi/ s/error_log "Total RAM \\$\\{mem_total_gb\\}GiB detected\\. Minimum [0-9]+GiB required\\."/warn_log "Total RAM \\\${mem_total_gb}GiB detected. 4GiB recommended for go-zenon builds."/' "$preflight_file"
  sed -i -E '/mem_total_gb < [0-9]+/,/fi/ s/^[[:space:]]*return 1[[:space:]]*$/:/' "$preflight_file"
  echo "Deployment CPU pre-flight minimum: $DEPLOYMENT_MIN_CPU_CORES core(s)"
  echo "Deployment RAM pre-flight: warning only (4GiB recommended)"
  grep -E 'cores <|Minimum [0-9]+ required|mem_total_gb <|Total RAM|4GiB recommended' "$preflight_file" || true
}

install_release() {
  local manifest="$1"
  local event_id node_type go_repo go_ref go_commit deployment_repo deployment_ref genesis_url config_url producer_url producer_password_url network_private_key_url wipe_data apply_at desired_key installed_key binary_key installed_binary_key binary_missing artifacts_ready

  event_id="$(printf '%s' "$manifest" | jq -r '.eventId')"
  node_type="$(printf '%s' "$manifest" | jq -r '.nodeType // "pillar"')"
  go_repo="$(printf '%s' "$manifest" | jq -r '.goZenon.repoUrl')"
  go_ref="$(printf '%s' "$manifest" | jq -r '.goZenon.ref')"
  go_commit="$(printf '%s' "$manifest" | jq -r '.goZenon.commit // empty')"
  deployment_repo="$(printf '%s' "$manifest" | jq -r '.deployment.repoUrl')"
  deployment_ref="$(printf '%s' "$manifest" | jq -r '.deployment.ref')"
  wipe_data="$(printf '%s' "$manifest" | jq -r '.actions.wipeData // false')"
  apply_at="$(printf '%s' "$manifest" | jq -r '.actions.applyAt // empty')"
  genesis_url="$(printf '%s' "$manifest" | jq -r '.genesisUrl')"
  config_url="$(printf '%s' "$manifest" | jq -r '.configUrl')"
  producer_url="$(printf '%s' "$manifest" | jq -r '.producerKeyFileUrl // empty')"
  producer_password_url="$(printf '%s' "$manifest" | jq -r '.producerPasswordUrl // empty')"
  network_private_key_url="$(printf '%s' "$manifest" | jq -r '.networkPrivateKeyUrl // empty')"
  desired_key="$(printf '%s' "$manifest" | jq -r '[.eventId, (.nodeType // "pillar"), .goZenon.repoUrl, .goZenon.ref, (.goZenon.commit // ""), .deployment.repoUrl, .deployment.ref, (.actions.wipeData // false), (.actions.applyAt // "")] | @tsv')"
  binary_key="$(printf '%s' "$manifest" | jq -r '[.goZenon.repoUrl, .goZenon.ref, (.goZenon.commit // ""), .deployment.repoUrl, .deployment.ref] | @tsv')"
  installed_key="$(jq -r '.desiredKey // empty' "$INSTALL_STATE_FILE" 2>/dev/null || true)"
  installed_binary_key="$(jq -r '.binaryKey // empty' "$INSTALL_STATE_FILE" 2>/dev/null || true)"
  binary_missing=false
  if ! command -v znnd >/dev/null 2>&1; then
    binary_missing=true
  fi

  artifacts_ready=false
  if [[ -s "$ZNN_DIR/genesis.json" && -s "$ZNN_DIR/config.json" ]]; then
    if [[ "$node_type" == "seed" && -s "$ZNN_DIR/network-private-key" ]]; then
      artifacts_ready=true
    elif [[ "$node_type" != "seed" && -s "$ZNN_DIR/wallet/producer.json" && -s "$ZNN_DIR/wallet/producer-password.txt" ]]; then
      artifacts_ready=true
    fi
  fi

  if [[ "$desired_key" == "$installed_key" && "$artifacts_ready" == "true" ]]; then
    return 0
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi

  if [[ "$binary_key" != "$installed_binary_key" || "$binary_missing" == "true" ]]; then
    rm -rf "$DEPLOYMENT_DIR"
    git clone --depth 1 --branch "$deployment_ref" "$deployment_repo" "$DEPLOYMENT_DIR"
    chmod +x "$DEPLOYMENT_DIR/zenon.sh"
    patch_deployment_preflight

    cd "$DEPLOYMENT_DIR"
    if ! ./zenon.sh --deploy zenon "$go_repo" "$go_ref"; then
      echo "zenon.sh deployment failed. Last deployment log lines:" >&2
      tail -120 "$DEPLOYMENT_DIR/.znnsh.log" >&2 2>/dev/null || true
      return 1
    fi

    if command -v systemctl >/dev/null 2>&1; then
      systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    fi
  fi

  if [[ "$wipe_data" == "true" ]]; then
    wipe_data_dir
  fi

  mkdir -p "$ZNN_DIR/wallet"
  auth_get "$genesis_url" > "$ZNN_DIR/genesis.json"
  auth_get "$config_url" > "$ZNN_DIR/config.json"
  if [[ -n "$producer_url" ]]; then
    auth_get "$producer_url" > "$ZNN_DIR/wallet/producer.json"
  fi
  if [[ -n "$producer_password_url" ]]; then
    auth_get "$producer_password_url" > "$ZNN_DIR/wallet/producer-password.txt"
  fi
  if [[ -n "$network_private_key_url" ]]; then
    auth_get "$network_private_key_url" > "$ZNN_DIR/network-private-key"
  fi

  chmod 700 "$ZNN_DIR" "$ZNN_DIR/wallet"
  chmod 600 "$ZNN_DIR/genesis.json" "$ZNN_DIR/config.json"
  [[ -f "$ZNN_DIR/wallet/producer.json" ]] && chmod 600 "$ZNN_DIR/wallet/producer.json"
  [[ -f "$ZNN_DIR/wallet/producer-password.txt" ]] && chmod 600 "$ZNN_DIR/wallet/producer-password.txt"
  [[ -f "$ZNN_DIR/network-private-key" ]] && chmod 600 "$ZNN_DIR/network-private-key"

  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart "$SERVICE_NAME"
  fi

  jq -n \\
    --arg desiredKey "$desired_key" \\
    --arg binaryKey "$binary_key" \\
    --arg eventId "$event_id" \\
    --arg installedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
    --arg goRepo "$go_repo" \\
    --arg goRef "$go_ref" \\
    --arg goCommit "$go_commit" \\
    --arg deploymentRepo "$deployment_repo" \\
    --arg deploymentRef "$deployment_ref" \\
    --arg nodeType "$node_type" \\
    --arg applyAt "$apply_at" \\
    --argjson wipeData "$wipe_data" \\
    '{
      desiredKey: $desiredKey,
      binaryKey: $binaryKey,
      eventId: $eventId,
      installedAt: $installedAt,
      nodeType: $nodeType,
      goZenon: { repoUrl: $goRepo, ref: $goRef, commit: $goCommit },
      deployment: { repoUrl: $deploymentRepo, ref: $deploymentRef },
      actions: ({ wipeData: $wipeData } + (if $applyAt == "" then {} else { applyAt: $applyAt } end))
    }' > "$INSTALL_STATE_FILE"
}

report_status() {
  local manifest="\${1:-}"
  local waiting="\${2:-false}"
  local event_id go_repo go_ref go_commit sync_json network_json process_json service_active logs error_count warn_count recent_json payload

  if [[ -n "$manifest" ]]; then
    event_id="$(printf '%s' "$manifest" | jq -r '.eventId')"
    go_repo="$(printf '%s' "$manifest" | jq -r '.goZenon.repoUrl')"
    go_ref="$(printf '%s' "$manifest" | jq -r '.goZenon.ref')"
    go_commit="$(printf '%s' "$manifest" | jq -r '.goZenon.commit // empty')"
  else
    event_id="waiting-for-release"
    go_repo=""
    go_ref=""
    go_commit=""
  fi

  sync_json="$(rpc stats.syncInfo || echo '{}')"
  network_json="$(rpc stats.networkInfo || echo '{}')"
  process_json="$(rpc stats.processInfo || echo '{}')"
  service_active=false
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$SERVICE_NAME"; then
    service_active=true
  fi

  logs="$(journalctl -u "$SERVICE_NAME" --since '1 minute ago' --no-pager 2>/dev/null | grep -Eai 'error|warn|panic|fatal|failed|exception' | tail -20 || true)"
  error_count="$(printf '%s\\n' "$logs" | grep -Eai 'error|panic|fatal|failed|exception' | grep -c . || true)"
  warn_count="$(printf '%s\\n' "$logs" | grep -Eai 'warn' | grep -c . || true)"
  recent_json="$(printf '%s\\n' "$logs" | jq -R . | jq -s .)"

  payload="$(jq -n \\
    --arg eventId "$event_id" \\
    --arg reportedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
    --arg hostname "$(hostname)" \\
    --arg goRepo "$go_repo" \\
    --arg goRef "$go_ref" \\
    --arg goCommit "$go_commit" \\
    --argjson serviceActive "$service_active" \\
    --argjson waiting "$waiting" \\
    --argjson sync "$sync_json" \\
    --argjson network "$network_json" \\
    --argjson process "$process_json" \\
    --argjson errors "$error_count" \\
    --argjson warnings "$warn_count" \\
    --argjson recent "$recent_json" \\
    '{
      eventId: $eventId,
      reportedAt: $reportedAt,
      node: {
        hostname: $hostname,
        serviceActive: $serviceActive,
        waitingForRelease: $waiting,
        installedRepo: $goRepo,
        installedRef: $goRef,
        installedCommit: $goCommit
      },
      sync: ({
      } + (if ($sync.state // null) == null then {} else { state: $sync.state } end)
        + (if ($sync.currentHeight // null) == null then {} else { currentHeight: $sync.currentHeight } end)
        + (if ($sync.targetHeight // null) == null then {} else { targetHeight: $sync.targetHeight } end)),
      network: ({
        peerCount: (($network.peers // []) | length)
      } + (if ($network.self.publicKey // null) == null then {} else { selfPublicKey: $network.self.publicKey } end)
        + (if ($network.self.ip // null) == null then {} else { selfIp: $network.self.ip } end)
        + {
          peers: (($network.peers // []) | map(
            {}
            + (if (.publicKey // null) == null then {} else { publicKey: .publicKey } end)
            + (if (.ip // null) == null then {} else { ip: .ip } end)
            + (if (.name // null) == null then {} else { name: .name } end)
            + (if (.version // null) == null then {} else { version: .version } end)
          ) | .[0:20])
        }),
      process: ({
      } + (if ($process.version // null) == null then {} else { version: $process.version } end)
        + (if ($process.commit // null) == null then {} else { commit: $process.commit } end)),
      logs: {
        errorCountLastMinute: $errors,
        warningCountLastMinute: $warnings,
        recent: $recent
      }
    }')"

  curl -fsS -X POST "$BASE_URL/api/bootstrap/status" \\
    -H "Authorization: Bearer $ZNN_BOOTSTRAP_TOKEN" \\
    -H "Content-Type: application/json" \\
    -d "$payload" >/dev/null || true

  printf '%s\\n' "$payload" > "$STATUS_FILE"
}

manifest="$(try_auth_get "$BASE_URL/api/bootstrap/manifest" || true)"
if [[ -z "$manifest" ]]; then
  report_status "" true
  echo "No published release is available yet. Waiting for Publish Release."
  exit 0
fi

apply_at="$(printf '%s' "$manifest" | jq -r '.actions.applyAt // empty')"
if [[ -n "$apply_at" ]]; then
  apply_at_epoch="$(date -u -d "$apply_at" +%s 2>/dev/null || echo 0)"
  now_epoch="$(date -u +%s)"
  if [[ "$apply_at_epoch" =~ ^[0-9]+$ ]] && (( apply_at_epoch > now_epoch )); then
    report_status "$manifest" true
    echo "Published release applies at $apply_at. Waiting."
    exit 0
  fi
fi

if ! install_release "$manifest"; then
  report_status "$manifest" false
  exit 1
fi
report_status "$manifest" false
AGENT

chmod 700 /usr/local/bin/znn-testnet-agent

cat > /etc/cron.d/znn-testnet-agent <<EOF
ZNN_BOOTSTRAP_TOKEN=$ZNN_BOOTSTRAP_TOKEN
ZNN_TESTNET_URL=$BASE_URL
ZNN_DEPLOYMENT_MIN_CPU_CORES=$DEPLOYMENT_MIN_CPU_CORES
ZNN_RPC_URL=$RPC_URL
ZNN_SERVICE_NAME=$SERVICE_NAME
*/1 * * * * root flock -n /var/lock/znn-testnet-agent.lock /usr/local/bin/znn-testnet-agent
EOF
chmod 600 /etc/cron.d/znn-testnet-agent

flock -n /var/lock/znn-testnet-agent.lock /usr/local/bin/znn-testnet-agent || true

echo "Zenon testnet bootstrap installed. The agent will apply the release after Publish Release."
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
      const seedNode = state.seedNodes.find((candidate) => candidate.statusTokenHash === tokenHash);
      const target = pillar ?? seedNode;
      if (!target) throw new Error("Invalid node status token");

      const latest: NodeStatusReport = {
        ...parsed.data,
        receivedAt: new Date().toISOString(),
        remoteAddress: request.ip
      };

      const history = [...(target.nodeStatus?.history ?? []), historySample(latest)].slice(-NODE_STATUS_HISTORY_LIMIT);
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
    await withBootstrapNode(request, response, (state, node) => {
      if (!state.publishedArtifacts?.nodePlan) {
        response.status(404).json({ error: "No published release is available yet" });
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
        const deletedSeedEnodes = state.seedNodes.filter((seedNode) => seedNode.userId === user.id).map((seedNode) => seedNode.enode);
        state.users = state.users.filter((candidate) => candidate.id !== user.id);
        state.sessions = state.sessions.filter((session) => session.userId !== user.id);
        state.pillars = state.pillars.filter((pillar) => pillar.userId !== user.id);
        state.seedNodes = state.seedNodes.filter((seedNode) => seedNode.userId !== user.id);
        if (deletedSeedEnodes.length) {
          state.settings.seeders = state.settings.seeders.filter((seeder) => !deletedSeedEnodes.includes(seeder));
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
      state.settings.wipeDataOnPublish = false;
      state.settings.releaseApplyAtSec = undefined;
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
