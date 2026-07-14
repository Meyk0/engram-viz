import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  ScanSearch,
  ShieldAlert,
  X
} from "lucide-react";
import type { MemoryIntegrityFinding, MemoryIntegrityReport } from "@/lib/integrity/types";
import "./memory-integrity.css";

type MemoryIntegrityPanelProps = {
  onClose: () => void;
  onFocusMemoryIds: (ids: string[]) => void;
  onOpenTimeMachine: (memoryIds: string[]) => void;
  report: MemoryIntegrityReport;
  timeMachineAvailable: boolean;
};

export function MemoryIntegrityPanel({
  onClose,
  onFocusMemoryIds,
  onOpenTimeMachine,
  report,
  timeMachineAvailable
}: MemoryIntegrityPanelProps) {
  const actionable = report.findings.filter((finding) => finding.severity !== "info");

  return (
    <aside className="secondary-panel secondary-panel-right memory-integrity-panel" aria-label="Memory Integrity">
      <header className="integrity-header">
        <div>
          <div className="integrity-eyebrow"><ShieldAlert size={12} /> Memory Integrity</div>
          <h2>Audit the memory state</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Memory Integrity"><X size={14} /></button>
      </header>

      <div className="integrity-scroll">
        <section className="integrity-summary" data-status={report.status}>
          <div className="integrity-summary-mark">
            {report.status === "clear" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          </div>
          <div>
            <span>Deterministic rule scan</span>
            <strong>{statusTitle(report.status)}</strong>
            <p>
              {report.activeMemoryCount} active {plural(report.activeMemoryCount, "memory")}; {actionable.length} actionable {plural(actionable.length, "finding")}.
            </p>
          </div>
          <dl>
            <div><dt>Affected</dt><dd>{report.affectedMemoryCount}</dd></div>
            <div><dt>Risk points</dt><dd>{report.riskPoints}</dd></div>
          </dl>
        </section>

        <p className="integrity-score-note">
          Risk points prioritize triage only. They are rule weights, not a probability that a memory is wrong or malicious.
        </p>

        <section className="integrity-findings" aria-label="Integrity findings">
          <div className="integrity-section-heading">
            <span><ScanSearch size={12} /> Findings</span>
            <b>{report.findings.length}</b>
          </div>
          {report.findings.length > 0 ? (
            <ol>
              {report.findings.map((finding) => (
                <IntegrityFindingCard
                  finding={finding}
                  key={finding.id}
                  onFocus={() => onFocusMemoryIds(finding.memoryIds)}
                  onOpenTimeMachine={timeMachineAvailable
                    ? (memoryId) => onOpenTimeMachine([memoryId])
                    : undefined}
                />
              ))}
            </ol>
          ) : (
            <div className="integrity-empty">
              <CheckCircle2 size={18} />
              <strong>No rule violations found</strong>
              <p>The current active memory set passed Engram&apos;s deterministic checks.</p>
            </div>
          )}
        </section>

        <p className="integrity-caveat">{report.caveat}</p>
      </div>
    </aside>
  );
}

function IntegrityFindingCard({
  finding,
  onFocus,
  onOpenTimeMachine
}: {
  finding: MemoryIntegrityFinding;
  onFocus: () => void;
  onOpenTimeMachine?: (memoryId: string) => void;
}) {
  return (
    <li className="integrity-finding" data-severity={finding.severity}>
      <header>
        <span>{finding.severity}</span>
        <b>Observed rule evidence</b>
      </header>
      <h3>{finding.title}</h3>
      <p>{finding.summary}</p>
      <div className="integrity-evidence-list">
        {finding.evidence.map((evidence, index) => (
          <article key={`${evidence.memoryId}-${evidence.field}-${index}`}>
            <div>
              <span>{evidence.field}</span>
              <code>{compactId(evidence.memoryId)}</code>
            </div>
            <q>{evidence.excerpt}</q>
            {onOpenTimeMachine ? (
              <button type="button" onClick={() => onOpenTimeMachine(evidence.memoryId)}>
                <GitBranch size={11} /> Quarantine in branch
              </button>
            ) : null}
          </article>
        ))}
      </div>
      <div className="integrity-recommendation">
        <strong>Recommended</strong>
        <span>{finding.recommendation}</span>
      </div>
      <button className="integrity-focus" type="button" onClick={onFocus}>
        <ScanSearch size={11} /> Locate in brain
      </button>
    </li>
  );
}

function statusTitle(status: MemoryIntegrityReport["status"]) {
  if (status === "attention") return "Action recommended";
  if (status === "review") return "Review suggested";
  return "No actionable findings";
}

function compactId(id: string) {
  return id.length > 22 ? `${id.slice(0, 10)}...${id.slice(-7)}` : id;
}

function plural(count: number, word: string) {
  return count === 1 ? word : `${word}s`;
}
