import { X } from "lucide-react";
import type { EngramEvent } from "@/types";

type EventFeedProps = {
  events: EngramEvent[];
  explainEvent: (event: EngramEvent) => string;
  onClose: () => void;
  open: boolean;
};

export function EventFeed({ events, explainEvent, onClose, open }: EventFeedProps) {
  if (!open || events.length === 0) return null;

  return (
    <aside className="secondary-panel secondary-panel-right event-feed" aria-label="Memory story">
      <div className="secondary-panel-header">
        <div>
          <div className="secondary-panel-eyebrow">{events.length} steps</div>
          <div className="secondary-panel-title">Memory story</div>
        </div>
        <button className="panel-icon-btn" type="button" onClick={onClose} aria-label="Close events panel">
          <X size={13} />
        </button>
      </div>
      <div className="event-list">
        {events.slice(0, 7).map((event, index) => (
          <article
            className="event-item"
            data-type={event.type}
            data-region={eventRegion(event)}
            key={`${event.type}-${index}-${eventKey(event)}`}
          >
            <div className="event-kind">{eventLabel(event)}</div>
            <div className="event-copy">{eventSummary(event)}</div>
            <div className="event-explainer">{explainEvent(event)}</div>
          </article>
        ))}
      </div>
    </aside>
  );
}

function eventRegion(event: EngramEvent) {
  if (event.type === "store") return event.memory.region;
  if (event.type === "fire") return event.region;
  if (event.type === "consolidate") return event.added.region;
  if (event.type === "dream_merge" || event.type === "dream_insight" || event.type === "dream_apply") return "temporal";
  if (event.type.startsWith("dream_")) return "hippocampus";
  return undefined;
}

function eventLabel(event: EngramEvent) {
  switch (event.type) {
    case "plan":
      if (event.decision.operation === "ignore" && (event.decision.relatedMemoryIds?.length ?? 0) > 0) {
        return "Answered from memory";
      }
      if (event.decision.operation === "store") return "Preparing memory";
      return event.decision.operation === "ignore" ? "No new memory" : "Memory decision";
    case "store":
      return event.memory.supersedes?.length ? "Updated memory" : "Stored new memory";
    case "retrieve":
      return event.ids.length > 0 ? "Found relevant memory" : "Searched memory";
    case "fire":
      return event.region === "prefrontal" ? "Used working memory" : `${regionName(event.region)} lit up`;
    case "consolidate":
      return "Stabilized related memories";
    case "load":
      return "Loaded active context";
    case "decay":
      return "Dimmed older signal";
    case "init":
      return "Loaded memory map";
    case "dream_start":
      return "Started reflection";
    case "dream_review":
      return "Reviewed memories";
    case "dream_merge":
      return "Drafted merge";
    case "dream_supersede":
      return "Drafted update";
    case "dream_insight":
      return "Drafted insight";
    case "dream_complete":
      return "Reflection ready";
    case "dream_apply":
      return "Applied reflection";
    case "dream_dismiss":
      return "Kept current memories";
  }
}

function eventSummary(event: EngramEvent) {
  switch (event.type) {
    case "plan":
      if (event.decision.operation === "ignore" && (event.decision.relatedMemoryIds?.length ?? 0) > 0) {
        return "The question used retrieved memory, so nothing new was stored.";
      }
      if (event.decision.operation === "store") {
        return "This turn looks durable, so a new memory is being prepared.";
      }
      return event.decision.operation === "ignore"
        ? friendlyIgnoreSummary(event.decision.reason)
        : "Engram checked whether this turn should change memory.";
    case "store":
      return `New raw memory: "${event.memory.text}"`;
    case "retrieve":
      return event.ids.length > 0
        ? `${pluralize(event.ids.length, "memory")} matched: "${event.query}"`
        : `No stored memory matched: "${event.query}"`;
    case "fire":
      if (event.region === "prefrontal") {
        return `${pluralize(event.ids.length, "memory")} influenced the active answer.`;
      }
      return `${pluralize(event.ids.length, "memory")} pulsed in ${regionName(event.region)}.`;
    case "consolidate":
      return `${pluralize(event.removed.length, "raw memory")} merged into: "${event.added.text}"`;
    case "load":
      return `${pluralize(event.ids.length, "memory")} copied into prefrontal working memory.`;
    case "decay":
      return `${pluralize(event.ids.length, "memory")} stayed stored, but became less relevant to this turn.`;
    case "init":
      return `The brain started with ${pluralize(event.memories.length, "stored memory")}.`;
    case "dream_start":
      return "Engram started an offline-style review of existing memories.";
    case "dream_review":
      return `${pluralize(event.ids.length, "memory")} compared before any change is applied.`;
    case "dream_merge":
      return `Proposed merge: "${event.operation.result?.text ?? "related memories"}"`;
    case "dream_supersede":
      return `${pluralize(event.operation.supersedeIds?.length ?? event.operation.sourceIds.length, "memory")} would be retired from active recall.`;
    case "dream_insight":
      return `Proposed insight: "${event.operation.result?.text ?? "recurring memory pattern"}"`;
    case "dream_complete":
      return `${pluralize(event.proposal.operations.length, "reflection change")} is ready to review.`;
    case "dream_apply":
      return `${pluralize(event.proposal.operations.length, "reflection change")} updated visible memory.`;
    case "dream_dismiss":
      return "No memory changes were applied.";
  }
}

function eventKey(event: EngramEvent) {
  switch (event.type) {
    case "plan":
      return `${event.decision.stage}-${event.decision.operation}-${event.decision.reason}`;
    case "store":
      return event.memory.id;
    case "consolidate":
      return event.added.id;
    case "retrieve":
      return event.query;
    case "init":
      return event.memories.map((memory) => memory.id).join(".");
    case "dream_start":
    case "dream_complete":
    case "dream_apply":
    case "dream_dismiss":
      return event.proposal.id;
    case "dream_review":
      return `${event.proposalId}-${event.ids.join(".")}`;
    case "dream_merge":
    case "dream_supersede":
    case "dream_insight":
      return `${event.proposalId}-${event.operation.id}`;
    default:
      return event.ids.join(".");
  }
}

function regionName(region: "prefrontal" | "hippocampus" | "temporal") {
  switch (region) {
    case "prefrontal":
      return "prefrontal working memory";
    case "hippocampus":
      return "hippocampus";
    case "temporal":
      return "temporal semantic memory";
  }
}

function pluralize(count: number, word: string) {
  const nextWord = count === 1 ? word : word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`;
  return `${count} ${nextWord}`;
}

function friendlyIgnoreSummary(reason: string) {
  switch (reason) {
    case "memory-question":
      return "The answer used memory, but nothing new needed to be stored.";
    case "command":
      return "This was a request, not a durable memory.";
    case "not-durable":
    case "transient":
      return "This turn did not include a durable fact to remember.";
    default:
      return "Nothing new was stored for this turn.";
  }
}
