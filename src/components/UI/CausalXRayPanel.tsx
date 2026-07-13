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
  const influence = result ? clampInfluence(result.estimatedInfluence) : 0;
  const influencePercent = Math.round(influence * 100);

  return (
    <aside
      className="secondary-panel secondary-panel-right causal-xray-panel"
      aria-busy={pending}
      aria-label="Causal X-Ray"
    >
      <header className="causal-xray-header">
        <div>
          <div className="causal-xray-eyebrow">
            <FlaskConical aria-hidden="true" size={12} />
            Causal X-Ray
          </div>
          <h2 id="causal-xray-title">Estimated influence</h2>
        </div>
        <button className="causal-xray-close" type="button" onClick={onClose} aria-label="Close Causal X-Ray">
          <X aria-hidden="true" size={14} />
        </button>
      </header>

      <div className="causal-xray-body">
        <section className="causal-xray-memory" aria-labelledby="causal-xray-memory-label">
          <div className="causal-xray-section-label" id="causal-xray-memory-label">
            Memory being removed
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

            <section className="causal-xray-influence" aria-labelledby="causal-xray-meter-label">
              <div className="causal-xray-influence-heading">
                <div>
                  <h3 id="causal-xray-meter-label">Estimated influence</h3>
                  <span>{result.changed ? "Answer changed" : "No material change detected"}</span>
                </div>
                <strong>{influencePercent}%</strong>
              </div>
              <div
                className="causal-xray-meter"
                role="meter"
                aria-label="Estimated influence"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={influencePercent}
                aria-valuetext={`${influencePercent} percent`}
              >
                <span style={{ width: `${influencePercent}%` }} />
              </div>
            </section>

            <p className="causal-xray-caveat">
              <strong>Caveat</strong>
              {result.caveat}
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

function clampInfluence(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function formatRegion(region: EngramMemory["region"]) {
  if (region === "prefrontal") return "Working memory";
  if (region === "hippocampus") return "Episodic store";
  return "Stable knowledge";
}
