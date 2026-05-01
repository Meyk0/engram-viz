import { X } from "lucide-react";
import { regionExplanations, type MemoryExplanation } from "@/lib/explanations";
import { getRegionColor } from "@/lib/regions";
import type { EngramMemory } from "@/types";

type ActiveContextPanelProps = {
  capacity: number;
  explanations: Map<string, MemoryExplanation>;
  memories: EngramMemory[];
  onClose: () => void;
  open: boolean;
  used: number;
};

export function ActiveContextPanel({
  capacity,
  explanations,
  memories,
  onClose,
  open,
  used
}: ActiveContextPanelProps) {
  if (!open) return null;

  return (
    <aside className="secondary-panel secondary-panel-right active-context-panel" aria-label="Active context panel">
      <div className="secondary-panel-header">
        <div>
          <div className="secondary-panel-eyebrow">Working Memory</div>
          <div className="secondary-panel-title">
            {used}/{capacity} loaded into active context
          </div>
        </div>
        <button className="panel-icon-btn" type="button" onClick={onClose} aria-label="Close active context">
          <X size={13} />
        </button>
      </div>
      <div className="active-context-summary">
        The prefrontal cortex shows the memories currently copied into the model&apos;s working set for this
        response.
      </div>
      {memories.length > 0 ? (
        <div className="active-context-list">
          {memories.map((memory) => {
            const explanation = explanations.get(memory.id);
            const region = regionExplanations[memory.region];
            return (
              <article
                className="active-context-item"
                data-region={memory.region}
                key={memory.id}
                style={{ color: getRegionColor(memory.region) }}
              >
                <div className="active-context-source">
                  {region.label}
                  <span>{region.concept}</span>
                </div>
                <div className="active-context-memory">{memory.text}</div>
                <dl className="active-context-metrics">
                  <div>
                    <dt>WHY LOADED</dt>
                    <dd>{explanation?.sourceLabel ?? "Selected for this response"}</dd>
                  </div>
                  <div>
                    <dt>RETRIEVED</dt>
                    <dd>{memory.access_count}</dd>
                  </div>
                  <div>
                    <dt>IMPORTANCE</dt>
                    <dd>{Math.round(memory.importance * 100)}%</dd>
                  </div>
                </dl>
                {explanation?.sourceQuery ? (
                  <div className="active-context-query">QUERY: {explanation.sourceQuery}</div>
                ) : null}
                {explanation?.matchedWords.length ? (
                  <div className="matched-words" aria-label="Active context matched words">
                    {explanation.matchedWords.map((word) => (
                      <span key={word}>{word}</span>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="active-context-empty">No memories are loaded into working memory yet.</div>
      )}
    </aside>
  );
}
