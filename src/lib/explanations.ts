import { tokenize } from "@/lib/memory/retrieve";
import type { BrainRegion, EngramEvent, EngramMemory } from "@/types";

export const regionExplanations: Record<
  BrainRegion,
  {
    label: string;
    concept: string;
    description: string;
    capacity: number;
    humanAnalogy: string;
    llmRole: string;
    visualBehavior: string;
  }
> = {
  prefrontal: {
    label: "Working Memory",
    concept: "Prefrontal Cortex",
    description: "The memories retrieved for the current answer. Temporary, finite, and cleared as the conversation moves on.",
    capacity: 10,
    humanAnalogy: "Working memory: the small set of facts held in mind while solving the current task.",
    llmRole: "Retrieved memories are copied here when they are being used to shape the next answer.",
    visualBehavior: "Cyan flashes show memories that are influencing the answer right now."
  },
  hippocampus: {
    label: "New Memories",
    concept: "Hippocampus",
    description: "Where durable facts land first. Recent, raw, and still close to the original thing you said.",
    capacity: 20,
    humanAnalogy: "New experiences enter here first before they become stable long-term knowledge.",
    llmRole: "Durable facts and preferences are saved here as raw memory traces.",
    visualBehavior: "Purple memory dots appear here first and pulse when a fact is stored."
  },
  temporal: {
    label: "Stable Knowledge",
    concept: "Temporal Cortex",
    description: "Repeated related memories can merge here into a cleaner long-term summary.",
    capacity: 50,
    humanAnalogy: "Semantic memory: stable knowledge distilled from repeated related experiences.",
    llmRole: "Related hippocampus memories can merge here into a more durable summary.",
    visualBehavior: "Green memory dots appear here after consolidation and should change less often."
  }
};

export function explainEvent(event: EngramEvent): string {
  switch (event.type) {
    case "plan":
      return event.decision.operation === "ignore"
        ? "This turn did not add a new memory."
        : "Engram checked whether this turn should change memory.";
    case "store":
      return event.decision
        ? "A durable fact or preference was stored as a raw memory."
        : "New facts land here as raw episodes.";
    case "retrieve":
      return event.ids.length > 0
        ? "Stored memories matched this question and entered active consideration."
        : "No stored memories matched this question yet.";
    case "fire":
      return "Retrieved memories are loaded into the active context window.";
    case "consolidate":
      return event.decision
        ? "Related new memories were merged into stable knowledge."
        : "Repeated facts about a topic are distilled into one summary.";
    case "load":
      return "Selected memories are being prepared for the next response.";
    case "decay":
      return "Lower-ranked memories dim without being deleted.";
    case "init":
      return "The current session memory state is assembling.";
    case "dream_start":
      return "Dream Mode reviews stored memories without changing them yet.";
    case "dream_review":
      return "These memories are being compared for possible cleanup.";
    case "dream_merge":
      return "Related memories may become one cleaner stable memory if applied.";
    case "dream_supersede":
      return "A stale or conflicting memory may be retired from active recall if applied.";
    case "dream_insight":
      return "A repeated pattern may become a stable semantic memory if applied.";
    case "dream_complete":
      return "The reflection is ready for review before any memory state changes.";
    case "dream_apply":
      return "The reviewed reflection changed visible memory state.";
    case "dream_dismiss":
      return "The reflection was dismissed, so visible memories stayed unchanged.";
  }
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
      return "Retrieved for this question";
    case "plan":
      return "Planner decision";
    case "fire":
      return "Used in working memory";
    case "load":
      return "Loaded for this answer";
    case "store":
      return "Stored as source episode";
    case "consolidate":
      return "Created by consolidation";
    case "decay":
      return "Dimmed by retrieval rank";
    case "init":
      return "Loaded from session state";
    case "dream_start":
    case "dream_review":
    case "dream_merge":
    case "dream_supersede":
    case "dream_insight":
    case "dream_complete":
      return "Proposed by Dream Mode";
    case "dream_apply":
      return "Applied from Dream Mode";
    case "dream_dismiss":
      return "Dismissed from Dream Mode";
  }
}
