import type { MemoryExplanation } from "@/lib/explanations";

type ExplainabilityPanelProps = {
  explanations: MemoryExplanation[];
};

export function ExplainabilityPanel({ explanations }: ExplainabilityPanelProps) {
  return (
    <aside className="explainability-panel" aria-label="Memory explainability panel">
      <div className="explainability-header">WHY THIS MEMORY</div>
      {explanations.length > 0 ? (
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
                  <dt>ACCESS</dt>
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
              {explanation.sourceQuery ? (
                <div className="source-query">QUERY: {explanation.sourceQuery}</div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="explanation-empty">AWAITING MEMORY SIGNAL</div>
      )}
    </aside>
  );
}
