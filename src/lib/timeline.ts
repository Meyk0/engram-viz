import { getEventRegions } from "@/lib/regions";
import type { BrainRegion, DreamProposal, EngramEvent } from "@/types";

export const timelineDemoPrompts = [
  "I love the color indigo.",
  "What color do I love?",
  "I moved to San Francisco a couple years ago.",
  "Actually, I moved to Oakland now.",
  "What city do I live in now?"
] as const;

export type MemoryTimelineEntryStatus = "running" | "completed" | "error" | "applied" | "dismissed";

export type MemoryTimelineEntry = {
  id: string;
  kind: "conversation" | "dream";
  status: MemoryTimelineEntryStatus;
  userText?: string;
  assistantText?: string;
  title?: string;
  events: EngramEvent[];
  startedAt: string;
  completedAt?: string;
};

export type MemoryTimelineStep = {
  id: string;
  label: string;
  body: string;
  eventType: EngramEvent["type"];
  memoryIds: string[];
  regions: BrainRegion[];
};

export type TimelineFocus = {
  memoryIds: string[];
  regions: BrainRegion[];
};

export function createConversationTimelineEntry(input: {
  id: string;
  startedAt: string;
  userText: string;
}): MemoryTimelineEntry {
  return {
    id: input.id,
    kind: "conversation",
    status: "running",
    userText: input.userText,
    assistantText: "",
    events: [],
    startedAt: input.startedAt
  };
}

export function appendTimelineEvent(
  entries: MemoryTimelineEntry[],
  entryId: string,
  event: EngramEvent
): MemoryTimelineEntry[] {
  return entries.map((entry) =>
    entry.id === entryId
      ? {
          ...entry,
          events: [...entry.events, event]
        }
      : entry
  );
}

export function appendTimelineAssistantText(
  entries: MemoryTimelineEntry[],
  entryId: string,
  delta: string
): MemoryTimelineEntry[] {
  return entries.map((entry) =>
    entry.id === entryId
      ? {
          ...entry,
          assistantText: `${entry.assistantText ?? ""}${delta}`
        }
      : entry
  );
}

export function completeTimelineEntry(
  entries: MemoryTimelineEntry[],
  entryId: string,
  input: { completedAt: string; status?: MemoryTimelineEntryStatus }
): MemoryTimelineEntry[] {
  return entries.map((entry) =>
    entry.id === entryId
      ? {
          ...entry,
          completedAt: input.completedAt,
          status: input.status ?? "completed"
        }
      : entry
  );
}

export function dreamTimelineEntryId(proposalId: string) {
  return `timeline-dream-${proposalId}`;
}

export function createDreamTimelineEntry(input: {
  events: EngramEvent[];
  proposal: DreamProposal;
  startedAt: string;
}): MemoryTimelineEntry {
  return {
    id: dreamTimelineEntryId(input.proposal.id),
    kind: "dream",
    status: input.proposal.status === "skipped" ? "completed" : "running",
    title: "Dream Mode",
    events: input.events,
    startedAt: input.startedAt
  };
}

export function buildDreamTimelineEvents(proposal: DreamProposal): EngramEvent[] {
  const events: EngramEvent[] = [{ type: "dream_start", proposal }];
  const reviewIds = unique(proposal.operations.flatMap((operation) => operation.sourceIds));

  if (reviewIds.length > 0) {
    events.push({ type: "dream_review", proposalId: proposal.id, ids: reviewIds });
  }

  proposal.operations.forEach((operation) => {
    switch (operation.type) {
      case "merge":
        events.push({ type: "dream_merge", proposalId: proposal.id, operation });
        break;
      case "supersede":
        events.push({ type: "dream_supersede", proposalId: proposal.id, operation });
        break;
      case "insight":
        events.push({ type: "dream_insight", proposalId: proposal.id, operation });
        break;
    }
  });

  events.push({ type: "dream_complete", proposal });
  return events;
}

export function buildTimelineSteps(entry: MemoryTimelineEntry): MemoryTimelineStep[] {
  return entry.events.flatMap((event, index) => {
    const step = eventToTimelineStep(event);
    return step ? [{ ...step, id: `${entry.id}-${event.type}-${index}` }] : [];
  });
}

export function getTimelineFocus(entry?: MemoryTimelineEntry | null): TimelineFocus {
  if (!entry) return { memoryIds: [], regions: [] };

  const steps = buildTimelineSteps(entry);
  return {
    memoryIds: unique(steps.flatMap((step) => step.memoryIds)),
    regions: unique(steps.flatMap((step) => step.regions))
  };
}

