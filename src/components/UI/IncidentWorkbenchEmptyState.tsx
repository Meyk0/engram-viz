import {
  ArrowLeft,
  ArrowRight,
  FlaskConical,
  GitBranch,
  Play,
  Save,
  ScanSearch
} from "lucide-react";
import "./IncidentWorkbenchEmptyState.css";

export type IncidentWorkbenchEmptyStateProps = {
  onLoadSampleIncident: () => void;
  onReturnToLearn: () => void;
};

const workflow = [
  {
    icon: ScanSearch,
    label: "Inspect retrieval",
    detail: "See what was considered, filtered, and loaded."
  },
  {
    icon: FlaskConical,
    label: "Test without memory",
    detail: "Replay the turn with one memory removed."
  },
  {
    icon: GitBranch,
    label: "Branch a fix",
    detail: "Quarantine or replace memory without changing the live session."
  },
  {
    icon: Save,
    label: "Save regression",
    detail: "Keep the repaired behavior as a repeatable check."
  }
] as const;

export function IncidentWorkbenchEmptyState({
  onLoadSampleIncident,
  onReturnToLearn
}: IncidentWorkbenchEmptyStateProps) {
  return (
    <section
      aria-labelledby="incident-workbench-empty-title"
      className="incident-workbench-empty"
    >
      <header className="incident-workbench-empty__header">
        <span className="incident-workbench-empty__eyebrow">
          <FlaskConical aria-hidden="true" size={13} strokeWidth={1.8} />
          Investigation ready
        </span>
        <h2 id="incident-workbench-empty-title">Start with a memory incident</h2>
        <p>
          Load a recorded failure to trace the memory behind an answer, test a correction,
          and preserve the fix.
        </p>
      </header>

      <ol className="incident-workbench-empty__workflow" aria-label="Memory incident workflow">
        {workflow.map(({ detail, icon: Icon, label }, index) => (
          <li key={label}>
            <span className="incident-workbench-empty__step-number" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <Icon aria-hidden="true" size={16} strokeWidth={1.65} />
            <span className="incident-workbench-empty__step-copy">
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
            {index < workflow.length - 1 ? (
              <ArrowRight
                aria-hidden="true"
                className="incident-workbench-empty__step-arrow"
                size={13}
                strokeWidth={1.5}
              />
            ) : null}
          </li>
        ))}
      </ol>

      <div className="incident-workbench-empty__actions">
        <button
          className="incident-workbench-empty__primary"
          onClick={onLoadSampleIncident}
          type="button"
        >
          <Play aria-hidden="true" size={14} fill="currentColor" strokeWidth={1.8} />
          Load sample incident
        </button>
        <button
          className="incident-workbench-empty__secondary"
          onClick={onReturnToLearn}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={13} strokeWidth={1.8} />
          Return to Learn
        </button>
      </div>
    </section>
  );
}
