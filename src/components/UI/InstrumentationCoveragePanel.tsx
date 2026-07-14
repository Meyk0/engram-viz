import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleHelp,
  Route,
  X
} from "lucide-react";
import {
  analyzeInstrumentationCoverage,
  type InstrumentationCapabilityCoverage,
  type InstrumentationCoverageStatus
} from "@/lib/traces/coverage";
import type { NormalizedTrace } from "@/lib/traces/types";
import "./instrumentation-coverage.css";

type InstrumentationCoveragePanelProps = {
  onClose: () => void;
  trace: NormalizedTrace;
};

const STATUS_LABELS: Record<InstrumentationCoverageStatus, string> = {
  observed: "Observed",
  mapped: "Mapped",
  partial: "Partial",
  unavailable: "Unavailable"
};

export function InstrumentationCoveragePanel({
  onClose,
  trace
}: InstrumentationCoveragePanelProps) {
  const report = analyzeInstrumentationCoverage(trace);

  return (
    <aside
      className="secondary-panel secondary-panel-right instrumentation-coverage-panel"
      aria-label="Instrumentation coverage"
    >
      <header className="coverage-header">
        <div>
          <div className="coverage-eyebrow"><CircleHelp size={12} /> Evidence boundary</div>
          <h2>Instrumentation coverage</h2>
          <p>What this trace can support</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close instrumentation coverage">
          <X size={14} />
        </button>
      </header>

      <div className="coverage-scroll">
        <section className="coverage-summary" aria-label="Coverage status summary">
          {(Object.keys(STATUS_LABELS) as InstrumentationCoverageStatus[]).map((status) => (
            <div data-status={status} key={status}>
              <strong>{report.summary[status]}</strong>
              <span>{STATUS_LABELS[status]}</span>
            </div>
          ))}
        </section>

        <ol className="coverage-capabilities" aria-label="Trace capability coverage">
          {report.capabilities.map((capability) => (
            <CoverageRow capability={capability} key={capability.id} />
          ))}
        </ol>

        <p className="coverage-caveat">
          <AlertTriangle aria-hidden="true" size={13} />
          <span>{report.caveat}</span>
        </p>
      </div>
    </aside>
  );
}

function CoverageRow({
  capability
}: {
  capability: InstrumentationCapabilityCoverage;
}) {
  return (
    <li className="coverage-capability" data-status={capability.status}>
      <div className="coverage-status-icon" aria-hidden="true">
        {statusIcon(capability.status)}
      </div>
      <div>
        <header>
          <h3>{capability.label}</h3>
          <span>{STATUS_LABELS[capability.status]}</span>
        </header>
        <p>{capability.reason}</p>
        {capability.evidence.length > 0 ? (
          <small>
            {capability.evidence.length} recorded evidence {capability.evidence.length === 1 ? "item" : "items"}
          </small>
        ) : null}
      </div>
    </li>
  );
}

function statusIcon(status: InstrumentationCoverageStatus) {
  if (status === "observed") return <CheckCircle2 size={14} />;
  if (status === "mapped") return <Route size={14} />;
  if (status === "partial") return <CircleDashed size={14} />;
  return <CircleHelp size={14} />;
}

