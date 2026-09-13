import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminOverview, PublicNetworkSettings, PublicPillar } from "../../shared/types";
import { evaluatePlaybook, parsePlaybookId, type PlaybookInput } from "./playbooks";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const HOUR = 3600;
const COMMIT = "9cde165877a1e4ff47d0df6cf8b8a65b121d550c";

function settings(overrides: Partial<PublicNetworkSettings> = {}): PublicNetworkSettings {
  return {
    chainIdentifier: 1,
    extraData: "x",
    expectedPillars: 3,
    minPillars: 2,
    genesisTimestampSec: Math.floor(NOW / 1000) + HOUR,
    goZenonRepo: "https://github.com/zenon-network/go-zenon.git",
    goZenonRef: "master",
    deploymentRepo: "https://github.com/hypercore-one/deployment.git",
    deploymentRef: "main",
    wipeDataOnPublish: false,
    sporkAddress: "z1",
    seeders: ["enode://a"],
    bootstrapPeers: [],
    sporks: [],
    genesisFunds: [],
    ...overrides
  };
}

function pillar(name: string, online: boolean, commit = COMMIT): PublicPillar {
  return {
    id: name,
    pillarName: name,
    pillarAddress: "",
    rewardAddress: "",
    producerAddress: "",
    producerIndex: 0,
    createdAt: "",
    nodeStatus: online
      ? { latest: { receivedAt: new Date(NOW - 10_000).toISOString(), sync: { state: 2 }, node: { serviceActive: true }, process: { commit } }, historyCount: 1 }
      : undefined
  };
}

function overview(overrides: Partial<AdminOverview> = {}): AdminOverview {
  const s = settings();
  return {
    user: { id: "a", username: "admin", role: "admin" },
    settings: s,
    repoPolicy: { allowedHosts: ["github.com"] },
    users: [{ id: "a", username: "admin", role: "admin", createdAt: "" }],
    pillars: [],
    seedNodes: [],
    readiness: [{ label: "Seeders", ok: true, detail: "1 configured" }],
    genesis: {},
    configTemplate: {},
    ...overrides
  };
}

function input(o: AdminOverview, extra: Partial<PlaybookInput> = {}): PlaybookInput {
  return { overview: o, draft: o.settings, settingsDirty: false, now: NOW, ...extra };
}

