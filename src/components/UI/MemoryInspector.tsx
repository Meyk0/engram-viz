import { X } from "lucide-react";
import { regionExplanations } from "@/lib/explanations";
import type { EngramMemory } from "@/types";

type MemoryInspectorProps = {
  active?: boolean;
  latestQuery?: string;
  memory: EngramMemory | undefined;
  onClose: () => void;
  open: boolean;
};

export function MemoryInspector({
  active = false,
  latestQuery,
  memory,
  onClose,
  open
}: MemoryInspectorProps) {
  if (!open || !memory) return null;

  const region = regionExplanations[memory.region];
  const createdAt = formatTimestamp(memory.created_at);
  const locationExplanation = getLocationExplanation(memory);

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
      <div className="memory-inspector-status" data-active={active}>
        {active ? "Used in the latest answer" : "Stored, not currently in working memory"}
      </div>
      <div className="memory-inspector-text">{memory.text}</div>
      <dl className="memory-inspector-metrics">
        <div>
          <dt>REGION</dt>
          <dd>{region.concept}</dd>
        </div>
        <div>
          <dt>IMPORTANCE</dt>
          <dd>{Math.round(memory.importance * 100)}%</dd>
        </div>
        <div>
          <dt>RETRIEVED</dt>
          <dd>{memory.access_count}</dd>
        </div>
        <div>
          <dt>TOPIC</dt>
          <dd>{memory.topic ?? "none"}</dd>
        </div>
        <div>
          <dt>CREATED</dt>
          <dd>{createdAt}</dd>
        </div>
      </dl>
      {latestQuery ? <div className="memory-inspector-query">LATEST QUESTION: {latestQuery}</div> : null}
      <div className="memory-inspector-note">
        <strong>Why here:</strong> {locationExplanation.whyHere}
      </div>
      <div className="memory-inspector-note">
        <strong>What to watch:</strong> {locationExplanation.whatToWatch}
      </div>
    </aside>
  );
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getLocationExplanation(memory: EngramMemory) {
  const region = regionExplanations[memory.region];

  if (memory.region === "temporal" && !memory.id.includes("-consolidated-")) {
    return {
      whyHere: `Moved to semantic memory after being retrieved ${memory.access_count} times. It keeps being useful, so Engram treats it as more stable knowledge.`,
      whatToWatch: "Green memory dots mark stable memories. This one should move less and act more like background knowledge."
    };
  }

  if (memory.region === "temporal") {
    return {
      whyHere: "Created by merging related hippocampus memories into one more durable summary.",
      whatToWatch: region.visualBehavior
    };
  }

  return {
    whyHere: region.llmRole,
    whatToWatch: region.visualBehavior
  };
}
