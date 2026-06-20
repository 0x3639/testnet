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
  sporkAddress: string;
  sporkWallet?: StoredWallet;
  seeders: string[];
  sporks: SporkRecord[];
}

export type PublicNetworkSettings = Omit<NetworkSettings, "sporkWallet"> & {
  sporkWalletAddress?: string;
};

export interface AppState {
  users: StoredUser[];
  sessions: StoredSession[];
  pillars: PillarRecord[];
  settings: NetworkSettings;
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
}

export interface ReadinessCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface PublishedArtifacts {
  publishedAt: string;
  genesis: unknown;
  config: unknown;
  chainIdentifier: number;
  seeders: string[];
}

export interface PublishedArtifactsInfo {
  publishedAt: string;
  genesisPath: string;
  configPath: string;
  chainIdentifier: number;
  seeders: string[];
}

export interface AdminOverview {
  user: AuthUser;
  settings: PublicNetworkSettings;
  users: ManagedUser[];
  pillars: PublicPillar[];
  readiness: ReadinessCheck[];
  genesis: unknown;
  configTemplate: unknown;
  finalizedAt?: string;
  published?: PublishedArtifactsInfo;
}

export interface UserOverview {
  user: AuthUser;
  pillar?: PublicPillar;
}

export interface SeedNodeProbeResult {
  ip: string;
  rpcPort: number;
  p2pPort: number;
  publicKey: string;
  enode: string;
}
