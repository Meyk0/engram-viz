"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  GitBranch,
  ScanSearch
} from "lucide-react";
import type {
  MemoryDecisionStageDiff,
  MemoryDecisionStageKind,
  MemoryPolicyReplayResult
} from "@engramviz/core";
import "./causal-memory-diff.css";

export type CausalMemoryDiffProps = {
  result: MemoryPolicyReplayResult;
  onFocusMemoryIds?: (memoryIds: string[]) => void;
};

const STAGE_LABELS: Record<MemoryDecisionStageKind, string> = {
  memory_state: "Memory state",
  retrieval: "Retrieval",
  selection: "Selection",
  active_context: "Active context",
  answer: "Answer"
};

const CAPABILITY_LABELS = {
  reusesRecordedCandidates: "Recorded candidates reused",
  rerunsCandidateGeneration: "Candidate generation",
  rerunsEligibility: "Eligibility",
  rerunsRanking: "Ranking",
  rerunsSelection: "Selection",
  rerunsContextAssembly: "Context assembly",
  rerunsGeneration: "Answer generation",
  supportsPolicyInterventions: "Policy interventions",
  supportsStateInterventions: "State interventions",
  supportsRepeatedRuns: "Repeated runs"
} as const;

type CapabilityName = keyof typeof CAPABILITY_LABELS;

