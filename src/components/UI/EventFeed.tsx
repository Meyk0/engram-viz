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
    <aside className="secondary-panel secondary-panel-right event-feed" aria-label="Event log">
      <div className="secondary-panel-header">
        <div>
          <div className="secondary-panel-eyebrow">{events.length} events</div>
          <div className="secondary-panel-title">Event log</div>
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
  return undefined;
}

function eventLabel(event: EngramEvent) {
  if (event.type === "plan") return `${event.decision.stage} - ${event.decision.operation}`;
  const region = eventRegion(event);
  return region ? `${region} - ${event.type}` : event.type;
}

function eventSummary(event: EngramEvent) {
  switch (event.type) {
    case "plan":
      return `${plannerLabel(event.decision.provider)} ${event.decision.operation}: ${event.decision.reason}`;
    case "store":
      return event.decision
        ? `Stored: "${event.memory.text}" (${percent(event.decision.confidence)} confidence)`
        : `Stored: "${event.memory.text}"`;
    case "retrieve":
      return `Retrieved ${event.ids.length} memories via ${retrievalLabel(event.retrieval?.provider)} for: "${event.query}"`;
    case "fire":
      return `Fired ${event.ids.length} memories in ${event.region}`;
    case "consolidate":
      return event.decision
        ? `Consolidated ${event.removed.length} memories -> "${event.added.text}" (${percent(event.decision.confidence)} confidence)`
        : `Consolidated ${event.removed.length} memories -> "${event.added.text}"`;
    case "load":
      return `Loaded ${event.ids.length} memories`;
    case "decay":
      return `Dimmed ${event.ids.length} lower-ranked memories`;
    case "init":
      return `Initialized ${event.memories.length} memories`;
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
    default:
      return event.ids.join(".");
  }
}

function plannerLabel(provider: "deterministic" | "llm" | "fallback") {
  if (provider === "llm") return "OpenAI";
  if (provider === "fallback") return "Fallback";
  return "Deterministic";
}

function retrievalLabel(provider?: "lexical" | "semantic" | "fallback") {
  if (provider === "semantic") return "semantic search";
  if (provider === "fallback") return "fallback search";
  return "lexical search";
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}
