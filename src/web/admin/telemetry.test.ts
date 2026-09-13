import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatAge, isOnline, nodeHealth, telemetryNodes, type TelemetryNode } from "./telemetry";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

function node(latest: Partial<NonNullable<TelemetryNode["nodeStatus"]>["latest"]> | undefined, name = "n"): TelemetryNode {
  return {
    id: name,
    name,
    nodeType: "pillar",
    nodeStatus: latest ? { latest: { receivedAt: ago(10), ...latest }, historyCount: 1 } : undefined
  };
}

describe("nodeHealth", () => {
  it("is Online for a fresh, synced, error-free report", () => {
    const n = node({ sync: { state: 2, currentHeight: 100, targetHeight: 100 }, node: { serviceActive: true } });
    assert.deepEqual(nodeHealth(n, NOW), { label: "Online", tone: "ok" });
    assert.equal(isOnline(n, NOW), true);
  });

  it("reports No report, Stale, Install failed, Service down, Errors, Syncing, Lagging", () => {
    assert.equal(nodeHealth(node(undefined), NOW).label, "No report");
    assert.equal(nodeHealth(node({ receivedAt: ago(6 * 60) }), NOW).label, "Stale");
    assert.equal(nodeHealth(node({ node: { lastError: "boom" } }), NOW).label, "Install failed");
    assert.equal(nodeHealth(node({ node: { serviceActive: false } }), NOW).label, "Service down");
    assert.equal(nodeHealth(node({ logs: { errorCountLastMinute: 2 } }), NOW).label, "Errors");
    assert.equal(nodeHealth(node({ sync: { state: 1 } }), NOW).label, "Syncing");
    assert.equal(nodeHealth(node({ sync: { state: 2, currentHeight: 10, targetHeight: 100 } }), NOW).label, "Lagging");
  });

  it("reports Clock skew as warn at 2 minutes off and bad at 6 minutes off", () => {
    const warn = node({ receivedAt: ago(10), reportedAt: ago(10 + 2 * 60) });
    assert.deepEqual(nodeHealth(warn, NOW), { label: "Clock skew", tone: "warn" });
    const bad = node({ receivedAt: ago(10), reportedAt: ago(10 + 6 * 60) });
    assert.deepEqual(nodeHealth(bad, NOW), { label: "Clock skew", tone: "bad" });
  });

  it("reports Waiting when the node is waiting for a published release", () => {
    const n = node({ node: { waitingForRelease: true } });
    assert.deepEqual(nodeHealth(n, NOW), { label: "Waiting", tone: "warn" });
  });

  it("uses the supplied clock", () => {
    const n = node({ receivedAt: ago(10), sync: { state: 2 }, node: { serviceActive: true } });
    assert.equal(nodeHealth(n, NOW).label, "Online");
    assert.equal(nodeHealth(n, NOW + 10 * 60 * 1000).label, "Stale");
  });

  it("is Unknown for a report with only receivedAt", () => {
    const n: TelemetryNode = { id: "n", name: "n", nodeType: "pillar", nodeStatus: { latest: { receivedAt: ago(10) }, historyCount: 1 } };
    assert.deepEqual(nodeHealth(n, NOW), { label: "Unknown", tone: "muted" });
  });

  it("is Unknown for an unparseable receivedAt", () => {
    const n: TelemetryNode = { id: "n", name: "n", nodeType: "pillar", nodeStatus: { latest: { receivedAt: "not-a-date" }, historyCount: 1 } };
    assert.deepEqual(nodeHealth(n, NOW), { label: "Unknown", tone: "muted" });
  });
});

describe("formatAge and telemetryNodes", () => {
  it("formats ages relative to the supplied clock", () => {
    assert.equal(formatAge(undefined, NOW), "No report");
    assert.equal(formatAge(ago(12), NOW), "12s ago");
    assert.equal(formatAge(ago(18 * 60), NOW), "18m ago");
    assert.equal(formatAge(ago(3 * 3600), NOW), "3h ago");
  });

  it("flattens pillars and seed nodes in order", () => {
    const nodes = telemetryNodes({
      pillars: [{ id: "p1", pillarName: "alpha", pillarAddress: "", rewardAddress: "", producerAddress: "", producerIndex: 0, createdAt: "" }],
      seedNodes: [{ id: "s1", userId: "u", nodeName: "seed-1", publicIp: "1.2.3.4", p2pPort: 1, publicKey: "", enode: "", multiaddr: "", createdAt: "" }]
    });
    assert.deepEqual(nodes.map((n) => [n.id, n.name, n.nodeType]), [["p1", "alpha", "pillar"], ["s1", "seed-1", "seed"]]);
  });
});
