import { formatAge, isOnline, nodeHealth, type HealthTone, type TelemetryNode } from "./telemetry";

export interface StatusTiles {
  momentumHeight?: number;
  targetHeight?: number;
  maxLag: number;
  activeNodes: number;
  totalNodes: number;
  producingPillars: number;
  totalPillars: number;
  avgPeers?: number;
}

export interface AttentionItem {
  id: string;
  name: string;
  tone: HealthTone;
  label: string;
  message: string;
}

export interface HealthCount {
  label: string;
  tone: HealthTone;
  count: number;
}

const ACTIVE_WITHIN_MS = 5 * 60 * 1000;

export function statusTiles(nodes: TelemetryNode[], now = Date.now()): StatusTiles {
  const reports = nodes.map((node) => node.nodeStatus?.latest).filter((latest): latest is NonNullable<typeof latest> => Boolean(latest));
  const heights = reports.map((r) => r.sync?.currentHeight).filter((h): h is number => typeof h === "number");
  const targetHeights = reports.map((r) => r.sync?.targetHeight).filter((h): h is number => typeof h === "number");
  const lags = reports
    .map((r) => (typeof r.sync?.currentHeight === "number" && typeof r.sync.targetHeight === "number" ? Math.max(0, r.sync.targetHeight - r.sync.currentHeight) : 0));
  const peers = reports.map((r) => r.network?.peerCount).filter((p): p is number => typeof p === "number");
  const pillars = nodes.filter((node) => node.nodeType === "pillar");
  return {
    momentumHeight: heights.length ? Math.max(...heights) : undefined,
    targetHeight: targetHeights.length ? Math.max(...targetHeights) : undefined,
    maxLag: lags.length ? Math.max(...lags) : 0,
    activeNodes: reports.filter((r) => now - Date.parse(r.receivedAt) < ACTIVE_WITHIN_MS).length,
    totalNodes: nodes.length,
    producingPillars: pillars.filter((node) => isOnline(node, now)).length,
    totalPillars: pillars.length,
    avgPeers: peers.length ? peers.reduce((a, b) => a + b, 0) / peers.length : undefined
  };
}

function attentionMessage(node: TelemetryNode, label: string, now: number): string {
  const latest = node.nodeStatus?.latest;
  switch (label) {
    case "No report":
      return "Has not reported yet — run the bootstrap command.";
    case "Stale":
      return `No report for ${formatAge(latest?.receivedAt, now).replace(" ago", "")} — check the machine or re-run the bootstrap command.`;
    case "Install failed":
      return latest?.node?.lastError ?? "The last release could not be applied.";
    case "Service down":
      return "Service is not running.";
    case "Errors":
      return `${latest?.logs?.errorCountLastMinute ?? 0} errors in the last minute.`;
    case "Clock skew": {
      const reported = latest?.reportedAt ? Date.parse(latest.reportedAt) : Number.NaN;
      const received = latest?.receivedAt ? Date.parse(latest.receivedAt) : Number.NaN;
      const skew = Number.isNaN(reported) || Number.isNaN(received) ? 0 : Math.round((reported - received) / 1000);
      return `Clock is ${Math.abs(skew)} s off.`;
    }
    case "Waiting":
      return "Waiting for a published release.";
    case "Syncing":
    case "Lagging": {
      const behind = typeof latest?.sync?.currentHeight === "number" && typeof latest.sync.targetHeight === "number" ? Math.max(0, latest.sync.targetHeight - latest.sync.currentHeight) : 0;
      return `Syncing, ${behind.toLocaleString("en-US")} momentums behind — catching up normally.`;
    }
    default:
      return label;
  }
}

export function attentionItems(nodes: TelemetryNode[], now = Date.now()): AttentionItem[] {
  return nodes
    .map((node) => ({ node, health: nodeHealth(node, now) }))
    .filter(({ health }) => health.label !== "Online")
    .map(({ node, health }) => ({ id: node.id, name: node.name, tone: health.tone, label: health.label, message: attentionMessage(node, health.label, now) }));
}

export function healthCounts(nodes: TelemetryNode[], now = Date.now()): HealthCount[] {
  const counts = new Map<string, HealthCount>();
  for (const node of nodes) {
    const health = nodeHealth(node, now);
    const entry = counts.get(health.label) ?? { label: health.label, tone: health.tone, count: 0 };
    entry.count += 1;
    counts.set(health.label, entry);
  }
  const order: HealthTone[] = ["ok", "warn", "bad", "muted"];
  return [...counts.values()].sort((a, b) => order.indexOf(a.tone) - order.indexOf(b.tone) || b.count - a.count);
}
