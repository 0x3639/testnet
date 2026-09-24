import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNodeConfig, finalizeBlockers } from "./genesis.js";
import { defaultGenesisTimestampSec } from "./storage.js";
import type { NetworkSettings, PillarRecord } from "../shared/types.js";

const NOW = 1_000_000;

const settings: NetworkSettings = {
  chainIdentifier: 1,
  extraData: "x",
  expectedPillars: 3,
  minPillars: 2,
  genesisTimestampSec: NOW + 3600,
  goZenonRepo: "https://github.com/zenon-network/go-zenon.git",
  goZenonRef: "master",
  deploymentRepo: "https://github.com/hypercore-one/deployment.git",
  deploymentRef: "main",
  wipeDataOnPublish: false,
  sporkAddress: "z1spork",
  seeders: [],
  bootstrapPeers: [],
  sporks: [],
  genesisFunds: [],
  sporkWallet: { address: "z1spork", keyFile: {}, passwordCipher: "c" }
};

function pillar(id: string): PillarRecord {
  const wallet = (address: string) => ({ address, keyFile: {}, passwordCipher: "c" });
  return {
    id,
    userId: "u",
    pillarName: id,
    pillarWallet: wallet(`${id}a`),
    rewardWallet: wallet(`${id}b`),
    producerWallet: wallet(`${id}c`),
    producerIndex: 0,
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("finalizeBlockers", () => {
  it("allows finalizing with enough pillars, a future genesis and a spork address", () => {
    assert.deepEqual(finalizeBlockers({ settings, pillars: [pillar("p1"), pillar("p2")] }, NOW), []);
  });

  it("refuses fewer pillars than the minimum", () => {
    const blockers = finalizeBlockers({ settings, pillars: [pillar("p1")] }, NOW);
    assert.equal(blockers.length, 1);
    assert.match(blockers[0], /at least 2 pillars .*\(1 registered\)/);
  });

  it("refuses a genesis time that has passed", () => {
    const blockers = finalizeBlockers({ settings: { ...settings, genesisTimestampSec: NOW }, pillars: [pillar("p1"), pillar("p2")] }, NOW);
    assert.equal(blockers.length, 1);
    assert.match(blockers[0], /in the past/);
  });

  it("refuses duplicate spork IDs", () => {
    const spork = { id: "ab".repeat(32), name: "a", description: "", activated: true, enforcementHeight: 0 };
    const sporks = [spork, { ...spork, name: "b", id: spork.id.toUpperCase() }];
    const blockers = finalizeBlockers({ settings: { ...settings, sporks }, pillars: [pillar("p1"), pillar("p2")] }, NOW);
    assert.equal(blockers.length, 1);
    assert.match(blockers[0], /duplicate spork ID/);
  });

  it("refuses a missing spork address", () => {
    const blockers = finalizeBlockers({ settings: { ...settings, sporkAddress: "" }, pillars: [pillar("p1"), pillar("p2")] }, NOW);
    assert.deepEqual(blockers, ["the spork address is missing"]);
  });

  it("lists every blocker at once", () => {
    const blockers = finalizeBlockers({ settings: { ...settings, sporkAddress: "", genesisTimestampSec: NOW - 1 }, pillars: [] }, NOW);
    assert.equal(blockers.length, 3);
  });
});

describe("defaultGenesisTimestampSec", () => {
  it("is a full hour at least 24 hours ahead", () => {
    const now = Date.parse("2026-09-13T18:36:12Z");
    const value = defaultGenesisTimestampSec(now);
    assert.equal(value % 3600, 0);
    assert.ok(value - Math.floor(now / 1000) >= 24 * 3600);
    assert.equal(new Date(value * 1000).toISOString(), "2026-09-14T19:00:00.000Z");
  });

  it("never lands short of 24 hours because of sub-second time", () => {
    const now = Date.parse("2026-09-13T18:00:00.999Z");
    const value = defaultGenesisTimestampSec(now);
    assert.ok(value * 1000 - now >= 24 * 3600_000);
    assert.equal(new Date(value * 1000).toISOString(), "2026-09-14T19:00:00.000Z");
  });
});

describe("buildNodeConfig RPC endpoints", () => {
  // go-zenon registers an API only when RPC.Endpoints names its exact namespace, and the embedded
  // APIs are namespaced "embedded.pillar", "embedded.token", ... so a bare "embedded" entry exposes
  // nothing (issue #15). An empty list is go-zenon's documented "expose every public API" setting.
  it("leaves the endpoint whitelist empty so every public namespace is exposed", () => {
    assert.deepEqual(buildNodeConfig(settings).RPC.Endpoints, []);
    assert.deepEqual(buildNodeConfig(settings, pillar("p1"), "pw").RPC.Endpoints, []);
  });
});
