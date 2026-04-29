import type { BrainRegion, EngramEvent } from "@/types";

export const firstTimeCaptions: Partial<Record<EngramEvent["type"], string>> = {
  store: "This is episodic memory - a raw fact, stored as it came in.",
  retrieve: "This is retrieval - semantic search across stored memories.",
  consolidate: "This is consolidation - the system distilling related episodes into one summary.",
  decay: "Memories don't get deleted in LLM systems - they just drop in retrieval ranking."
};

export const regionExplanations: Record<
  BrainRegion,
  { label: string; concept: string; description: string; capacity: number }
> = {
  prefrontal: {
    label: "Prefrontal Cortex",
    concept: "Active Context Window",
    description: "Everything the model has loaded right now. Finite - when full, older memories drop out.",
    capacity: 10
  },
  hippocampus: {
    label: "Hippocampus",
    concept: "Episodic Store",
    description: "Where new memories land. Recent, raw, awaiting distillation.",
    capacity: 20
  },
  temporal: {
    label: "Temporal Cortex",
    concept: "Semantic Memory",
    description: "Long-term semantic memory. Facts that have been consolidated from many episodes.",
    capacity: 50
  }
};

export function explainEvent(event: EngramEvent): string {
  switch (event.type) {
    case "store":
      return "New facts land here as raw episodes.";
    case "retrieve":
      return "Semantic search pulled memories into active consideration.";
    case "fire":
      return "Retrieved memories are loaded into the active context window.";
    case "consolidate":
      return "Repeated facts about a topic are distilled into one summary.";
    case "load":
      return "Selected memories are being prepared for the next response.";
    case "decay":
      return "Lower-ranked memories dim without being deleted.";
    case "init":
      return "The current session memory state is assembling.";
  }
}
