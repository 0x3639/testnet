import { Check } from "lucide-react";
import { PLAYBOOK_IDS, PLAYBOOKS, type PlaybookEvaluation, type PlaybookId } from "./playbooks";
import { SECTION_LABELS, type SectionId } from "./sections";

export function StepCircle({ state, index }: { state: "done" | "current" | "pending"; index: number }) {
  return <span className={`stepCircle ${state}`}>{state === "done" ? <Check size={14} /> : index + 1}</span>;
}

export function LaunchBar({ playbook, onPlaybookChange, evaluation, onNavigate }: {
  playbook: PlaybookId;
  onPlaybookChange: (id: PlaybookId) => void;
  evaluation: PlaybookEvaluation;
  onNavigate: (section: SectionId) => void;
}) {
  const current = evaluation.current;
  return (
    <div className="launchBar">
      <select className="launchSelect" value={playbook} onChange={(event) => onPlaybookChange(event.target.value as PlaybookId)} aria-label="Playbook">
        {PLAYBOOK_IDS.map((id) => (
          <option key={id} value={id}>{PLAYBOOKS[id].selectLabel}</option>
        ))}
      </select>
      <ol className="stepper" aria-label={`${evaluation.playbook.title}: ${evaluation.doneCount} of ${evaluation.total} done`}>
        {evaluation.steps.map((step) => (
          <li key={step.id} className="stepperItem">
            <button type="button" className="stepperButton" title={step.label} onClick={() => onNavigate(step.section)}>
              <StepCircle state={step.state} index={step.index} />
            </button>
            {step.index < evaluation.total - 1 ? <span className={`stepperLine${step.state === "done" ? " done" : ""}`} /> : null}
          </li>
        ))}
      </ol>
      <div className="nextHint">
        {current ? (
          <>
            <span>Next: <strong>{current.label}</strong></span>
            <button type="button" className="btn primary small" onClick={() => onNavigate(current.section)}>Go</button>
          </>
        ) : (
          <span className="mono mutedText">All steps complete</span>
        )}
        <span className="visuallyHidden">{SECTION_LABELS[current?.section ?? "status"]}</span>
      </div>
    </div>
  );
}
