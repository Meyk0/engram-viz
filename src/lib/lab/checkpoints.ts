import { getVisibleMemories } from "@/lib/memoryVisuals";
import type { MemoryTimelineEntry } from "@/lib/timeline";
import {
  traceEventsThrough,
  type NormalizedTrace
} from "@/lib/traces/types";
import type { TurnRecord } from "@/lib/evidence/types";
import type { EngramEvent } from "@/types";
import type { MemoryCheckpoint } from "@/lib/lab/types";

export function buildTimelineCheckpoints(
  entries: readonly MemoryTimelineEntry[],
  recordsByTimelineId: Readonly<Record<string, TurnRecord>> = {}
): MemoryCheckpoint[] {
  const eventPrefix: EngramEvent[] = [];

  return entries.map((entry, index) => {
    eventPrefix.push(...entry.events);
    const record = recordsByTimelineId[entry.id];
    const retrieve = [...entry.events]
      .reverse()
      .find((event): event is Extract<EngramEvent, { type: "retrieve" }> => event.type === "retrieve");
    const loadedMemoryIds = latestLoadedMemoryIds(entry.events);

    return freezeCheckpoint({
      version: 1,
      id: `checkpoint-${entry.id}`,
      index,
      label: entry.kind === "dream"
        ? entry.title ?? "Dream review"
        : compactLabel(entry.userText ?? `Turn ${index + 1}`),
      source: entry.kind,
      sourceId: entry.id,
      createdAt: entry.completedAt ?? entry.startedAt,
      events: [...eventPrefix],
      memories: materializeMemories(eventPrefix),
      loadedMemoryIds,
      ...(retrieve ? { query: retrieve.query, retrieval: retrieve.retrieval } : {}),
      ...(entry.assistantText ? { answer: entry.assistantText } : {}),
      ...(record ? { turnRecord: record } : {})
    });
  });
}

export function buildTraceCheckpoints(trace: NormalizedTrace): MemoryCheckpoint[] {
  return trace.steps.map((step, index) => {
    const events = traceEventsThrough(trace, index);
    const retrieve = [...events]
      .reverse()
      .find((event): event is Extract<EngramEvent, { type: "retrieve" }> => event.type === "retrieve");

    return freezeCheckpoint({
      version: 1,
      id: `checkpoint-${trace.trace.id}-${step.id}`,
      index,
      label: `${index + 1}. ${step.name}`,
      source: "trace",
      sourceId: step.id,
      createdAt: step.endedAt ?? step.startedAt ?? trace.trace.startedAt ?? new Date(0).toISOString(),
      events,
      memories: materializeMemories(events),
      loadedMemoryIds: latestLoadedMemoryIds(events),
      ...(retrieve ? { query: retrieve.query, retrieval: retrieve.retrieval } : {}),
      traceStep: step
    });
  });
}

export function latestLoadedMemoryIds(events: readonly EngramEvent[]): string[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "load") return [...event.ids];
    if (event?.type === "store" || event?.type === "consolidate" || event?.type === "init") return [];
  }
  return [];
}

function materializeMemories(events: readonly EngramEvent[]) {
  return getVisibleMemories([...events].reverse()).map((memory) => structuredClone(memory));
}

function compactLabel(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 62 ? `${trimmed.slice(0, 59)}...` : trimmed;
}

function freezeCheckpoint(checkpoint: MemoryCheckpoint): MemoryCheckpoint {
  return deepFreeze(structuredClone(checkpoint));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

