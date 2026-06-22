import {
  DECIMALS,
  FUSED_QSR_PER_ADDRESS,
  PILLAR_CONTRACT,
  PILLAR_LIQUID_QSR,
  PILLAR_LIQUID_ZNN,
  PILLAR_STAKE_ZNN,
  PLASMA_CONTRACT,
  QSR_ZTS,
  SWAP_CONTRACT,
  TOKEN_CONTRACT,
  ZNN_ZTS
} from "./constants.js";
import { stableHashHex } from "./crypto.js";
import type { AppState, NetworkSettings, PillarRecord, PublicPillar, ReadinessCheck } from "../shared/types.js";

function units(amount: number): number {
  return amount * DECIMALS;
}

function publicPillar(record: PillarRecord): PublicPillar {
  return {
    id: record.id,
    pillarName: record.pillarName,
    pillarAddress: record.pillarWallet.address,
    rewardAddress: record.rewardWallet.address,
    producerAddress: record.producerWallet.address,
    producerIndex: record.producerIndex,
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

export function toPublicPillar(record: PillarRecord): PublicPillar {
  return publicPillar(record);
}

function balanceBlock(address: string, balanceList: Record<string, number>) {
  return {
    Address: address,
    BalanceList: balanceList
  };
}

function fusion(owner: string, beneficiary: string, idSeed: string) {
  return {
    owner,
    id: stableHashHex(idSeed),
    amount: units(FUSED_QSR_PER_ADDRESS),
    withdrawHeight: 0,
    beneficiaryAddress: beneficiary
  };
}

export function buildGenesis(settings: NetworkSettings, pillars: PillarRecord[]) {
  const activePillars = [...pillars].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pillarCount = activePillars.length;
  const pillarStakeTotal = units(PILLAR_STAKE_ZNN) * pillarCount;
  const liquidZnnTotal = units(PILLAR_LIQUID_ZNN) * pillarCount;
  const liquidQsrTotal = units(PILLAR_LIQUID_QSR) * pillarCount;
  const fusionTotal = units(FUSED_QSR_PER_ADDRESS) * 3 * pillarCount;

  const blocks = [
    balanceBlock(PILLAR_CONTRACT, {
      [ZNN_ZTS]: pillarStakeTotal
    }),
    balanceBlock(PLASMA_CONTRACT, {
      [QSR_ZTS]: fusionTotal
    }),
    balanceBlock(SWAP_CONTRACT, {
      [ZNN_ZTS]: 0,
      [QSR_ZTS]: 0
    }),
    ...activePillars.map((pillar) =>
      balanceBlock(pillar.pillarWallet.address, {
        [ZNN_ZTS]: units(PILLAR_LIQUID_ZNN),
        [QSR_ZTS]: units(PILLAR_LIQUID_QSR)
      })
    )
  ];

  return {
    ChainIdentifier: settings.chainIdentifier,
    ExtraData: settings.extraData,
    SporkAddress: settings.sporkAddress,
    GenesisTimestampSec: settings.genesisTimestampSec,
    PillarConfig: {
      Pillars: activePillars.map((pillar) => ({
        Name: pillar.pillarName,
        BlockProducingAddress: pillar.producerWallet.address,
        RewardWithdrawAddress: pillar.rewardWallet.address,
        StakeAddress: pillar.pillarWallet.address,
        Amount: units(PILLAR_STAKE_ZNN),
        RegistrationTime: settings.genesisTimestampSec,
        RevokeTime: 0,
        GiveBlockRewardPercentage: 0,
        GiveDelegateRewardPercentage: 100,
        PillarType: 1
      })),
      Delegations: activePillars.map((pillar) => ({
        Backer: pillar.pillarWallet.address,
        Name: pillar.pillarName
      })),
      LegacyEntries: []
    },
    PlasmaConfig: {
      Fusions: activePillars.flatMap((pillar) => [
        fusion(pillar.producerWallet.address, pillar.producerWallet.address, `${pillar.id}:producer`),
        fusion(pillar.pillarWallet.address, pillar.pillarWallet.address, `${pillar.id}:pillar`),
        fusion(pillar.rewardWallet.address, pillar.rewardWallet.address, `${pillar.id}:reward`)
      ])
    },
    SporkConfig: {
      Sporks: settings.sporks.map((spork) => ({
        id: spork.id,
        name: spork.name,
        description: spork.description,
        activated: spork.activated,
        enforcementHeight: spork.enforcementHeight
      }))
    },
    TokenConfig: {
      Tokens: [
        {
          decimals: 8,
          isBurnable: true,
          isMintable: true,
          isUtility: true,
          maxSupply: Number.MAX_SAFE_INTEGER,
          owner: TOKEN_CONTRACT,
          tokenDomain: "zenon.network",
          tokenName: "ZNN",
          tokenStandard: ZNN_ZTS,
          tokenSymbol: "ZNN",
          totalSupply: pillarStakeTotal + liquidZnnTotal
        },
        {
          decimals: 8,
          isBurnable: true,
          isMintable: true,
          isUtility: true,
          maxSupply: Number.MAX_SAFE_INTEGER,
          owner: TOKEN_CONTRACT,
          tokenDomain: "zenon.network",
          tokenName: "QSR",
          tokenStandard: QSR_ZTS,
          tokenSymbol: "QSR",
          totalSupply: fusionTotal + liquidQsrTotal
        }
      ]
    },
    SwapConfig: {
      Entries: []
    },
    GenesisBlocks: {
      Blocks: blocks
    }
  };
}

export function buildNodeConfig(
  settings: NetworkSettings,
  pillar?: PillarRecord,
  producerPassword?: string,
  paths: {
    dataPath?: string;
    walletPath?: string;
    genesisFile?: string;
    producerKeyFilePath?: string;
  } = {}
) {
  const dataPath = paths.dataPath ?? "/var/lib/znn";
  const walletPath = paths.walletPath ?? `${dataPath}/wallet`;
  return {
    DataPath: dataPath,
    WalletPath: walletPath,
    GenesisFile: paths.genesisFile ?? `${dataPath}/genesis.json`,
    Name: pillar?.pillarName ?? "zenon-testnet-node",
    LogLevel: "info",
    Producer: pillar
      ? {
          Address: pillar.producerWallet.address,
          Index: pillar.producerIndex,
          KeyFilePath: paths.producerKeyFilePath ?? `${walletPath}/producer.json`,
          Password: producerPassword ?? "<producer-password>"
        }
      : undefined,
    RPC: {
      EnableHTTP: true,
      EnableWS: true,
      HTTPHost: "0.0.0.0",
      HTTPPort: 35997,
      WSHost: "0.0.0.0",
      WSPort: 35998,
      HTTPCors: ["*"],
      WSOrigins: ["*"],
      Endpoints: ["ledger", "stats", "embedded", "subscribe"]
    },
    Net: {
      ListenHost: "0.0.0.0",
      ListenPort: 35995,
      MinPeers: settings.minPillars,
      MinConnectedPeers: settings.minPillars,
      MaxPeers: Math.max(settings.expectedPillars * 2, 8),
      MaxPendingPeers: Math.max(settings.expectedPillars, 4),
      Seeders: settings.seeders,
      BootstrapPeers: settings.bootstrapPeers ?? []
    }
  };
}

export function readiness(state: AppState): ReadinessCheck[] {
  const pillarCount = state.pillars.length;
  return [
    {
      label: "Minimum pillars",
      ok: pillarCount >= state.settings.minPillars,
      detail: `${pillarCount}/${state.settings.minPillars} registered`
    },
    {
      label: "Expected pillars",
      ok: pillarCount === state.settings.expectedPillars,
      detail: `${pillarCount}/${state.settings.expectedPillars} registered`
    },
    {
      label: "Spork address",
      ok: Boolean(state.settings.sporkAddress),
      detail: state.settings.sporkAddress || "Missing"
    },
    {
      label: "Active sporks",
      ok: state.settings.sporks.some((spork) => spork.activated),
      detail: `${state.settings.sporks.filter((spork) => spork.activated).length}/${state.settings.sporks.length} activated`
    },
    {
      label: "Seeders",
      ok: state.settings.seeders.length > 0,
      detail: state.settings.seeders.length ? `${state.settings.seeders.length} configured` : "Can be filled in after operators expose nodes"
    },
    {
      label: "Bootstrap peers",
      ok: (state.settings.bootstrapPeers ?? []).length > 0,
      detail: (state.settings.bootstrapPeers ?? []).length
        ? `${(state.settings.bootstrapPeers ?? []).length} configured`
        : "Required for libp2p after activation"
    }
  ];
}
