import { Plus, Save, Search, X } from "lucide-react";
import { FormEvent, useState } from "react";
import type {
  GenesisFundRecord,
  PublicNetworkSettings,
  RepoPolicyInfo,
  SeedNodeProbeResult,
  SporkRecord
} from "../../shared/types";
import {
  copy,
  fromUtcDateTimeInput,
  repoPolicyHint,
  toUtcDateTimeInput,
  utcSecondsFromNow
} from "../shared/format";
import { Button } from "../shared/ui";
import { SectionHeader } from "./SectionHeader";
import { Tooltip } from "./Tooltip";
import { TIPS } from "./tooltips";

export interface ProbeSeedInput {
  ip: string;
  rpcPort: number;
  p2pPort: number;
}

export function NetworkSection({
  draft,
  setDraft,
  settingsDirty,
  repoPolicy,
  onSave,
  onProbeSeed
}: {
  draft: PublicNetworkSettings;
  setDraft: React.Dispatch<React.SetStateAction<PublicNetworkSettings>>;
  settingsDirty: boolean;
  repoPolicy: RepoPolicyInfo;
  onSave: (settings: PublicNetworkSettings) => Promise<void>;
  onProbeSeed: (seed: ProbeSeedInput) => Promise<{ seed: SeedNodeProbeResult; settings: PublicNetworkSettings }>;
}) {
  const [seedIp, setSeedIp] = useState("");
  const [seedRpcPort, setSeedRpcPort] = useState(35997);
  const [seedP2pPort, setSeedP2pPort] = useState(35995);
  const [seedResult, setSeedResult] = useState<SeedNodeProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...draft,
        seeders: draft.seeders.filter(Boolean),
        bootstrapPeers: draft.bootstrapPeers.filter(Boolean),
        sporks: draft.sporks
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function probeSeed() {
    setProbing(true);
    setError("");
    setSeedResult(null);
    try {
      const result = await onProbeSeed({
        ip: seedIp,
        rpcPort: seedRpcPort,
        p2pPort: seedP2pPort
      });
      setDraft(result.settings);
      setSeedResult(result.seed);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProbing(false);
    }
  }

  return (
    <>
      <SectionHeader
        title="Network"
        description="Draft settings. Nothing reaches nodes until you Save here, then Finalize and Publish on the Release page."
        aside={settingsDirty ? <span className="statusPill warn">Unsaved changes</span> : <span className="mono mutedText">Saved</span>}
      />
      <div className="networkForm">
        <form id="networkSettingsForm" className="networkForm" onSubmit={submit}>
          <section className="panel stack">
            <div className="panelHeader">
              <div>
                <span className="ledger">Genesis</span>
                <h2>Genesis basics<Tooltip text={TIPS["network.genesis"]} /></h2>
              </div>
            </div>
            <div className="formGrid">
              <label>
                <span>Chain Identifier</span>
                <input
                  className="mono"
                  type="number"
                  value={draft.chainIdentifier}
                  onChange={(event) => setDraft({ ...draft, chainIdentifier: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Genesis Start (UTC)<Tooltip text={TIPS["network.genesisTime"]} /></span>
                <input
                  className="mono"
                  type="datetime-local"
                  value={toUtcDateTimeInput(draft.genesisTimestampSec)}
                  onChange={(event) => {
                    const value = fromUtcDateTimeInput(event.target.value);
                    if (value) setDraft({ ...draft, genesisTimestampSec: value });
                  }}
                />
              </label>
              <label>
                <span>Minimum Pillars<Tooltip text={TIPS["network.minPillars"]} /></span>
                <input
                  className="mono"
                  type="number"
                  value={draft.minPillars}
                  onChange={(event) => setDraft({ ...draft, minPillars: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Expected Pillars</span>
                <input
                  className="mono"
                  type="number"
                  value={draft.expectedPillars}
                  onChange={(event) => setDraft({ ...draft, expectedPillars: Number(event.target.value) })}
                />
              </label>
            </div>
            <label>
              <span>Extra Data</span>
              <input value={draft.extraData} onChange={(event) => setDraft({ ...draft, extraData: event.target.value })} />
            </label>
          </section>

          <section className="panel stack">
            <div className="panelHeader">
              <div>
                <span className="ledger">Release</span>
                <h2>Release target<Tooltip text={TIPS["network.release"]} /></h2>
              </div>
            </div>
            <div className="formGrid">
              <label>
                <span>go-zenon Repo</span>
                <input
                  className="mono"
                  value={draft.goZenonRepo}
                  onChange={(event) => setDraft({ ...draft, goZenonRepo: event.target.value })}
                />
                <small>{repoPolicyHint(repoPolicy)}</small>
              </label>
              <label>
                <span>go-zenon Branch / Tag</span>
                <input
                  className="mono"
                  value={draft.goZenonRef}
                  onChange={(event) => setDraft({ ...draft, goZenonRef: event.target.value })}
                />
              </label>
              <label>
                <span>go-zenon Commit Pin<Tooltip text={TIPS["network.commitPin"]} /></span>
                <input
                  className="mono"
                  value={draft.goZenonCommit ?? ""}
                  onChange={(event) => setDraft({ ...draft, goZenonCommit: event.target.value })}
                  placeholder="resolved at publish"
                />
                <small>Full 40-character hash, or leave empty to pin the ref's current commit when you publish. Nodes refuse to start a binary whose embedded revision differs.</small>
              </label>
              <label>
                <span>Deployment Commit Pin<Tooltip text={TIPS["network.commitPin"]} /></span>
                <input
                  className="mono"
                  value={draft.deploymentCommit ?? ""}
                  onChange={(event) => setDraft({ ...draft, deploymentCommit: event.target.value })}
                  placeholder="resolved at publish"
                />
                <small>Full 40-character hash, or leave empty to pin the ref's current commit when you publish. Nodes check out exactly this commit.</small>
              </label>
              <label>
                <span>Deployment Branch / Tag</span>
                <input
                  className="mono"
                  value={draft.deploymentRef}
                  onChange={(event) => setDraft({ ...draft, deploymentRef: event.target.value })}
                />
              </label>
            </div>
            <label>
              <span>Deployment Script Repo</span>
              <input
                className="mono"
                value={draft.deploymentRepo}
                onChange={(event) => setDraft({ ...draft, deploymentRepo: event.target.value })}
              />
              <small>{repoPolicyHint(repoPolicy)}</small>
            </label>
            <label>
              <span>Apply Release At (UTC)<Tooltip text={TIPS["network.applyAt"]} /></span>
              <input
                className="mono"
                type="datetime-local"
                value={toUtcDateTimeInput(draft.releaseApplyAtSec)}
                onChange={(event) => setDraft({ ...draft, releaseApplyAtSec: fromUtcDateTimeInput(event.target.value) })}
              />
            </label>
            <div className="toolbar compactToolbar">
              <Button variant="secondary" onClick={() => setDraft({ ...draft, releaseApplyAtSec: utcSecondsFromNow(0) })}>
                Now
              </Button>
              <Button variant="secondary" onClick={() => setDraft({ ...draft, releaseApplyAtSec: utcSecondsFromNow(10) })}>
                +10
              </Button>
              <Button variant="secondary" onClick={() => setDraft({ ...draft, releaseApplyAtSec: utcSecondsFromNow(30) })}>
                +30
              </Button>
              <Button variant="secondary" onClick={() => setDraft({ ...draft, releaseApplyAtSec: utcSecondsFromNow(60) })}>
                +60
              </Button>
              <Button variant="ghost" onClick={() => setDraft({ ...draft, releaseApplyAtSec: undefined })}>
                Clear
              </Button>
            </div>
            <label className="checkboxRow warnRow">
              <input
                type="checkbox"
                checked={draft.wipeDataOnPublish}
                onChange={(event) => setDraft({ ...draft, wipeDataOnPublish: event.target.checked })}
              />
              <span>Wipe node data on next Publish Release</span>
            </label>
          </section>

          <section className="panel stack">
            <div className="panelHeader">
              <div>
                <span className="ledger">Peers</span>
                <h2>Seeders &amp; bootstrap peers<Tooltip text={TIPS["network.seeders"]} /></h2>
              </div>
            </div>
            <div className="formGrid">
              <label>
                <span>Seeders (one per line)</span>
                <textarea
                  value={draft.seeders.join("\n")}
                  onChange={(event) => setDraft({ ...draft, seeders: event.target.value.split("\n").map((line) => line.trim()) })}
                  rows={4}
                />
              </label>
              <label>
                <span>Bootstrap Peers (one per line)</span>
                <textarea
                  value={draft.bootstrapPeers.join("\n")}
                  onChange={(event) =>
                    setDraft({ ...draft, bootstrapPeers: event.target.value.split("\n").map((line) => line.trim()) })
                  }
                  rows={4}
                />
              </label>
            </div>
            <div className="seedProbe">
              <div className="panelHeader">
                <div>
                  <span className="ledger">External Seeder</span>
                  <h2>RPC Probe</h2>
                </div>
              </div>
              <div className="seedProbeGrid">
                <label>
                  <span>Seeder IP</span>
                  <input className="mono" value={seedIp} onChange={(event) => setSeedIp(event.target.value)} placeholder="203.0.113.10" />
                </label>
                <label>
                  <span>RPC Port</span>
                  <input
                    className="mono"
                    type="number"
                    min={1}
                    max={65535}
                    value={seedRpcPort}
                    onChange={(event) => setSeedRpcPort(Number(event.target.value))}
                  />
                </label>
                <label>
                  <span>P2P Port</span>
                  <input
                    className="mono"
                    type="number"
                    min={1}
                    max={65535}
                    value={seedP2pPort}
                    onChange={(event) => setSeedP2pPort(Number(event.target.value))}
                  />
                </label>
              </div>
              <div className="toolbar">
                <Button variant="secondary" icon={<Search size={18} />} onClick={probeSeed} disabled={probing}>
                  {probing ? "Probing" : "Probe External Seed"}
                </Button>
              </div>
              {seedResult ? (
                <div className="resultStack">
                  <button className="seedResult mono" type="button" onClick={() => copy(seedResult.enode)} title="Copy enode">
                    {seedResult.enode}
                  </button>
                  <button className="seedResult mono" type="button" onClick={() => copy(seedResult.multiaddr)} title="Copy libp2p multiaddr">
                    {seedResult.multiaddr}
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          {error ? <div className="alert">{error}</div> : null}
        </form>

        <div className="networkEditors">
          <GenesisSporkEditor draft={draft} setDraft={setDraft} onSave={onSave} />
          <GenesisFundingEditor draft={draft} setDraft={setDraft} onSave={onSave} />
        </div>

        {settingsDirty ? (
          <div className="stickySaveBar">
            <span>Unsaved draft — Finalize and Publish are locked until you save.</span>
            <button type="submit" form="networkSettingsForm" className="btn primary" disabled={saving}>
              <Save size={18} />
              <span>{saving ? "Saving" : "Save Settings"}</span>
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function GenesisSporkEditor({
  draft,
  setDraft,
  onSave
}: {
  draft: PublicNetworkSettings;
  setDraft: React.Dispatch<React.SetStateAction<PublicNetworkSettings>>;
  onSave: (settings: PublicNetworkSettings) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateSpork(index: number, updates: Partial<SporkRecord>) {
    setDraft((current) => ({
      ...current,
      sporks: current.sporks.map((spork, candidateIndex) => (candidateIndex === index ? { ...spork, ...updates } : spork))
    }));
  }

  function addSpork() {
    setDraft((current) => ({
      ...current,
      sporks: [
        ...current.sporks,
        {
          id: "",
          name: "",
          description: "",
          activated: true,
          enforcementHeight: 0
        }
      ]
    }));
  }

  function removeSpork(index: number) {
    setDraft((current) => ({
      ...current,
      sporks: current.sporks.filter((_spork, candidateIndex) => candidateIndex !== index)
    }));
  }

  async function saveSporks(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...draft,
        seeders: draft.seeders.filter(Boolean),
        bootstrapPeers: draft.bootstrapPeers.filter(Boolean)
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="genesisSporkPanel" onSubmit={saveSporks}>
      <div className="panelHeader">
        <div>
          <span className="ledger">Genesis</span>
          <h2>Sporks<Tooltip text={TIPS["network.sporks"]} /></h2>
        </div>
        <div className="toolbar compactToolbar">
          <Button variant="secondary" icon={<Plus size={18} />} onClick={addSpork}>
            Add
          </Button>
          <Button type="submit" icon={<Save size={18} />} disabled={saving}>
            {saving ? "Saving" : "Save Sporks"}
          </Button>
        </div>
      </div>
      <div className="sporkRows">
        <div className="sporkHeader" aria-hidden="true">
          <span>Name</span>
          <span>ID</span>
          <span>Activation Height</span>
          <span>Active</span>
          <span />
        </div>
        {draft.sporks.map((spork, index) => (
          <div className="sporkRow" key={`${spork.id || "new"}-${index}`}>
            <input
              aria-label="Spork name"
              value={spork.name}
              required
              onChange={(event) => updateSpork(index, { name: event.target.value })}
            />
            <input
              aria-label="Spork ID"
              className="mono"
              value={spork.id}
              required
              pattern="[0-9a-fA-F]{64}"
              onChange={(event) => updateSpork(index, { id: event.target.value.trim() })}
            />
            <input
              aria-label="Spork activation height"
              className="mono"
              type="number"
              min={0}
              value={spork.enforcementHeight}
              onChange={(event) => updateSpork(index, { enforcementHeight: Number(event.target.value) })}
            />
            <label className="sporkActiveRow">
              <input
                aria-label="Spork active"
                type="checkbox"
                checked={spork.activated}
                onChange={(event) => updateSpork(index, { activated: event.target.checked })}
              />
            </label>
            <button className="sporkDeleteButton" type="button" onClick={() => removeSpork(index)} aria-label={`Delete ${spork.name || "spork"}`}>
              <X size={22} />
            </button>
          </div>
        ))}
        {draft.sporks.length === 0 ? <div className="emptyState">No sporks configured</div> : null}
      </div>
      {error ? <div className="alert">{error}</div> : null}
    </form>
  );
}

function GenesisFundingEditor({
  draft,
  setDraft,
  onSave
}: {
  draft: PublicNetworkSettings;
  setDraft: React.Dispatch<React.SetStateAction<PublicNetworkSettings>>;
  onSave: (settings: PublicNetworkSettings) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateFund(index: number, updates: Partial<GenesisFundRecord>) {
    setDraft((current) => ({
      ...current,
      genesisFunds: current.genesisFunds.map((fund, candidateIndex) => (candidateIndex === index ? { ...fund, ...updates } : fund))
    }));
  }

  function addFund() {
    setDraft((current) => ({
      ...current,
      genesisFunds: [
        ...current.genesisFunds,
        {
          address: "",
          znn: 0,
          qsr: 0,
          fusedQsr: 0
        }
      ]
    }));
  }

  function removeFund(index: number) {
    setDraft((current) => ({
      ...current,
      genesisFunds: current.genesisFunds.filter((_fund, candidateIndex) => candidateIndex !== index)
    }));
  }

  async function saveFunds(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...draft,
        seeders: draft.seeders.filter(Boolean),
        bootstrapPeers: draft.bootstrapPeers.filter(Boolean)
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="genesisSporkPanel" onSubmit={saveFunds}>
      <div className="panelHeader">
        <div>
          <span className="ledger">Genesis</span>
          <h2>Funded addresses<Tooltip text={TIPS["network.funds"]} /></h2>
        </div>
        <div className="toolbar compactToolbar">
          <Button variant="secondary" icon={<Plus size={18} />} onClick={addFund}>
            Add
          </Button>
          <Button type="submit" icon={<Save size={18} />} disabled={saving}>
            {saving ? "Saving" : "Save Funding"}
          </Button>
        </div>
      </div>
      <div className="sporkRows">
        <div className="fundHeader" aria-hidden="true">
          <span>Address</span>
          <span>ZNN</span>
          <span>QSR</span>
          <span>Fused QSR</span>
          <span />
        </div>
        {draft.genesisFunds.map((fund, index) => (
          <div className="fundRow" key={index}>
            <input
              aria-label="Funded address"
              className="mono"
              value={fund.address}
              required
              pattern="z1[0-9a-z]{38}"
              placeholder="z1..."
              onChange={(event) => updateFund(index, { address: event.target.value.trim() })}
            />
            <input
              aria-label="ZNN amount"
              className="mono"
              type="number"
              min={0}
              value={fund.znn}
              onChange={(event) => updateFund(index, { znn: Number(event.target.value) })}
            />
            <input
              aria-label="QSR amount"
              className="mono"
              type="number"
              min={0}
              value={fund.qsr}
              onChange={(event) => updateFund(index, { qsr: Number(event.target.value) })}
            />
            <input
              aria-label="Fused QSR amount"
              className="mono"
              type="number"
              min={0}
              value={fund.fusedQsr}
              onChange={(event) => updateFund(index, { fusedQsr: Number(event.target.value) })}
            />
            <button className="sporkDeleteButton" type="button" onClick={() => removeFund(index)} aria-label={`Delete ${fund.address || "funded address"}`}>
              <X size={22} />
            </button>
          </div>
        ))}
        {draft.genesisFunds.length === 0 ? <div className="emptyState">No funded addresses configured</div> : null}
      </div>
      {error ? <div className="alert">{error}</div> : null}
    </form>
  );
}
