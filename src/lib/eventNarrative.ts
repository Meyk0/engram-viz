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
      title: "Try a memory",
      body: "Tell Engram one durable fact, then ask a related question."
    };
  }

  switch (event.type) {
    case "plan":
      if (event.decision.operation === "ignore" && (event.decision.relatedMemoryIds?.length ?? 0) > 0) {
        return {
          title: "Used memory",
          body: `${pluralize(event.decision.relatedMemoryIds?.length ?? 0, "memory")} helped answer. Nothing new was stored for this question.`,
          type: event.type,
          region: "prefrontal"
        };
      }

      if (event.decision.operation === "store") {
        return {
          title: "Preparing memory",
          body: "This looks durable, so Engram is getting ready to save it.",
          type: event.type,
          region: "hippocampus"
        };
      }

      return {
        title: "No new memory",
        body:
          event.decision.operation === "ignore"
            ? friendlyIgnoreBody(event.decision.reason)
            : "Engram checked whether this turn should change memory.",
        type: event.type
      };
    case "init":
      return {
        title: event.memories.length > 0 ? "Session memory loaded" : "Fresh memory session",
        body:
          event.memories.length > 0
            ? `${event.memories.length} existing memories are back in the brain.`
            : "No memories are stored yet. Durable facts will appear as new memory dots.",
        type: event.type
      };
    case "store":
      return {
        title: event.memory.supersedes?.length ? "Updated memory" : "Stored new memory",
        body: event.decision
          ? `Saved because it looked like ${memoryReasonLabel(event.decision.reason)}.`
          : "Saved as a new memory in the hippocampus.",
        type: event.type,
        region: event.memory.region
      };
    case "retrieve":
      return {
        title: event.ids.length > 0 ? "Retrieved" : "No match",
        body:
          event.ids.length > 0
            ? `${pluralize(event.ids.length, "memory")} matched this question.`
            : "No stored memory matched this question yet.",
        type: event.type
      };
    case "load":
      return {
        title: "Loaded working memory",
        body: `${pluralize(event.ids.length, "memory")} is now available for the answer.`,
        type: event.type,
        region: "prefrontal"
      };
    case "fire":
      if (isStoreFollowupFire(events, event)) {
        return {
          title: "Stored",
          body: "Saved as a new memory in the hippocampus.",
          type: "store",
          region: "hippocampus"
        };
      }

      if (isConsolidationFollowupFire(events, event)) {
        return {
          title: "Stabilized",
          body: "Related new memories merged into stable knowledge.",
          type: "consolidate",
          region: "temporal"
        };
      }

      return {
        title: event.region === "prefrontal" ? "Used memory" : `${regionLabel(event.region)} active`,
        body: `${pluralize(event.ids.length, "memory")} ${event.ids.length === 1 ? "is" : "are"} active in ${regionLabel(event.region)}.`,
        type: event.type,
        region: event.region
      };
    case "consolidate":
      return {
        title: "Stabilized related memories",
        body: event.decision
          ? `${pluralize(event.removed.length, "new memory")} merged into stable knowledge.`
          : `${event.removed.length} related memories merged into stable knowledge.`,
        type: event.type,
        region: event.added.region
      };
    case "decay":
      return {
        title: "Memory dimmed",
        body: `${pluralize(event.ids.length, "memory")} was less relevant to this turn, but stayed stored.`,
        type: event.type
      };
    case "dream_start":
      return {
        title: "Dream mode started",
        body: `Engram is dreaming over ${pluralize(getProposalSourceCount(event.proposal), "memory")} for possible cleanup.`,
        type: event.type,
        region: "hippocampus"
      };
    case "dream_review":
      return {
        title: "Dreaming over memories",
        body: `${pluralize(event.ids.length, "memory")} is being compared before any change is applied.`,
        type: event.type,
        region: "hippocampus"
      };
    case "dream_merge":
      return {
        title: "Drafted memory merge",
        body: "Related memories can become one cleaner stable memory if you apply the dream.",
        type: event.type,
        region: "temporal"
      };
    case "dream_supersede":
      return {
        title: "Drafted memory update",
        body: `${pluralize(event.operation.supersedeIds?.length ?? event.operation.sourceIds.length, "memory")} would fade from active recall if you apply the dream.`,
        type: event.type,
        region: "temporal"
      };
    case "dream_insight":
      return {
        title: "Drafted dream insight",
        body: "Engram found a higher-level pattern that can be saved as stable knowledge.",
        type: event.type,
        region: "temporal"
      };
    case "dream_complete":
      return {
        title: "Dream ready",
        body: `${pluralize(event.proposal.operations.length, "proposed change")} is waiting for review.`,
        type: event.type,
        region: "hippocampus"
      };
    case "dream_apply":
      return {
        title: "Dream applied",
        body: `${pluralize(event.proposal.operations.length, "memory change")} updated Engram's stored context.`,
        type: event.type,
        region: "temporal"
      };
    case "dream_dismiss":
      return {
        title: "Dream dismissed",
        body: "Current memories stayed unchanged.",
        type: event.type,
        region: "hippocampus"
      };
  }
}

function pluralize(count: number, word: string) {
  if (count === 1) return `${count} ${word}`;
  return `${count} ${word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`}`;
}

function memoryReasonLabel(reason: string) {
  switch (reason) {
    case "explicit-memory":
      return "something you explicitly asked Engram to remember";
    case "preference":
      return "a stable preference";
    case "personal-fact":
    case "personal_fact":
      return "durable personal information";
    case "place-fact":
    case "place_fact":
      return "personal context about a place";
    case "project-fact":
    case "project_fact":
      return "a durable project fact";
    case "correction":
      return "an update to an earlier memory";
    case "memory-question":
      return "a question that used memory";
    default:
      return "a durable memory";
  }
}

function friendlyIgnoreBody(reason: string) {
  switch (reason) {
    case "memory-question":
      return "This turn used memory for the answer, but did not add a new memory.";
    case "command":
      return "This was a request to do something, not a durable fact to remember.";
    case "not-durable":
    case "transient":
      return "This turn did not include a durable fact to remember.";
    default:
      return "Nothing new needed to be stored for this turn.";
  }
}

function regionLabel(region: BrainRegion) {
  switch (region) {
    case "prefrontal":
      return "working memory";
    case "hippocampus":
      return "new memories";
    case "temporal":
      return "stable knowledge";
  }
}

function getProposalSourceCount(proposal: Extract<EngramEvent, { type: "dream_start" }>["proposal"]) {
  return new Set(proposal.operations.flatMap((operation) => operation.sourceIds)).size;
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
