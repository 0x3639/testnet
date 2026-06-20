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
  }
] as const;
