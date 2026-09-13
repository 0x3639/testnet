import { CheckCircle2, Copy, FileJson, Server } from "lucide-react";
import { useMemo, useState } from "react";
import type { AdminOverview, PublishedArtifactsInfo } from "../../shared/types";
import { copy, download, formatUtc, publicUrl } from "../shared/format";
import { Button } from "../shared/ui";
import { StepCircle } from "./LaunchBar";
import { SectionHeader } from "./SectionHeader";
import { Tooltip } from "./Tooltip";
import { TIPS } from "./tooltips";

function PublishedArtifacts({ published }: { published: PublishedArtifactsInfo }) {
  const genesisUrl = publicUrl(published.genesisPath);
  const configUrl = publicUrl(published.configPath);
  const nodePlanUrl = published.nodePlanPath ? publicUrl(published.nodePlanPath) : "";

  return (
    <div className="publishedBlock">
      <div className="publishedHeader">
        <div className="publishedStamp">
          <span className="ledger">Published</span>
          <strong>{new Date(published.publishedAt).toLocaleString()}</strong>
        </div>
        <div className="publishedMeta">
          <span className="mono mutedText">chain {published.chainIdentifier}</span>
          <span className="mono mutedText">{published.seeders.length} seeder{published.seeders.length === 1 ? "" : "s"}</span>
          <span className="mono mutedText">
            {published.bootstrapPeers.length} bootstrap peer{published.bootstrapPeers.length === 1 ? "" : "s"}
          </span>
          {published.genesisStartAt ? <span className="mono mutedText">genesis {formatUtc(published.genesisStartAt)}</span> : null}
          {published.actions?.applyAt ? <span className="statusPill warn">Apply {formatUtc(published.actions.applyAt)}</span> : null}
          {published.release ? <span className="mono mutedText">{published.release.goZenon.ref}</span> : null}
          {published.actions?.wipeData ? <span className="statusPill warn">Wipe data</span> : null}
        </div>
      </div>
      <div className="publishedRows">
        <div className="publishedRow">
          <span className="ledger">Genesis</span>
          <a className="mono" href={genesisUrl}>
            {genesisUrl}
          </a>
          <Button variant="secondary" icon={<Copy size={18} />} onClick={() => copy(genesisUrl)}>
            Copy
          </Button>
        </div>
        <div className="publishedRow">
          <span className="ledger">Config</span>
          <a className="mono" href={configUrl}>
            {configUrl}
          </a>
          <Button variant="secondary" icon={<Copy size={18} />} onClick={() => copy(configUrl)}>
            Copy
          </Button>
        </div>
        {nodePlanUrl ? (
          <div className="publishedRow">
            <span className="ledger">Node Plan</span>
            <a className="mono" href={nodePlanUrl}>
              {nodePlanUrl}
            </a>
            <Button variant="secondary" icon={<Copy size={18} />} onClick={() => copy(nodePlanUrl)}>
              Copy
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ReleaseSection({
  overview,
  settingsDirty,
  wipeOnPublish,
  publishing,
  onFinalize,
  onPublish
}: {
  overview: AdminOverview;
  settingsDirty: boolean;
  wipeOnPublish: boolean;
  publishing: boolean;
  onFinalize: () => Promise<void>;
  onPublish: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"genesis" | "config">("genesis");
  const json = useMemo(() => JSON.stringify(tab === "genesis" ? overview.genesis : overview.configTemplate, null, 2), [overview, tab]);
  const finalized = Boolean(overview.finalizedAt);
  const published = Boolean(overview.published);
  const pillarCount = overview.pillars.length;
  const minPillars = overview.settings.minPillars;

  return (
    <>
      <SectionHeader title="Release" description="Three actions, in order. Each unlocks the next." />
      <section className="panel releaseCard">
        <div className="releaseCardHeader">
          <StepCircle state="done" index={0} />
          <div>
            <h2>Review artifacts<Tooltip text={TIPS["release.review"]} /></h2>
            <p className="mutedText">Check the generated genesis.json and config.json.</p>
          </div>
          <div className="toolbar compactToolbar">
            <Button variant="secondary" icon={<FileJson size={18} />} onClick={() => download("/api/admin/genesis.json")}>
              Download genesis
            </Button>
            <Button variant="secondary" icon={<FileJson size={18} />} onClick={() => download("/api/admin/config-template.json")}>
              Download config
            </Button>
          </div>
        </div>
        <div className="tabs">
          <button className={tab === "genesis" ? "active" : ""} type="button" onClick={() => setTab("genesis")}>
            genesis.json
          </button>
          <button className={tab === "config" ? "active" : ""} type="button" onClick={() => setTab("config")}>
            config.json
          </button>
        </div>
        <pre>{json}</pre>
      </section>
      <section className="panel releaseCard">
        <div className="releaseCardHeader">
          <StepCircle state={finalized ? "done" : "current"} index={1} />
          <div>
            <h2>Finalize genesis<Tooltip text={TIPS["release.finalize"]} /></h2>
            <p className="mutedText">
              {overview.finalizedAt
                ? `Finalized ${new Date(overview.finalizedAt).toLocaleString()}`
                : `Not finalized yet. Requires saved settings, at least ${minPillars} pillars (${pillarCount} registered), a future genesis time and a spork address.`}
            </p>
          </div>
          <Button icon={<CheckCircle2 size={18} />} onClick={() => void onFinalize()} disabled={settingsDirty}>
            Finalize
          </Button>
        </div>
      </section>
      <section className="panel releaseCard">
        <div className="releaseCardHeader">
          <StepCircle state={published ? "done" : finalized ? "current" : "pending"} index={2} />
          <div>
            <h2>Publish release<Tooltip text={TIPS["release.publish"]} /></h2>
            <p className="mutedText">
              {finalized
                ? "Makes the artifacts public and instructs every bootstrapped node to install this release."
                : "Locked until the genesis is finalized."}
            </p>
          </div>
          <Button icon={<Server size={18} />} onClick={() => void onPublish()} disabled={publishing || settingsDirty || !finalized}>
            {publishing ? "Publishing" : "Publish Release"}
          </Button>
        </div>
        <div className={`wipeBanner${wipeOnPublish ? " danger" : ""}`}>
          Wipe node data on publish: <strong>{wipeOnPublish ? "on" : "off"}</strong>
          <Tooltip text={TIPS["release.wipe"]} />
        </div>
      </section>
      <section className="panel">
        <div className="panelHeader">
          <div>
            <span className="ledger">Public</span>
            <h2>Published artifacts</h2>
          </div>
        </div>
        {overview.published ? (
          <PublishedArtifacts published={overview.published} />
        ) : (
          <div className="emptyState">
            Nothing published yet. After publishing, public URLs for genesis.json, config.json and node-plan.json appear here.
          </div>
        )}
      </section>
    </>
  );
}
