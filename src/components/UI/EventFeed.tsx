import type { EngramEvent } from "@/types";

type EventFeedProps = {
  events: EngramEvent[];
  explainEvent: (event: EngramEvent) => string;
};

export function EventFeed({ events, explainEvent }: EventFeedProps) {
  return (
    <aside className="event-feed" aria-label="Memory event stream">
      <div className="event-feed-header">MEMORY STREAM</div>
      <div className="event-list">
        {events.length === 0 ? <div className="event-empty">Awaiting first memory event.</div> : null}
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
  const region = eventRegion(event);
  return region ? `${region} - ${event.type}` : event.type;
}

function eventSummary(event: EngramEvent) {
  switch (event.type) {
    case "store":
      return `Stored: "${event.memory.text}"`;
    case "retrieve":
      return `Retrieved ${event.ids.length} memories for: "${event.query}"`;
    case "fire":
      return `Fired ${event.ids.length} memories in ${event.region}`;
    case "consolidate":
      return `Consolidated ${event.removed.length} memories -> "${event.added.text}"`;
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
