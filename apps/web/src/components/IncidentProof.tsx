"use client";

import { useState } from "react";

const steps = [
  {
    phase: "Diagnose",
    provenance: "Observed",
    title: "Find the first bad memory decision.",
    description: "Engram follows the recorded decision from memory state to answer.",
    leftLabel: "Stale state",
    leftValue: "San Francisco",
    leftMeta: "still active",
    rightLabel: "Selected",
    rightValue: "San Francisco",
    rightMeta: "loaded",
    result: "Earliest recorded failure: the stale fact remained eligible."
  },
  {
    phase: "Intervene",
    provenance: "Derived",
    title: "Change the policy, not the trace.",
    description: "Create an isolated branch that resolves explicit corrections before ranking.",
    leftLabel: "Recorded policy",
    leftValue: "Top-1 score",
    leftMeta: "stale wins",
    rightLabel: "Branch policy",
    rightValue: "Resolve updates",
    rightMeta: "current wins",
    result: "The source incident stays immutable while the alternative remains reviewable."
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
    phase: "Prove",
    provenance: "Verified",
    title: "Keep the repair executable.",
    description: "Semantic assertions test the repaired behavior across controlled variations.",
    leftLabel: "Single fixture",
    leftValue: "Oakland",
    leftMeta: "source replay",
    rightLabel: "Reliability matrix",
    rightValue: "5 / 5",
    rightMeta: "cases passed",
    result: "The checked contract covers paraphrases, entity changes, score ties, and distractors."
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
