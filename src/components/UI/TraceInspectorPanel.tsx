"use client";

import { CircleAlert, Eye, ListTree, Route, X } from "lucide-react";
import type { NormalizedTrace, NormalizedTraceStep, TraceMemoryMapping } from "@/lib/traces/types";
import "./trace-playback.css";

export type TraceInspectorPanelProps = {
  currentStepIndex: number;
  onClose: () => void;
  onSelectStep?: (stepIndex: number) => void;
  open: boolean;
  trace: NormalizedTrace;
};

export function TraceInspectorPanel({
  currentStepIndex,
  onClose,
  onSelectStep,
  open,
  trace
}: TraceInspectorPanelProps) {
  if (!open) return null;

  const observedCount = countMappings(trace, "observed");
  const mappedCount = countMappings(trace, "mapped");

  return (
    <aside className="secondary-panel secondary-panel-right trace-inspector-panel" aria-label="Trace inspector">
      <header className="trace-inspector-header">
        <div>
          <span className="trace-inspector-eyebrow">
            <ListTree aria-hidden="true" size={12} />
            Recorded execution
          </span>
          <h2>{trace.trace.name}</h2>
        </div>
        <button className="trace-icon-button" type="button" onClick={onClose} aria-label="Close trace inspector">
          <X aria-hidden="true" size={14} />
        </button>
      </header>

      <div className="trace-inspector-body">
        <section className="trace-inspector-metadata" aria-label="Trace metadata">
          <dl>
            <div><dt>Provider</dt><dd>{trace.trace.source.provider}</dd></div>
            <div><dt>Format</dt><dd>{trace.trace.source.format}</dd></div>
            <div><dt>Steps</dt><dd>{trace.steps.length}</dd></div>
            <div><dt>Memory events</dt><dd>{observedCount + mappedCount}</dd></div>
          </dl>
          <div className="trace-inspector-summary">
            <span data-provenance="observed"><Eye aria-hidden="true" size={11} />{observedCount} observed</span>
            <span data-provenance="mapped"><Route aria-hidden="true" size={11} />{mappedCount} mapped</span>
          </div>
        </section>

        <section className="trace-step-section" aria-labelledby="trace-step-list-title">
          <div className="trace-step-heading">
            <h3 id="trace-step-list-title">Execution steps</h3>
            <span>Source order</span>
          </div>
          {trace.steps.length > 0 ? (
            <ol className="trace-step-list">
              {trace.steps.map((step, index) => (
                <TraceStepRow
                  current={index === currentStepIndex}
                  key={step.id}
                  onSelect={onSelectStep ? () => onSelectStep(index) : undefined}
                  step={step}
                />
              ))}
            </ol>
          ) : (
            <p className="trace-step-empty">This trace contains no execution steps.</p>
          )}
        </section>

        <p className="trace-honesty-note">
          <CircleAlert aria-hidden="true" size={14} />
          <span><strong>What this shows</strong> Playback reconstructs recorded operations. Observed events were captured explicitly; mapped events were translated from recognized memory tools. Neither proves hidden model reasoning.</span>
        </p>
      </div>
    </aside>
  );
}

function TraceStepRow({
  current,
  onSelect,
  step
}: {
  current: boolean;
  onSelect?: () => void;
  step: NormalizedTraceStep;
}) {
  const content = (
    <>
      <span className="trace-step-index">{step.index + 1}</span>
      <span className="trace-step-copy">
        <span className="trace-step-meta">
          <b>{step.kind}</b>
          <i data-status={step.status}>{formatStatus(step.status)}</i>
          {current ? <em>Current</em> : null}
        </span>
        <strong>{step.name}</strong>
        {step.memoryMappings.length > 0 ? (
          <span className="trace-step-mappings">
            {step.memoryMappings.map((mapping, index) => (
              <MappingBadge key={`${mapping.sourcePath}-${index}`} mapping={mapping} />
            ))}
          </span>
        ) : (
          <span className="trace-no-memory-badge">No memory event</span>
        )}
      </span>
    </>
  );

  return (
    <li data-current={current}>
      {onSelect ? (
        <button type="button" className="trace-step-row" onClick={onSelect} aria-label={`Go to step ${step.index + 1}: ${step.name}`}>
          {content}
        </button>
      ) : (
        <div className="trace-step-row">{content}</div>
      )}
    </li>
  );
}

function MappingBadge({ mapping }: { mapping: TraceMemoryMapping }) {
  if (mapping.provenance === "inferred") {
    return <span className="trace-no-memory-badge" title={mapping.note}>No memory event</span>;
  }

  return (
    <span className="trace-memory-badge" data-provenance={mapping.provenance} title={`${mapping.note} (${mapping.sourcePath})`}>
      {mapping.provenance === "observed" ? <Eye aria-hidden="true" size={10} /> : <Route aria-hidden="true" size={10} />}
      {mapping.provenance}
      <small>{mapping.event.type}</small>
    </span>
  );
}

function countMappings(trace: NormalizedTrace, provenance: "observed" | "mapped") {
  return trace.steps.reduce(
    (count, step) => count + step.memoryMappings.filter((mapping) => mapping.provenance === provenance).length,
    0
  );
}

function formatStatus(status: NormalizedTraceStep["status"]) {
  return status === "in_progress" ? "In progress" : `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}
