import type { BrainRegion, EngramEvent } from "@/types";

export type EventNarrative = {
  title: string;
  body: string;
  type?: EngramEvent["type"];
  region?: BrainRegion;
};

export function getCurrentEventNarrative(events: EngramEvent[]): EventNarrative {
  const event = events[0];

  if (!event) {
    return {
      title: "Ready for a memory",
      body: "Tell Engram a durable fact or preference, then ask about it."
    };
  }

  switch (event.type) {
    case "init":
      return {
        title: event.memories.length > 0 ? "Session memory loaded" : "Fresh memory session",
        body:
          event.memories.length > 0
            ? `${event.memories.length} existing memories are back in the brain.`
            : "No memories are stored yet. New facts will land in the hippocampus.",
        type: event.type
      };
    case "store":
      return {
        title: "New fact stored",
        body: "A raw memory landed in the hippocampus.",
        type: event.type,
        region: event.memory.region
      };
    case "retrieve":
      return {
        title: event.ids.length > 0 ? "Memory found" : "Memory searched",
        body:
          event.ids.length > 0
            ? `${pluralize(event.ids.length, "memory")} matched this question.`
            : "No stored memory matched this question yet.",
        type: event.type
      };
    case "load":
      return {
        title: "Loaded into context",
        body: `${pluralize(event.ids.length, "memory")} copied into the finite active context window.`,
        type: event.type,
        region: "prefrontal"
      };
    case "fire":
      if (isStoreFollowupFire(events, event)) {
        return {
          title: "New fact stored",
          body: "A raw memory landed in the hippocampus.",
          type: "store",
          region: "hippocampus"
        };
      }

      if (isConsolidationFollowupFire(events, event)) {
        return {
          title: "Memories consolidated",
          body: "Related episodes merged into one temporal memory.",
          type: "consolidate",
          region: "temporal"
        };
      }

      return {
        title: "Active context firing",
        body: `${pluralize(event.ids.length, "memory")} ${event.ids.length === 1 ? "is" : "are"} being used in ${regionLabel(event.region)}.`,
        type: event.type,
        region: event.region
      };
    case "consolidate":
      return {
        title: "Memories consolidated",
        body: `${event.removed.length} related episodes merged into one temporal memory.`,
        type: event.type,
        region: event.added.region
      };
    case "decay":
      return {
        title: "Memory relevance dimmed",
        body: `${pluralize(event.ids.length, "memory")} dropped in retrieval rank but was not deleted.`,
        type: event.type
      };
  }
}

function pluralize(count: number, word: string) {
  if (count === 1) return `${count} ${word}`;
  return `${count} ${word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`}`;
}

function regionLabel(region: BrainRegion) {
  switch (region) {
    case "prefrontal":
      return "active context";
    case "hippocampus":
      return "episodic memory";
    case "temporal":
      return "semantic memory";
  }
}

function isStoreFollowupFire(events: EngramEvent[], event: Extract<EngramEvent, { type: "fire" }>) {
  const previous = events[1];
  return (
    event.region === "hippocampus" &&
    previous?.type === "store" &&
    event.ids.includes(previous.memory.id)
  );
}

function isConsolidationFollowupFire(events: EngramEvent[], event: Extract<EngramEvent, { type: "fire" }>) {
  const previous = events[1];
  return (
    event.region === "temporal" &&
    previous?.type === "consolidate" &&
    event.ids.includes(previous.added.id)
  );
}