describe("launch playbook", () => {
  it("starts at step 1 for an empty network", () => {
    const e = evaluatePlaybook("launch", input(overview()));
    assert.equal(e.currentIndex, 0);
    assert.equal(e.doneCount, 0);
    assert.equal(e.steps[0].state, "current");
    assert.equal(e.steps[1].state, "pending");
  });

  it("marks logins, nodes, and configuration done and points at Save when dirty", () => {
    const o = overview({
      users: [{ id: "a", username: "admin", role: "admin", createdAt: "" }, { id: "u", username: "op", role: "user", createdAt: "" }],
      pillars: [pillar("p1", false), pillar("p2", false)]
    });
    const e = evaluatePlaybook("launch", input(o, { settingsDirty: true }));
    assert.deepEqual(e.steps.slice(0, 4).map((s) => s.state), ["done", "done", "done", "current"]);
    assert.equal(e.doneCount, 3);
  });

  it("never shows a later step done before an earlier one", () => {
    // Published, but no operator logins: step 1 is current and publish must show pending.
    const o = overview({ published: { publishedAt: "2026-09-13T11:00:00Z", genesisPath: "/genesis.json", configPath: "/config.json", chainIdentifier: 1, seeders: [], bootstrapPeers: [] } });
    const e = evaluatePlaybook("launch", input(o));
    assert.equal(e.steps[0].state, "current");
    assert.equal(e.steps[5].state, "pending");
  });

  it("keeps 'Configure network' not done with a past genesis time and no finalize, until logins and nodes are done", () => {
    const o = overview({
      users: [{ id: "a", username: "admin", role: "admin", createdAt: "" }, { id: "u", username: "op", role: "user", createdAt: "" }],
      pillars: [pillar("p1", false), pillar("p2", false)]
    });
    const pastDraft = { ...o.settings, genesisTimestampSec: Math.floor(NOW / 1000) - HOUR };
    const e = evaluatePlaybook("launch", input(o, { draft: pastDraft }));
    assert.equal(e.steps[0].state, "done");
    assert.equal(e.steps[1].state, "done");
    assert.equal(e.steps[2].state, "current");
  });

  it("explains why 'Configure network' is blocked", () => {
    const o = overview({
      users: [{ id: "a", username: "admin", role: "admin", createdAt: "" }, { id: "u", username: "op", role: "user", createdAt: "" }],
      pillars: [pillar("p1", false), pillar("p2", false)]
    });
    const past = { ...o.settings, genesisTimestampSec: Math.floor(NOW / 1000) - HOUR };
    assert.equal(evaluatePlaybook("launch", input(o, { draft: past })).current?.reason, "genesis start time is in the past");

    const noSeeders = overview({ ...o, readiness: [{ label: "Seeders", ok: false, detail: "" }] });
    assert.equal(evaluatePlaybook("launch", input(noSeeders, { draft: { ...noSeeders.settings, seeders: [] } })).current?.reason, "no seeders configured");
    assert.equal(evaluatePlaybook("launch", input(noSeeders, { settingsDirty: true })).current?.reason, "seeders not saved yet");
    // Reasons belong to the current step only.
    const e = evaluatePlaybook("launch", input(o, { draft: past }));
    assert.equal(e.steps[0].reason, undefined);
    assert.equal(e.steps[3].reason, undefined);
  });

  it("counts a publish older than the latest finalize as not done", () => {
    const o = overview({
      users: [{ id: "a", username: "admin", role: "admin", createdAt: "" }, { id: "u", username: "op", role: "user", createdAt: "" }],
      pillars: [pillar("p1", true), pillar("p2", true)],
      finalizedAt: "2026-09-13T11:30:00Z",
      published: { publishedAt: "2026-09-13T11:00:00Z", genesisPath: "/genesis.json", configPath: "/config.json", chainIdentifier: 1, seeders: [], bootstrapPeers: [] }
    });
    const e = evaluatePlaybook("launch", input(o));
    assert.equal(e.steps[4].state, "done");
    assert.equal(e.steps[5].state, "current");
    assert.equal(e.current?.reason, "published before the latest finalize");
    assert.equal(e.steps[6].state, "pending");
  });

  it("reports how many nodes are not online", () => {
    const o = overview({
      users: [{ id: "a", username: "admin", role: "admin", createdAt: "" }, { id: "u", username: "op", role: "user", createdAt: "" }],
      pillars: [pillar("p1", true), pillar("p2", false)],
      finalizedAt: "2026-09-13T10:00:00Z",
      published: { publishedAt: "2026-09-13T11:00:00Z", genesisPath: "/genesis.json", configPath: "/config.json", chainIdentifier: 1, seeders: [], bootstrapPeers: [] }
    });
    assert.equal(evaluatePlaybook("launch", input(o)).current?.reason, "1 of 2 nodes not online");
  });

  it("completes when everything is published and all nodes are online", () => {
    const o = overview({
      users: [{ id: "a", username: "admin", role: "admin", createdAt: "" }, { id: "u", username: "op", role: "user", createdAt: "" }],
      pillars: [pillar("p1", true), pillar("p2", true)],
      finalizedAt: "2026-09-13T10:00:00Z",
      published: { publishedAt: "2026-09-13T11:00:00Z", genesisPath: "/genesis.json", configPath: "/config.json", chainIdentifier: 1, seeders: [], bootstrapPeers: [] }
    });
    const e = evaluatePlaybook("launch", input(o));
    assert.equal(e.complete, true);
    assert.equal(e.doneCount, e.total);
    assert.equal(e.current, undefined);
  });
});

