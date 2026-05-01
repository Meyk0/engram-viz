import { X } from "lucide-react";
import type { MemoryExplanation } from "@/lib/explanations";

type ExplainabilityPanelProps = {
  explanations: MemoryExplanation[];
  onClose: () => void;
  open: boolean;
};

export function ExplainabilityPanel({ explanations, onClose, open }: ExplainabilityPanelProps) {
  if (!open || explanations.length === 0) return null;

  return (
    <aside className="secondary-panel secondary-panel-right explainability-panel" aria-label="Memory explainability panel">
      <div className="secondary-panel-header">
        <div>
          <div className="secondary-panel-eyebrow">Memory</div>
          <div className="secondary-panel-title">Why this memory</div>
        </div>
        <button className="panel-icon-btn" type="button" onClick={onClose} aria-label="Close memory explanation">
          <X size={13} />
        </button>
      </div>
      <div className="explanation-list">
        {explanations.slice(0, 4).map((explanation) => (
          <article className="explanation-item" data-region={explanation.region} key={explanation.id}>
            <div className="explanation-source">{explanation.sourceLabel}</div>
            <div className="explanation-memory">{explanation.text}</div>
            <dl className="explanation-metrics">
              <div>
                <dt>REGION</dt>
                <dd>
                  {explanation.regionLabel}
                  <span>{explanation.regionConcept}</span>
                </dd>
              </div>
              <div>
                <dt>RETRIEVED</dt>
                <dd>{explanation.accessCount}</dd>
              </div>
              <div>
                <dt>IMPORTANCE</dt>
                <dd>{Math.round(explanation.importance * 100)}%</dd>
              </div>
            </dl>
            <div className="matched-words" aria-label="Matched words">
              {explanation.matchedWords.length > 0 ? (
                explanation.matchedWords.map((word) => <span key={word}>{word}</span>)
              ) : (
                <span className="matched-empty">NO LEXICAL OVERLAP</span>
              )}
            </div>
            {explanation.sourceQuery ? <div className="source-query">QUERY: {explanation.sourceQuery}</div> : null}
          </article>
        ))}
      </div>
    </aside>
  );
}
