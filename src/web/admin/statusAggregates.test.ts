import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attentionItems, healthCounts, statusTiles } from "./statusAggregates";
import type { TelemetryNode } from "./telemetry";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

function node(name: string, nodeType: "pillar" | "seed", latest?: Partial<NonNullable<TelemetryNode["nodeStatus"]>["latest"]>): TelemetryNode {
  return { id: name, name, nodeType, nodeStatus: latest ? { latest: { receivedAt: ago(10), ...latest }, historyCount: 1 } : undefined };
}

const fleet: TelemetryNode[] = [
  node("alpha", "pillar", { sync: { state: 2, currentHeight: 184220, targetHeight: 184220 }, network: { peerCount: 9 }, node: { serviceActive: true } }),
  node("beta", "pillar", { sync: { state: 2, currentHeight: 184220, targetHeight: 184220 }, network: { peerCount: 8 }, node: { serviceActive: true } }),
  node("gamma", "pillar", { sync: { state: 1, currentHeight: 163904, targetHeight: 184220 }, network: { peerCount: 7 } }),
  node("seed-frankfurt", "seed", { sync: { state: 2, currentHeight: 184220, targetHeight: 184220 }, network: { peerCount: 11 }, node: { serviceActive: true } }),
  node("seed-osaka", "seed", { receivedAt: ago(18 * 60), sync: { state: 2, currentHeight: 180011, targetHeight: 180011 } })
];

describe("statusTiles", () => {
  it("aggregates heights, active nodes, producing pillars, and peers", () => {
    const tiles = statusTiles(fleet, NOW);
    assert.equal(tiles.momentumHeight, 184220);
    assert.equal(tiles.targetHeight, 184220);
    assert.equal(tiles.maxLag, 20316);
    assert.equal(tiles.activeNodes, 4);
    assert.equal(tiles.totalNodes, 5);
    assert.equal(tiles.producingPillars, 2);
    assert.equal(tiles.totalPillars, 3);
    assert.equal(tiles.avgPeers, 8.75);
  });

  it("is empty-safe", () => {
    const tiles = statusTiles([], NOW);
    assert.equal(tiles.momentumHeight, undefined);
    assert.equal(tiles.avgPeers, undefined);
    assert.equal(tiles.activeNodes, 0);
  });
});

describe("attentionItems and healthCounts", () => {
  it("lists every node that is not Online with a human message", () => {
    const items = attentionItems(fleet, NOW);
    assert.deepEqual(items.map((i) => [i.name, i.label]), [["gamma", "Syncing"], ["seed-osaka", "Stale"]]);
    assert.match(items[0].message, /20,316 momentums behind/);
    assert.match(items[1].message, /No report for 18m/);
  });

  it("describes install failures, no reports, and errors", () => {
    const items = attentionItems([
      node("x", "pillar", { node: { lastError: "Built znnd commit abc does not match" } }),
      node("y", "pillar"),
      node("z", "pillar", { logs: { errorCountLastMinute: 3 } })
    ], NOW);
    assert.equal(items[0].message, "Built znnd commit abc does not match");
    assert.match(items[1].message, /Has not reported yet/);
    assert.match(items[2].message, /3 errors in the last minute/);
  });

  it("describes service down, clock skew, lagging, and waiting nodes", () => {
    const items = attentionItems([
      node("d", "pillar", { node: { serviceActive: false } }),
      node("e", "pillar", { receivedAt: ago(10), reportedAt: ago(10 + 2 * 60) }),
      node("f", "pillar", { sync: { state: 2, currentHeight: 10, targetHeight: 100 } }),
      node("g", "pillar", { node: { waitingForRelease: true } })
    ], NOW);
    assert.equal(items[0].message, "Service is not running.");
    assert.match(items[1].message, /Clock is \d+ s off/);
    assert.match(items[2].message, /90 momentums behind/);
    assert.equal(items[3].message, "Waiting for a published release.");
  });

  it("counts nodes per health label", () => {
    assert.deepEqual(healthCounts(fleet, NOW), [
      { label: "Online", tone: "ok", count: 3 },
      { label: "Syncing", tone: "warn", count: 1 },
      { label: "Stale", tone: "bad", count: 1 }
    ]);
  });
});
