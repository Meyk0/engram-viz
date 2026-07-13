import { GitBranch, X } from "lucide-react";
import { regionExplanations } from "@/lib/explanations";
import type { EngramMemory } from "@/types";

type MemoryInspectorProps = {
  active?: boolean;
  latestQuery?: string;
  memory: EngramMemory | undefined;
  onClose: () => void;
  onOpenLineage?: (memoryId: string) => void;
  open: boolean;
};

export function MemoryInspector({
  active = false,
  latestQuery,
  memory,
  onClose,
  onOpenLineage,
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
      <div
        className="memory-inspector-status"
        data-active={active}
        data-retired={memory.status === "superseded"}
      >
        {memory.status === "superseded"
          ? getRetiredLabel(memory)
          : active
            ? "Used in the latest answer"
            : "Stored, not currently in working memory"}
      </div>
      <div className="memory-inspector-text">{memory.text}</div>
      {latestQuery ? <div className="memory-inspector-query">LATEST QUESTION: {latestQuery}</div> : null}
      <div className="memory-inspector-note">
        <strong>Why here:</strong> {locationExplanation.whyHere}
      </div>
      <div className="memory-inspector-note">
        <strong>What to watch:</strong> {locationExplanation.whatToWatch}
      </div>
      {onOpenLineage ? (
        <button
          className="memory-lineage-open"
          type="button"
          onClick={() => onOpenLineage(memory.id)}
        >
          <GitBranch size={14} aria-hidden="true" />
          Trace where this memory came from
        </button>
      ) : null}
      <details className="memory-inspector-details">
        <summary>Details</summary>
        <dl className="memory-inspector-metrics">
          <div>
            <dt>BRAIN REGION</dt>
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
      </details>
    </aside>
  );
}

function getRetiredLabel(memory: EngramMemory) {
  switch (memory.retiredReason) {
    case "consolidated":
      return "Retired after consolidation into stable knowledge";
    case "dream_merge":
      return "Retired after an applied Dream merge";
    case "corrected":
    default:
      return "Retired after a newer memory replaced it";
  }
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
      whyHere: `Moved to stable knowledge after being retrieved ${memory.access_count} times. It keeps being useful, so Engram treats it as more durable.`,
      whatToWatch: "Green memory dots mark stable memories. This one should move less and act more like background knowledge."
    };
  }

  if (memory.region === "temporal") {
    return {
      whyHere: "Created by merging related new memories into one more durable summary.",
      whatToWatch: region.visualBehavior
    };
  }

  return {
    whyHere: region.llmRole,
    whatToWatch: region.visualBehavior
  };
}
