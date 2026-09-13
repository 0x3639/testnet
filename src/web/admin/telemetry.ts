import type { AdminOverview, PublicNodeStatus } from "../../shared/types";

export type TelemetryNode = {
  id: string;
  name: string;
  nodeType: "pillar" | "seed";
  nodeStatus?: PublicNodeStatus;
};

export type HealthTone = "ok" | "warn" | "bad" | "muted";
export interface NodeHealth {
  label: string;
  tone: HealthTone;
}

/** A node that has not reported for this long is Stale. */
export const STALE_AFTER_MS = 5 * 60 * 1000;

export function telemetryNodes(overview: Pick<AdminOverview, "pillars" | "seedNodes">): TelemetryNode[] {
  return [
    ...overview.pillars.map((pillar) => ({ id: pillar.id, name: pillar.pillarName, nodeType: "pillar" as const, nodeStatus: pillar.nodeStatus })),
    ...overview.seedNodes.map((seedNode) => ({ id: seedNode.id, name: seedNode.nodeName, nodeType: "seed" as const, nodeStatus: seedNode.nodeStatus }))
  ];
}

export function formatAge(value?: string, now = Date.now()): string {
  if (!value) return "No report";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Unknown";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function syncStateLabel(value?: number): string {
  if (value === 1) return "Syncing";
  if (value === 2) return "Synced";
  if (value === 0) return "Unknown";
  return value === undefined ? "Unknown" : String(value);
}

export function heightLag(node: TelemetryNode): string {
  const sync = node.nodeStatus?.latest?.sync;
  if (sync?.currentHeight === undefined || sync.targetHeight === undefined) return "-";
  return String(Math.max(0, sync.targetHeight - sync.currentHeight));
}

export function clockSkewSeconds(node: TelemetryNode): number | undefined {
  const latest = node.nodeStatus?.latest;
  if (!latest?.reportedAt) return undefined;
  const reportedAt = Date.parse(latest.reportedAt);
  const receivedAt = Date.parse(latest.receivedAt);
  if (Number.isNaN(reportedAt) || Number.isNaN(receivedAt)) return undefined;
  return Math.round((reportedAt - receivedAt) / 1000);
}

export function formatClockSkew(node: TelemetryNode): string {
  const skew = clockSkewSeconds(node);
  if (skew === undefined) return "-";
  const abs = Math.abs(skew);
  const sign = skew > 0 ? "+" : skew < 0 ? "-" : "";
  if (abs < 60) return `${sign}${abs}s`;
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;
  return seconds ? `${sign}${minutes}m ${seconds}s` : `${sign}${minutes}m`;
}

export function shortCommit(value?: string): string {
  if (!value) return "-";
  return value.length > 12 ? `${value.slice(0, 12)}...` : value;
}

export function nodeHealth(node: TelemetryNode, now = Date.now()): NodeHealth {
  const latest = node.nodeStatus?.latest;
  if (!latest) return { label: "No report", tone: "muted" };

  const ageMs = now - Date.parse(latest.receivedAt);
  if (!Number.isNaN(ageMs) && ageMs > STALE_AFTER_MS) return { label: "Stale", tone: "bad" };
  const skew = clockSkewSeconds(node);
  if (skew !== undefined && Math.abs(skew) > 5 * 60) return { label: "Clock skew", tone: "bad" };
  if (skew !== undefined && Math.abs(skew) > 60) return { label: "Clock skew", tone: "warn" };
  if (latest.node?.lastError) return { label: "Install failed", tone: "bad" };
  if (latest.node?.waitingForRelease) return { label: "Waiting", tone: "warn" };
  if (latest.node?.serviceActive === false) return { label: "Service down", tone: "bad" };
  if ((latest.logs?.errorCountLastMinute ?? 0) > 0) return { label: "Errors", tone: "bad" };
  if (latest.sync?.state !== undefined && latest.sync.state !== 2) return { label: syncStateLabel(latest.sync.state), tone: "warn" };
  if (latest.sync?.currentHeight !== undefined && latest.sync.targetHeight !== undefined && latest.sync.targetHeight - latest.sync.currentHeight > 5) {
    return { label: "Lagging", tone: "warn" };
  }
  return { label: "Online", tone: "ok" };
}

export function isOnline(node: TelemetryNode, now = Date.now()): boolean {
  return nodeHealth(node, now).label === "Online";
}
