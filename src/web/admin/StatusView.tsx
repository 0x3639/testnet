import { Copy } from "lucide-react";
import type { AdminOverview } from "../../shared/types";
import type { RefreshState } from "../shared/api";
import { copy, formatUtc, publicUrl } from "../shared/format";
import { Button, RefreshButton, StatTile } from "../shared/ui";
import { SectionHeader } from "./SectionHeader";
import type { SectionId } from "./sections";
import { attentionItems, statusTiles } from "./statusAggregates";
import { formatAge, nodeHealth, shortCommit, type TelemetryNode } from "./telemetry";
import { Tooltip } from "./Tooltip";
import { TIPS } from "./tooltips";

export function StatusView({ overview, nodes, refresh, refreshState, lastUpdatedAt, onNavigate }: {
  overview: AdminOverview;
  nodes: TelemetryNode[];
  refresh: () => Promise<void>;
  refreshState: RefreshState;
  lastUpdatedAt: number;
  onNavigate: (section: SectionId) => void;
}) {
  const now = Date.now();
  const tiles = statusTiles(nodes, now);
  const attention = attentionItems(nodes, now);
  const published = overview.published;
  const release = published?.release;
  const artifacts = published
    ? [
        { name: "genesis.json", url: publicUrl(published.genesisPath) },
        { name: "config.json", url: publicUrl(published.configPath) },
        ...(published.nodePlanPath ? [{ name: "node-plan.json", url: publicUrl(published.nodePlanPath) }] : [])
      ]
    : [];
  const secondsAgo = Math.max(0, Math.floor((now - lastUpdatedAt) / 1000));

  return (
    <>
      <SectionHeader
        kicker={`Testnet-${overview.settings.chainIdentifier} · ${published ? "release published" : "no release published"}`}
        title={<><span className={`liveDot${published ? " on" : ""}`} /> Network Status</>}
        aside={<><span className="mono mutedText">Auto-refreshes every 30s · last update {secondsAgo}s ago</span><RefreshButton refresh={refresh} state={refreshState} /></>}
      />
      <div className="statTiles statusTiles">
        <StatTile
          label="Momentum height"
          value={tiles.momentumHeight?.toLocaleString("en-US") ?? "—"}
          hint={
            tiles.momentumHeight === undefined
              ? undefined
              : tiles.maxLag === 0
                ? `target ${(tiles.targetHeight ?? tiles.momentumHeight).toLocaleString("en-US")} · in sync`
                : `${tiles.maxLag.toLocaleString("en-US")} behind`
          }
        />
        <StatTile label="Active nodes" value={`${tiles.activeNodes} / ${tiles.totalNodes}`} hint="reported in the last 5 min" />
        <StatTile label="Pillars producing" value={`${tiles.producingPillars} / ${tiles.totalPillars}`} />
        <StatTile label="Avg peers" value={tiles.avgPeers === undefined ? "—" : tiles.avgPeers.toFixed(1)} />
        <StatTile label="Release" value={release ? `${release.goZenon.ref} @ ${shortCommit(release.goZenon.commit)}` : "—"} hint={published ? `published ${formatUtc(published.publishedAt)}` : undefined} />
        <StatTile label="Genesis" value={formatUtc(new Date(overview.settings.genesisTimestampSec * 1000).toISOString())} hint={`chain ${overview.settings.chainIdentifier}`} />
      </div>
      <section className="panel">
        <div className="panelHeader"><div><span className="ledger">Alerts</span><h2>Needs attention<Tooltip text={TIPS["status.attention"]} /></h2></div></div>
        {attention.length ? (
          <div className="attentionList">
            {attention.map((item) => (
              <button key={item.id} type="button" className="attentionRow" onClick={() => onNavigate("nodes")}>
                <strong>{item.name}</strong>
                <span className="mutedText">{item.message}</span>
                <span className="ledger">Nodes →</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mono mutedText">{nodes.length === 0 ? "No nodes registered yet" : "All nodes online"}</div>
        )}
      </section>
      <div className="statusColumns">
        <section className="panel">
          <div className="panelHeader"><div><span className="ledger">Telemetry</span><h2>Node health<Tooltip text={TIPS["status.health"]} /></h2></div></div>
          <div className="healthList">
            {nodes.map((node) => {
              const health = nodeHealth(node, now);
              return (
                <div key={node.id} className="healthRow">
                  <span>{node.name}</span>
                  <span className="mono mutedText">{node.nodeType}</span>
                  <span className="mono mutedText">{formatAge(node.nodeStatus?.latest?.receivedAt, now)}</span>
                  <span className={`statusPill ${health.tone}`}>{health.label}</span>
                </div>
              );
            })}
            {nodes.length === 0 ? <div className="emptyState">No nodes registered yet</div> : null}
          </div>
          <div className="toolbar"><Button variant="secondary" onClick={() => onNavigate("nodes")}>Full telemetry</Button></div>
        </section>
        <section className="panel">
          <div className="panelHeader"><div><span className="ledger">Release</span><h2>Current release<Tooltip text={TIPS["status.release"]} /></h2></div></div>
          {published && release ? (
            <>
              <div className="kvRows">
                <span className="ledger">go-zenon</span><span className="mono">{release.goZenon.ref} @ {shortCommit(release.goZenon.commit)}</span>
                <span className="ledger">Deployment</span><span className="mono">{release.deployment.ref} @ {shortCommit(release.deployment.commit)}</span>
                <span className="ledger">Published</span><span className="mono">{formatUtc(published.publishedAt)}</span>
              </div>
              <div className="artifactRows">
                {artifacts.map((file) => (
                  <button key={file.name} type="button" className="artifactRow" onClick={() => copy(file.url)} title={`Copy ${file.url}`}>
                    <span className="mono artifactName">{file.name}</span>
                    <span className="mono mutedText artifactUrl">{file.url}</span>
                    <Copy size={16} />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="emptyState">Nothing published yet.</div>
          )}
          <div className="toolbar"><Button variant="secondary" onClick={() => onNavigate("release")}>Release details</Button></div>
        </section>
      </div>
    </>
  );
}