function eventToTimelineStep(event: EngramEvent): Omit<MemoryTimelineStep, "id"> | null {
  switch (event.type) {
    case "init":
    case "decay":
      return null;
    case "plan":
      if (event.decision.operation === "ignore" && (event.decision.relatedMemoryIds?.length ?? 0) > 0) {
        return {
          label: "Answered from memory",
          body: "The question used retrieved memory, so nothing new was stored.",
          eventType: event.type,
          memoryIds: event.decision.relatedMemoryIds ?? [],
          regions: ["prefrontal"]
        };
      }
      if (event.decision.operation === "ignore") {
        return {
          label: "No new memory",
          body: friendlyIgnoreSummary(event.decision.reason),
          eventType: event.type,
          memoryIds: [],
          regions: []
        };
      }
      return {
        label: "Memory decision",
        body: "Engram checked whether this turn should change memory.",
        eventType: event.type,
        memoryIds: event.decision.ids ?? [],
        regions: []
      };
    case "store":
      return {
        label: event.memory.supersedes?.length ? "Updated memory" : "Stored new memory",
        body: event.memory.supersedes?.length
          ? `Current memory: "${event.memory.text}"`
          : `New raw memory: "${event.memory.text}"`,
        eventType: event.type,
        memoryIds: [event.memory.id, ...(event.memory.supersedes ?? [])],
        regions: [event.memory.region]
      };
    case "retrieve":
      return {
        label: event.ids.length > 0 ? "Found relevant memory" : "Searched memory",
        body: event.ids.length > 0
          ? `${pluralize(event.ids.length, "memory")} matched: "${event.query}"`
          : `No stored memory matched: "${event.query}"`,
        eventType: event.type,
        memoryIds: event.ids,
        regions: event.ids.length > 0 ? ["prefrontal"] : []
      };
    case "load":
      return {
        label: "Loaded working memory",
        body: `${pluralize(event.ids.length, "memory")} copied into prefrontal active context.`,
        eventType: event.type,
        memoryIds: event.ids,
        regions: event.ids.length > 0 ? ["prefrontal"] : []
      };
    case "fire":
      return {
        label: event.region === "prefrontal" ? "Used in answer" : `${regionLabel(event.region)} lit up`,
        body: event.region === "prefrontal"
          ? `${pluralize(event.ids.length, "memory")} influenced the active answer.`
          : `${pluralize(event.ids.length, "memory")} pulsed in ${regionLabel(event.region)}.`,
        eventType: event.type,
        memoryIds: event.ids,
        regions: event.ids.length > 0 ? [event.region] : []
      };
    case "consolidate":
      return {
        label: "Stabilized related memories",
        body: `${pluralize(event.removed.length, "raw memory")} merged into: "${event.added.text}"`,
        eventType: event.type,
        memoryIds: [...event.removed, event.added.id],
        regions: ["hippocampus", event.added.region]
      };
    case "dream_start":
      return {
        label: "Started dream",
        body: "Engram started an offline-style review of existing memories.",
        eventType: event.type,
        memoryIds: dreamProposalMemoryIds(event.proposal),
        regions: ["hippocampus"]
      };
    case "dream_review":
      return {
        label: "Reviewed memories",
        body: `${pluralize(event.ids.length, "memory")} compared before any change is applied.`,
        eventType: event.type,
        memoryIds: event.ids,
        regions: ["hippocampus"]
      };
    case "dream_merge":
      return {
        label: "Drafted merge",
        body: `Proposed merge: "${event.operation.result?.text ?? "related memories"}"`,
        eventType: event.type,
        memoryIds: [...event.operation.sourceIds, ...(event.operation.result ? [event.operation.result.id] : [])],
        regions: ["hippocampus", "temporal"]
      };
    case "dream_supersede":
      return {
        label: "Drafted update",
        body: `${pluralize(event.operation.supersedeIds?.length ?? event.operation.sourceIds.length, "memory")} would be retired from active recall.`,
        eventType: event.type,
        memoryIds: [...event.operation.sourceIds, ...(event.operation.supersedeIds ?? [])],
        regions: ["hippocampus", "temporal"]
      };
    case "dream_insight":
      return {
        label: "Drafted insight",
        body: `Proposed insight: "${event.operation.result?.text ?? "recurring memory pattern"}"`,
        eventType: event.type,
        memoryIds: [...event.operation.sourceIds, ...(event.operation.result ? [event.operation.result.id] : [])],
        regions: ["hippocampus", "temporal"]
      };
    case "dream_complete":
      return {
        label: event.proposal.operations.length > 0 ? "Dream ready" : "Dream complete",
        body: event.proposal.operations.length > 0
          ? `${pluralize(event.proposal.operations.length, "dream change")} is ready to review.`
          : "No safe memory changes were found, so current memories stayed unchanged.",
        eventType: event.type,
        memoryIds: dreamProposalMemoryIds(event.proposal),
        regions: ["hippocampus"]
      };
    case "dream_apply":
      return {
        label: "Applied dream",
        body: `${pluralize(event.proposal.operations.length, "dream change")} updated visible memory.`,
        eventType: event.type,
        memoryIds: dreamProposalMemoryIds(event.proposal),
        regions: ["temporal"]
      };
    case "dream_dismiss":
      return {
        label: "Kept current memories",
        body: "No memory changes were applied.",
        eventType: event.type,
        memoryIds: dreamProposalMemoryIds(event.proposal),
        regions: ["hippocampus"]
      };
  }
}

function dreamProposalMemoryIds(proposal: DreamProposal) {
  return unique(
    proposal.operations.flatMap((operation) => [
      ...operation.sourceIds,
      ...(operation.supersedeIds ?? []),
      ...(operation.result ? [operation.result.id] : [])
    ])
  );
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

function regionLabel(region: BrainRegion) {
  switch (region) {
    case "prefrontal":
      return "working memory";
    case "hippocampus":
      return "hippocampus";
    case "temporal":
      return "stable knowledge";
  }
}

function pluralize(count: number, word: string) {
  const nextWord = count === 1 ? word : word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`;
  return `${count} ${nextWord}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function getTimelineEntryRegions(entry: MemoryTimelineEntry): BrainRegion[] {
  const stepRegions = getTimelineFocus(entry).regions;
  if (stepRegions.length > 0) return stepRegions;
  return unique(entry.events.flatMap(getEventRegions));
}
