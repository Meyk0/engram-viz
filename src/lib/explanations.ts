import { tokenize } from "@/lib/memory/retrieve";
import type { BrainRegion, EngramEvent, EngramMemory } from "@/types";

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
    case "plan":
      return `${plannerLabel(event.decision.provider)}: ${event.decision.reason}`;
    case "store":
      return event.decision
        ? `${plannerLabel(event.decision.provider)} stored this: ${event.decision.reason}`
        : "New facts land here as raw episodes.";
    case "retrieve":
      return `${retrievalLabel(event.retrieval?.provider)} pulled memories into active consideration.`;
    case "fire":
      return "Retrieved memories are loaded into the active context window.";
    case "consolidate":
      return event.decision
        ? `${plannerLabel(event.decision.provider)} consolidated this: ${event.decision.reason}`
        : "Repeated facts about a topic are distilled into one summary.";
    case "load":
      return "Selected memories are being prepared for the next response.";
    case "decay":
      return "Lower-ranked memories dim without being deleted.";
    case "init":
      return "The current session memory state is assembling.";
  }
}

function plannerLabel(provider: "deterministic" | "llm" | "fallback") {
  if (provider === "llm") return "OpenAI planner";
  if (provider === "fallback") return "Fallback planner";
  return "Deterministic planner";
}

function retrievalLabel(provider?: "lexical" | "semantic" | "fallback") {
  if (provider === "semantic") return "Semantic retrieval";
  if (provider === "fallback") return "Fallback retrieval";
  return "Lexical retrieval";
}

export type MemoryExplanation = {
  id: string;
  text: string;
  matchedWords: string[];
  region: BrainRegion;
  regionLabel: string;
  regionConcept: string;
  accessCount: number;
  importance: number;
  sourceEvent: EngramEvent["type"];
  sourceLabel: string;
  sourceQuery?: string;
};

type ExplanationSource =
  | { event: Extract<EngramEvent, { type: "retrieve" }>; ids: string[]; query: string }
  | { event: Extract<EngramEvent, { type: "fire" | "load" }>; ids: string[]; query?: string }
  | { event: Extract<EngramEvent, { type: "store" }>; ids: string[]; query?: string }
  | { event: Extract<EngramEvent, { type: "consolidate" }>; ids: string[]; query?: string };

export function buildMemoryExplanations(
  events: EngramEvent[],
  memories: EngramMemory[]
): MemoryExplanation[] {
  const source = findExplanationSource(events);
  if (!source) return [];

  const memoryById = new Map(memories.map((memory) => [memory.id, memory]));
  const query = source.query ?? findNearestRetrieveQuery(events, source.ids);

  return source.ids
    .map((id) => memoryById.get(id))
    .filter((memory): memory is EngramMemory => Boolean(memory))
    .map((memory) => ({
      id: memory.id,
      text: memory.text,
      matchedWords: query ? getMatchedWords(query, memory) : [],
      region: memory.region,
      regionLabel: regionExplanations[memory.region].label,
      regionConcept: regionExplanations[memory.region].concept,
      accessCount: memory.access_count,
      importance: memory.importance,
      sourceEvent: source.event.type,
      sourceLabel: sourceEventLabel(source.event),
      sourceQuery: query
    }));
}

export function getMatchedWords(query: string, memory: Pick<EngramMemory, "text" | "topic">): string[] {
  const queryTokens = tokenize(query);
  const memoryTokens = tokenize([memory.text, memory.topic].filter(Boolean).join(" "));

  return [...queryTokens].filter((token) => memoryTokens.has(token)).sort();
}

function findExplanationSource(events: EngramEvent[]): ExplanationSource | undefined {
  for (const event of events) {
    if (event.type === "retrieve") return { event, ids: event.ids, query: event.query };
    if (event.type === "fire" || event.type === "load") return { event, ids: event.ids };
    if (event.type === "store") return { event, ids: [event.memory.id] };
    if (event.type === "consolidate") return { event, ids: [event.added.id] };
  }

  return undefined;
}

function findNearestRetrieveQuery(events: EngramEvent[], ids: string[]): string | undefined {
  for (const event of events) {
    if (event.type === "retrieve" && ids.some((id) => event.ids.includes(id))) {
      return event.query;
    }
  }

  return undefined;
}

function sourceEventLabel(event: EngramEvent): string {
  switch (event.type) {
    case "retrieve":
      return "Retrieved into candidate set";
    case "plan":
      return "Planner decision";
    case "fire":
      return "Fired into active context";
    case "load":
      return "Loaded for response context";
    case "store":
      return "Stored as source episode";
    case "consolidate":
      return "Created by consolidation";
    case "decay":
      return "Dimmed by retrieval rank";
    case "init":
      return "Loaded from session state";
  }
}
