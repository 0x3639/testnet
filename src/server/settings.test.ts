import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { genesisSettingsKey, publishInputsKey, publishSnapshotKey, settingsSnapshot } from "./settings.js";
import type { NetworkSettings, PillarRecord } from "../shared/types.js";

const base: NetworkSettings = {
  chainIdentifier: 1,
  extraData: "x",
  expectedPillars: 4,
  minPillars: 3,
  genesisTimestampSec: 100,
  goZenonRepo: "https://github.com/zenon-network/go-zenon.git",
  goZenonRef: "master",
  deploymentRepo: "https://github.com/hypercore-one/deployment.git",
  deploymentRef: "main",
  wipeDataOnPublish: false,
  sporkAddress: "z1",
  seeders: [],
  bootstrapPeers: [],
  sporks: [],
  genesisFunds: [],
  sporkWallet: { address: "z1", keyFile: {}, passwordCipher: "c" }
};

describe("publish snapshot", () => {
  it("excludes the spork wallet", () => {
    assert.equal("sporkWallet" in settingsSnapshot(base), false);
    assert.equal(publishSnapshotKey(base), publishSnapshotKey({ ...base, sporkWallet: { address: "z2", keyFile: {}, passwordCipher: "d" } }));
  });

  it("changes when any published field changes", () => {
    const key = publishSnapshotKey(base);
    for (const change of [
      { wipeDataOnPublish: true },
      { releaseApplyAtSec: 5 },
      { genesisTimestampSec: 101 },
      { seeders: ["enode://x"] },
      { goZenonCommit: "a".repeat(40) },
      { sporks: [{ id: "0".repeat(64), name: "n", description: "", activated: true, enforcementHeight: 0 }] }
    ] as Partial<NetworkSettings>[]) {
      assert.notEqual(publishSnapshotKey({ ...base, ...change }), key, JSON.stringify(change));
    }
  });
});

describe("genesis settings key", () => {
  it("changes for every input baked into genesis.json", () => {
    const key = genesisSettingsKey(base);
    for (const change of [
      { chainIdentifier: 2 },
      { extraData: "y" },
      { sporkAddress: "z2" },
      { genesisTimestampSec: 101 },
      { sporks: [{ id: "0".repeat(64), name: "n", description: "", activated: true, enforcementHeight: 0 }] },
      { genesisFunds: [{ address: "z3", znn: 1, qsr: 0, fusedQsr: 0 }] }
    ] as Partial<NetworkSettings>[]) {
      assert.notEqual(genesisSettingsKey({ ...base, ...change }), key, JSON.stringify(change));
    }
  });

  it("ignores settings that only reach config.json or the readiness checks", () => {
    const key = genesisSettingsKey(base);
    for (const change of [
      { seeders: ["enode://x"] },
      { bootstrapPeers: ["/ip4/1.2.3.4/tcp/1"] },
      { minPillars: 1 },
      { expectedPillars: 9 },
      { goZenonRef: "v1" },
      { wipeDataOnPublish: true }
    ] as Partial<NetworkSettings>[]) {
      assert.equal(genesisSettingsKey({ ...base, ...change }), key, JSON.stringify(change));
    }
  });
});

describe("publish inputs key", () => {
  const wallet = (address: string) => ({ address, keyFile: {}, passwordCipher: "c" });
  const pillar: PillarRecord = {
    id: "p1",
    userId: "u1",
    pillarName: "one",
    pillarWallet: wallet("z1a"),
    rewardWallet: wallet("z1b"),
    producerWallet: wallet("z1c"),
    producerIndex: 0,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  const state = { settings: base, pillars: [pillar], finalizedGenesis: undefined };

  it("changes when a pillar is registered or the genesis is finalized", () => {
    const key = publishInputsKey(state);
    assert.notEqual(publishInputsKey({ ...state, pillars: [] }), key);
    assert.notEqual(publishInputsKey({ ...state, pillars: [pillar, { ...pillar, id: "p2", pillarName: "two" }] }), key);
    assert.notEqual(publishInputsKey({ ...state, finalizedGenesis: { finalizedAt: "t", genesis: { x: 1 } } }), key);
    assert.notEqual(publishInputsKey({ ...state, settings: { ...base, wipeDataOnPublish: true } }), key);
  });

  it("ignores node telemetry and download timestamps", () => {
    const key = publishInputsKey(state);
    const busy: PillarRecord = {
      ...pillar,
      packageDownloadedAt: "later",
      nodeStatus: { latest: { receivedAt: "now" }, history: [] }
    };
    assert.equal(publishInputsKey({ ...state, pillars: [busy] }), key);
  });
});