export function CausalMemoryDiff({
  result,
  onFocusMemoryIds
}: CausalMemoryDiffProps) {
  const componentId = useId();
  const initialStage = result.diff.earliestDivergence
    ?? result.diff.stages[0]?.stage
    ?? "memory_state";
  const [activeStageName, setActiveStageName] = useState<MemoryDecisionStageKind>(initialStage);
  const tabRefs = useRef<Partial<Record<MemoryDecisionStageKind, HTMLButtonElement | null>>>({});
  const activeStage = result.diff.stages.find((stage) => stage.stage === activeStageName)
    ?? result.diff.stages[0];
  const selectedStageName = activeStage?.stage;

  function selectRelativeStage(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) {
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % result.diff.stages.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + result.diff.stages.length) % result.diff.stages.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = result.diff.stages.length - 1;
    }

    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextStage = result.diff.stages[nextIndex];
    if (!nextStage) return;

    setActiveStageName(nextStage.stage);
    tabRefs.current[nextStage.stage]?.focus();
  }

  return (
    <article
      className="causal-memory-diff"
      aria-labelledby={`${componentId}-title`}
      data-answer-changed={String(result.diff.answerChanged)}
      data-diff-status={result.diff.status}
    >
      <header className="causal-memory-diff__header">
        <div>
          <p className="causal-memory-diff__eyebrow">
            <FlaskConical aria-hidden="true" size={15} />
            Policy replay evidence
          </p>
          <h2 id={`${componentId}-title`}>Memory decision diff</h2>
        </div>
        <span className="causal-memory-diff__executor">
          Executor <code>{result.executor.id}@{result.executor.version}</code>
        </span>
      </header>

      <BaselineReproduction result={result} />

      <section
        className="causal-memory-diff__scope"
        aria-label="Replay capability scope"
        data-replay-level={result.level}
        data-capability-levels={result.capabilities.levels.join(" ")}
        data-deterministic={String(result.capabilities.deterministic)}
      >
        <div className="causal-memory-diff__scope-heading">
          <div>
            <span>Replay level</span>
            <code>{result.level}</code>
          </div>
          <div>
            <span>Capability levels</span>
            <code>{result.capabilities.levels.join(" ")}</code>
          </div>
          <div>
            <span>Execution</span>
            <code>{result.capabilities.deterministic ? "deterministic" : "non-deterministic"}</code>
          </div>
        </div>

        <ul className="causal-memory-diff__capabilities">
          {(Object.keys(CAPABILITY_LABELS) as CapabilityName[]).map((capability) => (
            <li
              key={capability}
              data-capability={capability}
              data-supported={String(result.capabilities[capability])}
            >
              <span>{CAPABILITY_LABELS[capability]}</span>
              <strong>{result.capabilities[capability] ? "Yes" : "No"}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="causal-memory-diff__divergence"
        aria-label="Earliest divergence"
        data-stage={result.diff.earliestDivergence ?? "none"}
        data-status={result.diff.status}
      >
        <span>Earliest divergence</span>
        <strong>
          {result.diff.earliestDivergence
            ? STAGE_LABELS[result.diff.earliestDivergence]
            : result.diff.status === "indeterminate"
              ? `Indeterminate: ${result.diff.firstIncomparableStage
                ? `${STAGE_LABELS[result.diff.firstIncomparableStage]} is not comparable`
                : "evidence is not comparable"}`
              : "No divergence observed"}
        </strong>
        <code>{result.diff.earliestDivergence ?? result.diff.status}</code>
      </section>

      <div
        className="causal-memory-diff__tabs"
        role="tablist"
        aria-label="Memory decision lifecycle"
      >
        {result.diff.stages.map((stage, index) => {
          const selected = stage.stage === selectedStageName;
          return (
            <button
              key={stage.stage}
              ref={(node) => {
                tabRefs.current[stage.stage] = node;
              }}
              id={`${componentId}-${stage.stage}-tab`}
              type="button"
              role="tab"
              aria-controls={`${componentId}-stage-panel`}
              aria-label={`${STAGE_LABELS[stage.stage]}: ${stageOutcome(stage)}`}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              data-changed={String(stage.changed)}
              data-comparable={String(stage.comparable)}
              onClick={() => setActiveStageName(stage.stage)}
              onKeyDown={(event) => selectRelativeStage(event, index)}
            >
              <span>{STAGE_LABELS[stage.stage]}</span>
              <strong>{stageOutcome(stage)}</strong>
            </button>
          );
        })}
      </div>

      {activeStage ? (
        <StagePanel
          componentId={componentId}
          stage={activeStage}
          baselineAnswer={result.baseline.answer.content}
          treatmentAnswer={result.treatment.answer.content}
          onFocusMemoryIds={onFocusMemoryIds}
        />
      ) : null}

      <footer className="causal-memory-diff__caveat">
        <AlertTriangle aria-hidden="true" size={16} />
        <div>
          <strong>Interpretation boundary</strong>
          <p>{result.caveat}</p>
          <p>
            This view reports observable replay differences only. It does not reveal hidden model
            reasoning or prove that a memory caused an answer.
          </p>
        </div>
      </footer>
    </article>
  );
}

function BaselineReproduction({ result }: { result: MemoryPolicyReplayResult }) {
  const reproduced = result.reproduction.reproduced;

  return (
    <section
      className="causal-memory-diff__reproduction"
      data-reproduced={String(reproduced)}
      role={reproduced ? "status" : "alert"}
      aria-label="Baseline reproduction status"
    >
      {reproduced
        ? <CheckCircle2 aria-hidden="true" size={18} />
        : <AlertTriangle aria-hidden="true" size={18} />}
      <div>
        <strong>{reproduced ? "Baseline reproduced" : "Baseline not reproduced"}</strong>
        <p>
          {reproduced
            ? "The replayed baseline matched the captured memory-decision stages, policy identity, executor identity, and answer before treatment comparison."
            : "The replayed baseline did not match the captured decision process or execution identity. Treatment differences cannot be attributed to the policy change alone."}
        </p>
        {!reproduced ? (
          <dl>
            <div>
              <dt>Observed answer</dt>
              <dd>{result.reproduction.observedAnswer}</dd>
            </div>
            <div>
              <dt>Replayed baseline</dt>
              <dd>{result.reproduction.replayedAnswer}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    </section>
  );
}

function StagePanel({
  baselineAnswer,
  componentId,
  onFocusMemoryIds,
  stage,
  treatmentAnswer
}: {
  baselineAnswer: string;
  componentId: string;
  onFocusMemoryIds?: (memoryIds: string[]) => void;
  stage: MemoryDecisionStageDiff;
  treatmentAnswer: string;
}) {
  return (
    <section
      id={`${componentId}-stage-panel`}
      className="causal-memory-diff__stage-panel"
      role="tabpanel"
      aria-labelledby={`${componentId}-${stage.stage}-tab`}
      data-stage={stage.stage}
      data-changed={String(stage.changed)}
      data-comparable={String(stage.comparable)}
      tabIndex={0}
    >
      <header className="causal-memory-diff__stage-heading">
        <div>
          <span>Active lifecycle stage</span>
          <h3>{STAGE_LABELS[stage.stage]}</h3>
        </div>
        <strong
          data-changed={String(stage.changed)}
          data-comparable={String(stage.comparable)}
        >
          {!stage.comparable
            ? <AlertTriangle aria-hidden="true" size={15} />
            : stage.changed
              ? <GitBranch aria-hidden="true" size={15} />
              : <CheckCircle2 aria-hidden="true" size={15} />}
          {stageOutcome(stage)}
        </strong>
      </header>

      <p className="causal-memory-diff__summary">{stage.summary}</p>

      <div className="causal-memory-diff__comparison" aria-label={`${STAGE_LABELS[stage.stage]} comparison`}>
        <ComparisonColumn
          answer={baselineAnswer}
          label="Baseline"
          memoryIds={stage.baselineMemoryIds}
          onFocusMemoryIds={onFocusMemoryIds}
        />
        <ComparisonColumn
          answer={treatmentAnswer}
          label="Treatment"
          memoryIds={stage.treatmentMemoryIds}
          onFocusMemoryIds={onFocusMemoryIds}
        />
      </div>
    </section>
  );
}

function ComparisonColumn({
  answer,
  label,
  memoryIds,
  onFocusMemoryIds
}: {
  answer: string;
  label: "Baseline" | "Treatment";
  memoryIds: string[];
  onFocusMemoryIds?: (memoryIds: string[]) => void;
}) {
  const uniqueMemoryIds = [...new Set(memoryIds)];

  return (
    <section className="causal-memory-diff__comparison-column" aria-label={`${label} result`}>
      <header>
        <h4>{label}</h4>
        {onFocusMemoryIds && uniqueMemoryIds.length > 0 ? (
          <button
            type="button"
            onClick={() => onFocusMemoryIds(uniqueMemoryIds)}
            aria-label={`Focus ${label.toLocaleLowerCase()} memory IDs`}
          >
            <ScanSearch aria-hidden="true" size={14} />
            Focus IDs
          </button>
        ) : null}
      </header>

      <div className="causal-memory-diff__memory-ids">
        <h5>{label} memory IDs</h5>
        {uniqueMemoryIds.length > 0 ? (
          <ol>
            {uniqueMemoryIds.map((memoryId) => (
              <li key={memoryId}>
                {onFocusMemoryIds ? (
                  <button
                    type="button"
                    onClick={() => onFocusMemoryIds([memoryId])}
                    aria-label={`Focus memory ${memoryId}`}
                  >
                    <code>{memoryId}</code>
                  </button>
                ) : <code>{memoryId}</code>}
              </li>
            ))}
          </ol>
        ) : <p>None</p>}
      </div>

      <div className="causal-memory-diff__answer">
        <h5>{label} answer</h5>
        <p>{answer || "No answer recorded."}</p>
      </div>
    </section>
  );
}

function stageOutcome(stage: MemoryDecisionStageDiff) {
  if (!stage.comparable) return "Not comparable";
  return stage.changed ? "Changed" : "Unchanged";
}
