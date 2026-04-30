import { X } from "lucide-react";
import { regionExplanations } from "@/lib/explanations";
import type { EngramMemory } from "@/types";

type MemoryInspectorProps = {
  memory: EngramMemory | undefined;
  onClose: () => void;
  open: boolean;
};

export function MemoryInspector({ memory, onClose, open }: MemoryInspectorProps) {
  if (!open || !memory) return null;

  const region = regionExplanations[memory.region];

  return (
    <aside className="secondary-panel secondary-panel-right memory-inspector" aria-label="Selected memory">
      <div className="secondary-panel-header memory-inspector-header">
        <div>
          <div className="memory-inspector-eyebrow">{region.concept}</div>
          <div className="memory-inspector-title">{region.label}</div>
        </div>
        <button className="panel-icon-btn" type="button" onClick={onClose} aria-label="Close memory inspector">
          <X size={13} />
        </button>
      </div>
      <div className="memory-inspector-text">{memory.text}</div>
      <dl className="memory-inspector-metrics">
        <div>
          <dt>IMPORTANCE</dt>
          <dd>{Math.round(memory.importance * 100)}%</dd>
        </div>
        <div>
          <dt>ACCESS</dt>
          <dd>{memory.access_count}</dd>
        </div>
        <div>
          <dt>TOPIC</dt>
          <dd>{memory.topic ?? "none"}</dd>
        </div>
      </dl>
      <div className="memory-inspector-note">{region.description}</div>
    </aside>
  );
}
