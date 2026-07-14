import { FlaskConical, X } from "lucide-react";
import type { CausalAblationResult, TurnRecord } from "@/lib/evidence/types";
import type { EngramMemory } from "@/types";
import "./causal-xray.css";

export type CausalXRayPanelProps = {
  record: TurnRecord;
  memory: EngramMemory;
  result?: CausalAblationResult;
  pending?: boolean;
  error?: string | null;
  onRun: () => void;
  onClose: () => void;
};

export function CausalXRayPanel({
  record,
  memory,
  result,
  pending = false,
  error,
  onRun,
  onClose
}: CausalXRayPanelProps) {
  return (
    <aside
      className="secondary-panel secondary-panel-right causal-xray-panel"
      aria-busy={pending}
      aria-describedby="ablation-replay-method"
      aria-label="Ablation Replay"
    >
      <header className="causal-xray-header">
        <div>
          <div className="causal-xray-eyebrow">
            <FlaskConical aria-hidden="true" size={12} />
            Controlled memory test
          </div>
          <h2 id="causal-xray-title">Ablation Replay</h2>
        </div>
        <button className="causal-xray-close" type="button" onClick={onClose} aria-label="Close Ablation Replay">
          <X aria-hidden="true" size={14} />
        </button>
      </header>

      <div className="causal-xray-body">
        <section className="causal-xray-original" aria-labelledby="ablation-replay-method-label">
          <h3 id="ablation-replay-method-label">What this tests</h3>
          <p id="ablation-replay-method">
            Engram reruns this recorded turn with its original retrieved context, then with one selected
            memory omitted. It tests whether that observable context change alters the output; it does
            not reveal hidden model reasoning.
          </p>
        </section>

        <section className="causal-xray-memory" aria-labelledby="causal-xray-memory-label">
          <div className="causal-xray-section-label" id="causal-xray-memory-label">
            Memory omitted in replay
          </div>
          <blockquote>{memory.text}</blockquote>
          <div className="causal-xray-memory-meta">
            <span>{memory.topic ?? "Uncategorized"}</span>
            <span>{formatRegion(memory.region)}</span>
          </div>
        </section>

        <section className="causal-xray-original" aria-labelledby="causal-xray-original-label">
          <h3 id="causal-xray-original-label">Original answer</h3>
          <p>{record.originalAnswer}</p>
        </section>

        {result ? (
          <div className="causal-xray-results" aria-live="polite">
            <div className="causal-xray-comparison">
              <AnswerSample
                label="Baseline rerun"
                detail="Same memory context"
                answer={result.baselineAnswer}
              />
              <AnswerSample
                label="Answer without memory"
                detail="Selected memory omitted"
                answer={result.counterfactualAnswer}
                counterfactual
              />
            </div>

            <section className="causal-xray-influence" aria-labelledby="causal-xray-outcome-label">
              <div className="causal-xray-influence-heading">
                <div>
                  <h3 id="causal-xray-outcome-label">Observed replay outcome</h3>
                  <span>{result.changed ? "Answer changed when this memory was omitted" : "Answer stayed the same in this replay"}</span>
                </div>
                <strong data-outcome={result.comparison.outcome}>
                  {result.changed ? "Changed" : "Stable"}
                </strong>
              </div>
              <dl className="causal-xray-evidence" aria-label="Replay evidence">
                <div>
                  <dt>Runs</dt>
                  <dd>{result.comparison.baselineRuns + result.comparison.counterfactualRuns}</dd>
                </div>
                <div>
                  <dt>Baseline context</dt>
                  <dd>{record.retrievedMemories.length} memories</dd>
                </div>
                <div>
                  <dt>Replay context</dt>
                  <dd>{Math.max(0, record.retrievedMemories.length - result.excludedMemoryIds.length)} memories</dd>
                </div>
                <div>
                  <dt>Text difference</dt>
                  <dd>{differenceLabel(result.comparison.normalizedTextDistance)}</dd>
                </div>
              </dl>
            </section>

            <p className="causal-xray-caveat">
              <strong>Interpret carefully</strong>
              <span>
                {result.caveat} One replay does not establish causality; model sampling, provider
                behavior, or other uncontrolled runtime differences may also change the answer.
              </span>
            </p>
          </div>
        ) : (
          <div className="causal-xray-run-state" aria-live="polite">
            {error ? <p className="causal-xray-error" role="alert">{error}</p> : null}
            <button className="causal-xray-run" type="button" onClick={onRun} disabled={pending}>
              <FlaskConical aria-hidden="true" size={14} />
              {pending ? "Running without memory..." : "Run without this memory"}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function AnswerSample({
  answer,
  counterfactual = false,
  detail,
  label
}: {
  answer: string;
  counterfactual?: boolean;
  detail: string;
  label: string;
}) {
  return (
    <section className="causal-xray-answer" data-counterfactual={counterfactual} aria-label={label}>
      <div className="causal-xray-answer-heading">
        <h3>{label}</h3>
        <span>{detail}</span>
      </div>
      <p>{answer}</p>
    </section>
  );
}

function differenceLabel(distance: number) {
  if (distance === 0) return "None";
  if (distance < 0.2) return "Small";
  if (distance < 0.55) return "Material";
  return "Substantial";
}

function formatRegion(region: EngramMemory["region"]) {
  if (region === "prefrontal") return "Working memory";
  if (region === "hippocampus") return "Episodic store";
  return "Stable knowledge";
}
