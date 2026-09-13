import type { AdminOverview } from "../../shared/types";
import { formatUtc } from "../shared/format";
import { StepCircle } from "./LaunchBar";
import type { PlaybookEvaluation } from "./playbooks";
import { SECTION_LABELS, type SectionId } from "./sections";
import { SectionHeader } from "./SectionHeader";
import { isOnline, nodeHealth, type TelemetryNode } from "./telemetry";
import { Tooltip } from "./Tooltip";
import { READINESS_TIPS, TIPS } from "./tooltips";

export function LaunchOps({ overview, nodes, settingsDirty, evaluation, onNavigate }: {
  overview: AdminOverview;
  nodes: TelemetryNode[];
  settingsDirty: boolean;
  evaluation: PlaybookEvaluation;
  onNavigate: (section: SectionId) => void;
}) {
  const admins = overview.users.filter((u) => u.role === "admin").length;
  const operators = overview.users.length - admins;
  const healthy = nodes.filter((n) => isOnline(n)).length;
  const attention = nodes.filter((n) => !isOnline(n));
  const firstAttention = attention[0];
  const genesis = new Date(overview.settings.genesisTimestampSec * 1000).toISOString();

  return (
    <>
      <SectionHeader
        kicker={`Testnet-${overview.settings.chainIdentifier} · genesis ${formatUtc(genesis)}`}
        title="Launch Ops"
        aside={
          <span className="mono mutedText">
            <span className={`liveDot${evaluation.complete ? " on" : ""}`} />{" "}
            {evaluation.complete ? "All steps complete" : `${evaluation.doneCount} of ${evaluation.total} steps done`}
          </span>
        }
      />
      <div className="sectionCards">
        <button type="button" className="sectionCard" onClick={() => onNavigate("users")}>
          <span className="ledger">Users</span>
          <strong className="mono">{overview.users.length}</strong>
          <small>{admins} admin{admins === 1 ? "" : "s"} · {operators} operator{operators === 1 ? "" : "s"}</small>
        </button>
        <button type="button" className={`sectionCard${attention.length ? " danger" : ""}`} onClick={() => onNavigate("nodes")}>
          <span className="ledger">Nodes</span>
          <strong className="mono">{healthy}<span className="mutedText">/{nodes.length} healthy</span></strong>
          <small>{firstAttention ? `${firstAttention.name} ${nodeHealth(firstAttention).label.toLowerCase()} — needs attention` : nodes.length ? "All nodes healthy" : "No nodes yet"}</small>
        </button>
        <button type="button" className={`sectionCard${settingsDirty ? " warn" : ""}`} onClick={() => onNavigate("network")}>
          <span className="ledger">Network</span>
          <strong className="mono">{settingsDirty ? "Draft" : "Saved"}</strong>
          <small>{settingsDirty ? "Unsaved changes — save to unlock Finalize" : "Settings are saved"}</small>
        </button>
        <button type="button" className="sectionCard" onClick={() => onNavigate("release")}>
          <span className="ledger">Release</span>
          <strong className="mono">{overview.published ? formatUtc(overview.published.publishedAt) : "—"}</strong>
          <small>{overview.published ? "Published" : overview.finalizedAt ? "Finalized · not published yet" : "Not finalized · nothing published yet"}</small>
        </button>
      </div>
      <section className="panel">
        <div className="panelHeader"><div><span className="ledger">Playbook</span><h2>{evaluation.playbook.title}<Tooltip text={TIPS["launch.checklist"]} /></h2></div></div>
        <div className="checklist">
          {evaluation.steps.map((step) => (
            <button key={step.id} type="button" className={`checklistRow ${step.state}`} onClick={() => onNavigate(step.section)}>
              <StepCircle state={step.state} index={step.index} />
              <strong>{step.label}{step.optional ? <span className="mutedText"> (optional)</span> : null}</strong>
              <span className="mutedText">{step.description}</span>
              <span className="ledger">{SECTION_LABELS[step.section]}</span>
            </button>
          ))}
        </div>
      </section>
      <div className="readinessTiles">
        {overview.readiness.map((check) => (
          <div key={check.label} className="readinessTile">
            <span className={`readinessDot${check.ok ? " ok" : ""}`} />
            <div><strong>{check.label}{READINESS_TIPS[check.label] ? <Tooltip text={READINESS_TIPS[check.label]} /> : null}</strong><small className="mutedText">{check.detail}</small></div>
          </div>
        ))}
      </div>
    </>
  );
}
