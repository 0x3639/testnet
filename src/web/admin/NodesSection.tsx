import { KeyRound, Server, Trash2 } from "lucide-react";
import { Fragment, FormEvent, useMemo, useState } from "react";
import type { AdminOverview, PublicPillar, PublicSeedNode } from "../../shared/types";
import type { RefreshState } from "../shared/api";
import { copy, download } from "../shared/format";
import { AddressValue, Button, RefreshButton } from "../shared/ui";
import { SectionHeader } from "./SectionHeader";
import { Tooltip } from "./Tooltip";
import { TIPS } from "./tooltips";
import {
  formatAge,
  formatClockSkew,
  heightLag,
  nodeHealth,
  shortCommit,
  syncStateLabel,
  type TelemetryNode
} from "./telemetry";

export interface CreateSeedNodeInput {
  userId: string;
  nodeName: string;
  publicIp: string;
  p2pPort: number;
}

function NodeStatusPanel({
  nodes,
  refresh,
  refreshState,
  detailed,
  onToggleDetailed
}: {
  nodes: TelemetryNode[];
  refresh: () => Promise<void>;
  refreshState: RefreshState;
  detailed: boolean;
  onToggleDetailed: () => void;
}) {
  return (
    <section className="panel wide">
      <div className="panelHeader">
        <div>
          <span className="ledger">Telemetry</span>
          <h2>Node Status<Tooltip text={TIPS["nodes.health"]} /></h2>
        </div>
        <div className="toolbar compactToolbar">
          <Button variant="ghost" onClick={onToggleDetailed}>
            {detailed ? "Compact" : "Detailed"}
          </Button>
          <RefreshButton refresh={refresh} state={refreshState} />
        </div>
      </div>
      <div className="tableWrap">
        <table className="nodeStatusTable">
          <thead>
            <tr>
              <th>Node</th>
              <th>Type</th>
              <th>Health</th>
              <th>Last Seen</th>
              {detailed ? <th>Clock</th> : null}
              <th>Height</th>
              <th>Lag</th>
              {detailed ? <th>Sync</th> : null}
              <th>Peers</th>
              <th>Version</th>
              {detailed ? <th>Commit</th> : null}
              <th>Service</th>
              {detailed ? <th>Logs</th> : null}
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => {
              const latest = node.nodeStatus?.latest;
              const health = nodeHealth(node);
              const recentLogs = latest?.logs?.recent?.join(" | ") ?? "";
              const processCommit = latest?.process?.commit || latest?.node?.installedCommit;
              return (
                <tr key={node.id}>
                  <td>{node.name}</td>
                  <td className="mono">{node.nodeType}</td>
                  <td>
                    <span className={`statusPill ${health.tone}`} title={latest?.node?.lastError || undefined}>
                      {health.label}
                    </span>
                  </td>
                  <td className="mono">{formatAge(latest?.receivedAt)}</td>
                  {detailed ? <td className="mono">{formatClockSkew(node)}</td> : null}
                  <td className="mono">{latest?.sync?.currentHeight ?? "-"}</td>
                  <td className="mono">{heightLag(node)}</td>
                  {detailed ? <td>{syncStateLabel(latest?.sync?.state)}</td> : null}
                  <td className="mono">{latest?.network?.peerCount ?? "-"}</td>
                  <td className="mono">{latest?.node?.waitingForRelease ? "waiting" : latest?.process?.version ?? latest?.node?.installedRef ?? "-"}</td>
                  {detailed ? (
                    <td className="mono" title={processCommit || undefined}>
                      {shortCommit(processCommit)}
                    </td>
                  ) : null}
                  <td>{latest?.node?.waitingForRelease ? "waiting" : latest?.node?.serviceActive === undefined ? "-" : latest.node.serviceActive ? "active" : "down"}</td>
                  {detailed ? (
                    <td>
                      <span className="mono">
                        E:{latest?.logs?.errorCountLastMinute ?? 0} W:{latest?.logs?.warningCountLastMinute ?? 0}
                      </span>
                      {latest?.node?.lastError ? (
                        <div className="logSnippet" title={latest.node.lastError}>
                          {latest.node.lastError}
                        </div>
                      ) : null}
                      {recentLogs ? (
                        <div className="logSnippet" title={recentLogs}>
                          {recentLogs}
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function NodesSection({
  overview,
  nodes,
  refresh,
  refreshState,
  onDeletePillar,
  onDeleteSeedNode,
  onCreateSeedNode
}: {
  overview: AdminOverview;
  nodes: TelemetryNode[];
  refresh: () => Promise<void>;
  refreshState: RefreshState;
  onDeletePillar: (pillar: PublicPillar) => Promise<void>;
  onDeleteSeedNode: (seedNode: PublicSeedNode) => Promise<void>;
  onCreateSeedNode: (input: CreateSeedNodeInput) => Promise<PublicSeedNode>;
}) {
  const userById = useMemo(() => new Map(overview.users.map((user) => [user.id, user])), [overview.users]);
  const availableSeedNodeUsers = useMemo(
    () => overview.users.filter((user) => user.role === "user" && !user.nodeName),
    [overview.users]
  );
  const [detailed, setDetailed] = useState(false);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [seedNodeInput, setSeedNodeInput] = useState<CreateSeedNodeInput>({
    userId: "",
    nodeName: "",
    publicIp: "",
    p2pPort: 35995
  });
  const [seedNodeBusy, setSeedNodeBusy] = useState(false);
  const [seedNodeError, setSeedNodeError] = useState("");
  const [generatedSeedNode, setGeneratedSeedNode] = useState<PublicSeedNode | null>(null);

  function toggleRow(id: string) {
    setOpenRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createManagedSeedNode(event: FormEvent) {
    event.preventDefault();
    setSeedNodeBusy(true);
    setSeedNodeError("");
    setGeneratedSeedNode(null);
    try {
      const seedNode = await onCreateSeedNode(seedNodeInput);
      setGeneratedSeedNode(seedNode);
      setSeedNodeInput({
        userId: "",
        nodeName: "",
        publicIp: "",
        p2pPort: 35995
      });
    } catch (err) {
      setSeedNodeError((err as Error).message);
    } finally {
      setSeedNodeBusy(false);
    }
  }

  return (
    <>
      <SectionHeader
        title="Nodes"
        description="Pillars register themselves; seed nodes are generated here. Health reports arrive once nodes run the bootstrap."
      />
      <NodeStatusPanel
        nodes={nodes}
        refresh={refresh}
        refreshState={refreshState}
        detailed={detailed}
        onToggleDetailed={() => setDetailed((value) => !value)}
      />
      <div className="nodePanels">
        <section className="panel">
          <div className="panelHeader">
            <div>
              <span className="ledger">Pillars</span>
              <h2>
                Pillars · {overview.pillars.length} of {overview.settings.expectedPillars}
                <Tooltip text={TIPS["nodes.pillars"]} />
              </h2>
            </div>
            <Button variant="secondary" icon={<KeyRound size={18} />} onClick={() => download("/api/admin/spork-package.zip")}>
              Spork Wallet
            </Button>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Pillar address</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {overview.pillars.map((pillar) => (
                  <Fragment key={pillar.id}>
                    <tr title={`reward ${pillar.rewardAddress} · producer ${pillar.producerAddress}`}>
                      <td>{pillar.pillarName}</td>
                      <td>
                        <AddressValue value={pillar.pillarAddress} />
                      </td>
                      <td className="mono">{new Date(pillar.createdAt).toLocaleString()}</td>
                      <td>
                        <div className="toolbar compactToolbar">
                          <Button variant="ghost" onClick={() => toggleRow(pillar.id)}>
                            {openRows.has(pillar.id) ? "Hide" : "Details"}
                          </Button>
                          <Button variant="danger" icon={<Trash2 size={18} />} onClick={() => void onDeletePillar(pillar)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {openRows.has(pillar.id) ? (
                      <tr className="detailRow">
                        <td colSpan={4}>
                          <span className="detailItem">
                            <span className="ledger">Reward</span>
                            <AddressValue value={pillar.rewardAddress} />
                          </span>
                          <span className="detailItem">
                            <span className="ledger">Producer</span>
                            <AddressValue value={pillar.producerAddress} />
                          </span>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
                {overview.pillars.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="mutedText">
                      No pillars registered yet
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="panelHeader">
            <div>
              <span className="ledger">Seed nodes</span>
              <h2>Seed nodes · {overview.seedNodes.length}<Tooltip text={TIPS["nodes.seeds"]} /></h2>
            </div>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Address</th>
                  <th>Enode</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {overview.seedNodes.map((seedNode) => (
                  <Fragment key={seedNode.id}>
                    <tr title={`operator ${userById.get(seedNode.userId)?.username ?? "unknown"} · ${seedNode.multiaddr}`}>
                      <td>{seedNode.nodeName}</td>
                      <td className="mono">
                        {seedNode.publicIp}:{seedNode.p2pPort}
                      </td>
                      <td>
                        <AddressValue value={seedNode.enode} />
                      </td>
                      <td>
                        <div className="toolbar compactToolbar">
                          <Button variant="ghost" onClick={() => toggleRow(seedNode.id)}>
                            {openRows.has(seedNode.id) ? "Hide" : "Details"}
                          </Button>
                          <Button variant="danger" icon={<Trash2 size={18} />} onClick={() => void onDeleteSeedNode(seedNode)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {openRows.has(seedNode.id) ? (
                      <tr className="detailRow">
                        <td colSpan={4}>
                          <span className="detailItem">
                            <span className="ledger">Operator</span>
                            <span className="mono">{userById.get(seedNode.userId)?.username ?? "unknown"}</span>
                          </span>
                          <span className="detailItem">
                            <span className="ledger">Public key</span>
                            <AddressValue value={seedNode.publicKey} />
                          </span>
                          <span className="detailItem">
                            <span className="ledger">Multiaddr</span>
                            <AddressValue value={seedNode.multiaddr} />
                          </span>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
                {overview.seedNodes.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="mutedText">
                      No managed seed nodes yet
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <form className="seedCreateGrid" onSubmit={createManagedSeedNode}>
            <label>
              <span>Operator Login</span>
              <select
                value={seedNodeInput.userId}
                onChange={(event) => setSeedNodeInput({ ...seedNodeInput, userId: event.target.value })}
                disabled={!availableSeedNodeUsers.length}
              >
                <option value="">{availableSeedNodeUsers.length ? "Select user" : "No unused operator users"}</option>
                {availableSeedNodeUsers.map((user) => (
                  <option value={user.id} key={user.id}>
                    {user.username}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Seed Node Name</span>
              <input value={seedNodeInput.nodeName} onChange={(event) => setSeedNodeInput({ ...seedNodeInput, nodeName: event.target.value })} />
            </label>
            <label>
              <span>Public IP</span>
              <input
                className="mono"
                value={seedNodeInput.publicIp}
                onChange={(event) => setSeedNodeInput({ ...seedNodeInput, publicIp: event.target.value })}
                placeholder="203.0.113.10"
              />
            </label>
            <label>
              <span>P2P Port</span>
              <input
                className="mono"
                type="number"
                min={1}
                max={65535}
                value={seedNodeInput.p2pPort}
                onChange={(event) => setSeedNodeInput({ ...seedNodeInput, p2pPort: Number(event.target.value) })}
              />
            </label>
            <Button type="submit" icon={<Server size={18} />} disabled={seedNodeBusy || !availableSeedNodeUsers.length}>
              {seedNodeBusy ? "Generating" : "Generate Seed Node"}
            </Button>
          </form>
          {seedNodeError ? <div className="alert">{seedNodeError}</div> : null}
          {generatedSeedNode ? (
            <div className="resultStack">
              <button className="seedResult mono" type="button" onClick={() => copy(generatedSeedNode.enode)} title="Copy generated enode">
                {generatedSeedNode.enode}
              </button>
              <button
                className="seedResult mono"
                type="button"
                onClick={() => copy(generatedSeedNode.multiaddr)}
                title="Copy generated libp2p multiaddr"
              >
                {generatedSeedNode.multiaddr}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
