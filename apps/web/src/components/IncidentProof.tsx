"use client";

import { useState } from "react";

const steps = [
  {
    phase: "Capture",
    provenance: "Observed",
    title: "The correction was stored.",
    description: "The trace contains both the previous location and the newer correction.",
    leftLabel: "Previous memory",
    leftValue: "San Francisco",
    leftMeta: "superseded",
    rightLabel: "Current memory",
    rightValue: "Oakland",
    rightMeta: "active",
    result: "The right fact exists in memory."
  },
  {
    phase: "Diagnose",
    provenance: "Observed",
    title: "Retrieval selected the stale record.",
    description: "Engram follows the decision boundary from candidates to loaded context.",
    leftLabel: "Retrieved",
    leftValue: "San Francisco",
    leftMeta: "stale",
    rightLabel: "Ignored",
    rightValue: "Oakland",
    rightMeta: "current",
    result: "Observed: the stale record was selected and loaded before generation."
  },
  {
    phase: "Replay",
    provenance: "Replayed",
    title: "Change one memory decision.",
    description: "The frozen turn is rerun with the current record selected instead.",
    leftLabel: "Original answer",
    leftValue: "San Francisco",
    leftMeta: "failed",
    rightLabel: "Replay answer",
    rightValue: "Oakland",
    rightMeta: "corrected",
    result: "The controlled replay changes the answer."
  },
  {
    phase: "Test",
    provenance: "Verified",
    title: "Keep the repair executable.",
    description: "The retrieval expectation and corrected answer become a portable regression.",
    leftLabel: "Must exclude",
    leftValue: "San Francisco",
    leftMeta: "stale",
    rightLabel: "Must include",
    rightValue: "Oakland",
    rightMeta: "current",
    result: "The fixture passed its retrieval and answer assertions."
  }
] as const;

export function IncidentProof() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = steps[activeIndex];

  return (
    <div className="incident-proof">
      <nav aria-label="Incident workflow" className="incident-proof-nav">
        {steps.map((step, index) => (
          <button
            aria-current={index === activeIndex ? "step" : undefined}
            key={step.phase}
            onClick={() => setActiveIndex(index)}
            type="button"
          >
            <span>0{index + 1}</span>
            {step.phase}
          </button>
        ))}
      </nav>

      <div className="incident-proof-stage" data-phase={active.phase.toLocaleLowerCase()}>
        <header>
          <div>
            <span className="proof-provenance"><i />{active.provenance}</span>
            <h3>{active.title}</h3>
          </div>
          <p>{active.description}</p>
        </header>

        <div className="proof-question">
          <span>Frozen turn</span>
          <strong>What city do I live in now?</strong>
        </div>

        <div className="proof-comparison">
          <section>
            <span>{active.leftLabel}</span>
            <strong>{active.leftValue}</strong>
            <small>{active.leftMeta}</small>
          </section>
          <div aria-hidden="true" className="proof-arrow">→</div>
          <section>
            <span>{active.rightLabel}</span>
            <strong>{active.rightValue}</strong>
            <small>{active.rightMeta}</small>
          </section>
        </div>

        <footer>
          <span>Finding</span>
          <strong>{active.result}</strong>
        </footer>
      </div>
    </div>
  );
}