describe("relaunch playbook", () => {
  const published = { publishedAt: "2026-09-13T11:00:00Z", genesisPath: "/genesis.json", configPath: "/config.json", chainIdentifier: 1, seeders: [], bootstrapPeers: [], genesisStartAt: "2026-09-13T13:00:00Z", actions: { wipeData: false } };

  it("requires a new future genesis time first", () => {
    const o = overview({ published, finalizedAt: "2026-09-13T10:00:00Z" });
    assert.equal(evaluatePlaybook("relaunch", input(o)).currentIndex, 0);
    const moved = { ...o.settings, genesisTimestampSec: Math.floor(NOW / 1000) + 2 * HOUR };
    const e = evaluatePlaybook("relaunch", input(o, { draft: moved, settingsDirty: true }));
    assert.equal(e.steps[0].state, "done");
    assert.equal(e.steps[1].state, "current");
  });

  it("keeps steps 1-5 done after the wiped publish even though the server cleared the wipe flag", () => {
    const later = { ...published, publishedAt: "2026-09-13T11:30:00Z", genesisStartAt: "2026-09-13T15:00:00Z", actions: { wipeData: true } };
    // Draft equals the published genesis time (15:00Z) and wipeDataOnPublish is false again, as after a real publish.
    const s = settings({ genesisTimestampSec: Math.floor(NOW / 1000) + 3 * HOUR, wipeDataOnPublish: false });
    const waiting = overview({ settings: s, published: later, finalizedAt: "2026-09-13T11:20:00Z", pillars: [pillar("p1", false)] });
    let e = evaluatePlaybook("relaunch", input(waiting, { draft: s }));
    assert.deepEqual(e.steps.map((step) => step.state), ["done", "done", "done", "done", "done", "current"]);
    const rejoined = overview({ ...waiting, pillars: [pillar("p1", true)] });
    e = evaluatePlaybook("relaunch", input(rejoined, { draft: s }));
    assert.equal(e.complete, true);
  });
});

describe("change playbook", () => {
  const published = {
    publishedAt: "2026-09-13T11:00:00Z", genesisPath: "/genesis.json", configPath: "/config.json", chainIdentifier: 1, seeders: [], bootstrapPeers: [],
    release: { goZenon: { repoUrl: "https://github.com/zenon-network/go-zenon.git", ref: "master", commit: COMMIT }, deployment: { repoUrl: "https://github.com/hypercore-one/deployment.git", ref: "main", commit: "b".repeat(40) } }
  };

  it("treats an unchanged target as not yet edited and skips the optional apply-time step", () => {
    const o = overview({ published });
    const e = evaluatePlaybook("change", input(o));
    assert.equal(e.steps[0].state, "current");
    assert.equal(e.steps[1].optional, true);
    assert.equal(e.steps[1].skipped, true);
  });

  it("marks the optional apply-time step done, not skipped, once releaseApplyAtSec is set", () => {
    const o = overview();
    const draft = { ...o.settings, releaseApplyAtSec: Math.floor(NOW / 1000) + HOUR };
    const e = evaluatePlaybook("change", input(o, { draft }));
    assert.equal(e.steps[0].state, "done");
    assert.equal(e.steps[1].skipped, false);
    assert.equal(e.steps[1].state, "done");
  });

  it("with nothing published, treats edit as done, skips apply-time, and points at save when dirty", () => {
    const o = overview();
    const e = evaluatePlaybook("change", input(o, { settingsDirty: true }));
    assert.equal(e.steps[0].state, "done");
    assert.equal(e.steps[1].skipped, true);
    assert.equal(e.steps[2].state, "current");
  });

  it("walks edit -> save -> publish -> nodes apply, then returns to idle", () => {
    const idle = overview({ published, pillars: [pillar("p1", true, COMMIT)] });
    assert.equal(evaluatePlaybook("change", input(idle)).currentIndex, 0);

    const draft = { ...idle.settings, goZenonRef: "v2" };
    let e = evaluatePlaybook("change", input(idle, { draft, settingsDirty: true }));
    assert.equal(e.steps[0].state, "done");
    assert.equal(e.steps[2].state, "current");

    const saved = overview({ ...idle, settings: draft });
    e = evaluatePlaybook("change", input(saved, { draft }));
    assert.equal(e.steps[3].state, "current");

    const newPublished = { ...published, release: { ...published.release, goZenon: { ...published.release.goZenon, ref: "v2", commit: "1".repeat(40) } } };
    const rolling = overview({ ...saved, published: newPublished, pillars: [pillar("p1", true, COMMIT)] });
    e = evaluatePlaybook("change", input(rolling, { draft }));
    assert.deepEqual(e.steps.map((step) => step.state), ["done", "pending", "done", "done", "current"]);
    assert.equal(e.steps[1].skipped, true);

    const applied = overview({ ...rolling, pillars: [pillar("p1", true, "1".repeat(40))] });
    e = evaluatePlaybook("change", input(applied, { draft }));
    assert.equal(e.currentIndex, 0, "idle again once every node runs the published build");
  });
});

describe("parsePlaybookId", () => {
  it("accepts known ids and falls back to launch", () => {
    assert.equal(parsePlaybookId("relaunch"), "relaunch");
    assert.equal(parsePlaybookId("change"), "change");
    assert.equal(parsePlaybookId("nope"), "launch");
    assert.equal(parsePlaybookId(null), "launch");
  });
});
