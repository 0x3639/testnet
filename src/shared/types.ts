export type Role = "user" | "admin";

export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
}

export interface StoredSession {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

export interface StoredWallet {
  address: string;
  keyFile: unknown;
  passwordCipher: string;
}

export interface PillarRecord {
  id: string;
  userId: string;
  pillarName: string;
  pillarWallet: StoredWallet;
  rewardWallet: StoredWallet;
  producerWallet: StoredWallet;
  producerIndex: number;
  statusTokenHash?: string;
  statusTokenCipher?: string;
  nodeStatus?: PillarNodeStatus;
  packageDownloadedAt?: string;
  createdAt: string;
}

export interface SeedNodeRecord {
  id: string;
  userId: string;
  nodeName: string;
  publicIp: string;
  p2pPort: number;
  publicKey: string;
  enode: string;
  networkPrivateKeyCipher: string;
  statusTokenHash?: string;
  statusTokenCipher?: string;
  nodeStatus?: PillarNodeStatus;
  packageDownloadedAt?: string;
  createdAt: string;
}

export interface SporkRecord {
  id: string;
  name: string;
  description: string;
  activated: boolean;
  enforcementHeight: number;
}

export interface NetworkSettings {
  chainIdentifier: number;
  extraData: string;
  expectedPillars: number;
  minPillars: number;
  genesisTimestampSec: number;
  goZenonRepo: string;
  goZenonRef: string;
  goZenonCommit?: string;
  deploymentRepo: string;
  deploymentRef: string;
  releaseApplyAtSec?: number;
  wipeDataOnPublish: boolean;
  sporkAddress: string;
  sporkWallet?: StoredWallet;
  seeders: string[];
  sporks: SporkRecord[];
}

export type PublicNetworkSettings = Omit<NetworkSettings, "sporkWallet"> & {
  sporkWalletAddress?: string;
};

export type NetworkSettingsSnapshot = Omit<NetworkSettings, "sporkWallet">;

export interface AppState {
  users: StoredUser[];
  sessions: StoredSession[];
  pillars: PillarRecord[];
  seedNodes: SeedNodeRecord[];
  settings: NetworkSettings;
  defaultSporksVersion?: number;
  finalizedGenesis?: {
    finalizedAt: string;
    genesis: unknown;
  };
  publishedArtifacts?: PublishedArtifacts;
}

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

export interface ManagedUser extends AuthUser {
  createdAt: string;
  pillarName?: string;
  nodeName?: string;
  nodeType?: "pillar" | "seed";
}

export interface PublicPillar {
  id: string;
  pillarName: string;
  pillarAddress: string;
  rewardAddress: string;
  producerAddress: string;
  producerIndex: number;
  createdAt: string;
  packageDownloadedAt?: string;
  nodeStatus?: PublicNodeStatus;
}

export interface PublicSeedNode {
  id: string;
  userId: string;
  nodeName: string;
  publicIp: string;
  p2pPort: number;
  publicKey: string;
  enode: string;
  createdAt: string;
  packageDownloadedAt?: string;
  nodeStatus?: PublicNodeStatus;
}

export interface ReadinessCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface ReleaseTarget {
  goZenon: {
    repoUrl: string;
    ref: string;
    commit?: string;
  };
  deployment: {
    repoUrl: string;
    ref: string;
  };
}

export interface ReleaseActions {
  wipeData: boolean;
  applyAt?: string;
}

export interface PublishedNodePlan extends ReleaseTarget {
  schemaVersion: number;
  eventId: string;
  publishedAt: string;
  finalizedAt?: string;
  genesisStartAt: string;
  actions: ReleaseActions;
}

export interface PublishedArtifacts {
  publishedAt: string;
  genesis: unknown;
  config: unknown;
  nodePlan?: PublishedNodePlan;
  settings?: NetworkSettingsSnapshot;
  chainIdentifier: number;
  seeders: string[];
}

export interface PublishedArtifactsInfo {
  publishedAt: string;
  genesisPath: string;
  configPath: string;
  nodePlanPath?: string;
  chainIdentifier: number;
  seeders: string[];
  genesisStartAt?: string;
  release?: ReleaseTarget;
  actions?: ReleaseActions;
}

export interface NodePeerSummary {
  publicKey?: string;
  ip?: string;
  name?: string;
  version?: string;
}

export interface NodeProcessInfo {
  version?: string;
  commit?: string;
}

export interface NodeStatusReport {
  eventId?: string;
  reportedAt?: string;
  receivedAt: string;
  remoteAddress?: string;
  node?: {
    hostname?: string;
    serviceActive?: boolean;
    waitingForRelease?: boolean;
    installedRepo?: string;
    installedRef?: string;
    installedCommit?: string;
    genesisSha256?: string;
    configSha256?: string;
  };
  sync?: {
    state?: number;
    currentHeight?: number;
    targetHeight?: number;
  };
  network?: {
    peerCount?: number;
    selfPublicKey?: string;
    selfIp?: string;
    peers?: NodePeerSummary[];
  };
  process?: NodeProcessInfo;
  logs?: {
    errorCountLastMinute?: number;
    warningCountLastMinute?: number;
    recent?: string[];
  };
}

export interface PillarNodeStatus {
  latest?: NodeStatusReport;
  history: NodeStatusReport[];
}

export interface PublicNodeStatus {
  latest?: NodeStatusReport;
  historyCount: number;
}

export interface AdminOverview {
  user: AuthUser;
  settings: PublicNetworkSettings;
  users: ManagedUser[];
  pillars: PublicPillar[];
  seedNodes: PublicSeedNode[];
  readiness: ReadinessCheck[];
  genesis: unknown;
  configTemplate: unknown;
  finalizedAt?: string;
  published?: PublishedArtifactsInfo;
}

export interface UserOverview {
  user: AuthUser;
  pillar?: PublicPillar;
  seedNode?: PublicSeedNode;
  bootstrap?: {
    statusToken: string;
  };
}

export interface SeedNodeProbeResult {
  ip: string;
  rpcPort: number;
  p2pPort: number;
  publicKey: string;
  enode: string;
}
