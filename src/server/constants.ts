export const DECIMALS = 100_000_000;

export const ZNN_ZTS = "zts1znnxxxxxxxxxxxxx9z4ulx";
export const QSR_ZTS = "zts1qsrxxxxxxxxxxxxxmrhjll";

export const PILLAR_CONTRACT = "z1qxemdeddedxpyllarxxxxxxxxxxxxxxxsy3fmg";
export const PLASMA_CONTRACT = "z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp";
export const TOKEN_CONTRACT = "z1qxemdeddedxt0kenxxxxxxxxxxxxxxxxh9amk0";
export const SWAP_CONTRACT = "z1qxemdeddedxswapxxxxxxxxxxxxxxxxxxl4yww";

export const PILLAR_STAKE_ZNN = 15_000;
export const PILLAR_LIQUID_ZNN = 50_000;
export const PILLAR_LIQUID_QSR = 500_000;
export const FUSED_QSR_PER_ADDRESS = 1_000;
// Bump when DEFAULT_SPORKS changes so mergeDefaultSporks can migrate stored drafts.
// Version 3 swapped the dynamic-plasma and libp2p placeholder IDs to match go-zenon (issue #13).
export const DEFAULT_SPORKS_VERSION = 3;

export const DEFAULT_GENESIS_FUNDS = [
  {
    address: "z1qpmvh8p6saaghwnakmryxrr3qtcg495dhnlmwg",
    znn: 100_000,
    qsr: 1_000_000,
    fusedQsr: 5_000
  }
];

// The placeholder IDs below must match common/types/spork.go in go-zenon exactly:
// nodes select a feature by spork ID, never by the human-readable name.
//   ...0001 = Libp2pSpork, ...0002 = DynamicPlasmaSpork
export const DEFAULT_SPORKS = [
  {
    id: "6d2b1e6cb4025f2f45533f0fe22e9b7ce2014d91cc960471045fa64eee5a6ba3",
    name: "Accelerator",
    description: "Enable Accelerator embedded contract behavior.",
    activated: true,
    enforcementHeight: 0
  },
  {
    id: "ceb7e3808ef17ea910adda2f3ab547be4cdfb54de8400ce3683258d06be1354b",
    name: "HTLC",
    description: "Enable HTLC embedded contract behavior.",
    activated: true,
    enforcementHeight: 0
  },
  {
    id: "ddd43466769461c5b5d109c639da0f50a7eeb96ad6e7274b1928a35c431d7b1b",
    name: "Bridge and Liquidity",
    description: "Enable bridge and liquidity embedded contract behavior.",
    activated: true,
    enforcementHeight: 0
  },
  {
    id: "0000000000000000000000000000000000000000000000000000000000000002",
    name: "dynamic-plasma",
    description: "Activates Dynamic Plasma",
    activated: false,
    enforcementHeight: 10
  },
  {
    id: "0000000000000000000000000000000000000000000000000000000000000001",
    name: "libp2p",
    description: "Activates the libp2p networking stack",
    activated: false,
    enforcementHeight: 20
  },
  {
    id: "0000000000000000000000000000000000000000000000000000000000000003",
    name: "governance",
    description: "Activates the governance stack",
    activated: false,
    enforcementHeight: 30
  }
] as const;
