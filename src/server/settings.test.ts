import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publishInputsKey, publishSnapshotKey, settingsSnapshot } from "./settings.js";
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
