import type { AgentTurnEnvelope, MemoryTelemetryEvent } from "@engramviz/core";
import { telemetryEventToEngramEvent } from "@/lib/telemetry/compat";
import type { StoredMemoryTelemetryEvent } from "@/lib/ingest/types";
import type { StoredAgentTurn } from "@/lib/turns/store";
import type { JsonValue, NormalizedTrace, TraceMemoryMapping } from "@/lib/traces/types";
import type { EngramEvent, EngramMemory } from "@/types";

export function buildTelemetryTraces(
  turns: readonly StoredAgentTurn[],
  storedEvents: readonly StoredMemoryTelemetryEvent[]
): NormalizedTrace[] {
  const orderedTurns = [...turns].sort((left, right) =>
    left.turn.startedAt.localeCompare(right.turn.startedAt) || left.cursor - right.cursor
  );
  const eventsByTrace = new Map<string, StoredMemoryTelemetryEvent[]>();
  for (const record of storedEvents) {
    const records = eventsByTrace.get(record.event.traceId) ?? [];
    records.push(record);
    eventsByTrace.set(record.event.traceId, records);
  }
  const memoryState = new Map<string, EngramMemory>();

  return orderedTurns.map((storedTurn) => {
    const traceEvents = (eventsByTrace.get(storedTurn.turn.traceId) ?? [])
      .filter((record) =>
        !storedTurn.turn.telemetryEventIds?.length ||
        storedTurn.turn.telemetryEventIds.includes(record.eventId)
      )
      .sort((left, right) => left.event.sequence - right.event.sequence || left.cursor - right.cursor);
    const trace = telemetryTurnToNormalizedTrace(storedTurn.turn, traceEvents, [...memoryState.values()]);
    for (const record of traceEvents) applyMemoryMutation(memoryState, record.event);
    return trace;
  });
}

export function telemetryTurnToNormalizedTrace(
  turn: AgentTurnEnvelope,
  storedEvents: readonly StoredMemoryTelemetryEvent[],
  memoriesBeforeTurn: readonly EngramMemory[] = []
): NormalizedTrace {
  const steps: NormalizedTrace["steps"] = [];
  const turnMemoryState = new Map(memoriesBeforeTurn.map((memory) => [memory.id, structuredClone(memory)]));
  if (memoriesBeforeTurn.length > 0) {
    const init: EngramEvent = { type: "init", memories: structuredClone([...memoriesBeforeTurn]) };
    steps.push({
      id: `${turn.turnId}:memory-state`,
      index: steps.length,
      kind: "custom",
      name: "Memory state before turn",
      status: "completed",
      startedAt: turn.startedAt,
      endedAt: turn.startedAt,
      memoryMappings: [{
        provenance: "mapped",
        event: init,
        sourcePath: "captured memory mutations before this turn",
        note: "Engram reconstructed this state from captured provider mutations; it is not a provider snapshot."
      }]
    });
  }

  for (const record of storedEvents) {
    const mapping = telemetryMapping(record.event, turnMemoryState);
    steps.push({
      id: `${turn.turnId}:memory:${record.eventId}`,
      index: steps.length,
      kind: "tool",
      name: operationName(record.event),
      status: "completed",
      startedAt: record.event.timestamp,
      endedAt: record.event.timestamp,
      input: telemetryInput(record.event),
      memoryMappings: mapping ? [mapping] : []
    });
    applyMemoryMutation(turnMemoryState, record.event);
  }

  steps.push({
    id: `${turn.turnId}:answer`,
    index: steps.length,
    kind: "model",
    name: turn.provider.model ? `${turn.provider.id} · ${turn.provider.model}` : turn.provider.id,
    status: turn.status === "error" ? "error" : "completed",
    startedAt: turn.startedAt,
    endedAt: turn.completedAt,
    input: { role: "user", content: turn.input },
    output: turn.output ? { role: "assistant", content: turn.output } : undefined,
    memoryMappings: []
  });

  return {
    schemaVersion: 1,
    trace: {
      id: turn.traceId,
      name: compactName(turn.input),
      source: { provider: turn.provider.id, format: "engram.telemetry.v2" },
      ...(turn.sessionId ? { groupId: turn.sessionId } : {}),
      startedAt: turn.startedAt,
      endedAt: turn.completedAt,
      metadata: {
        turnId: turn.turnId,
        status: turn.status,
        ...(turn.metadata ?? {})
      }
    },
    steps
  };
}

function telemetryMapping(
  event: MemoryTelemetryEvent,
  memoryState: ReadonlyMap<string, EngramMemory>
): TraceMemoryMapping | null {
  const mapped = telemetryEventToEngramEvent(event);
  if (!mapped) return null;
  const mappedWithMemory = mapped.type === "retrieve"
    ? {
        ...mapped,
        accessed: mapped.ids.flatMap((id) => {
          const memory = memoryState.get(id);
          return memory ? [structuredClone(memory)] : [];
        })
      }
    : mapped;
  return {
    provenance: event.evidence.level,
    event: mappedWithMemory,
    sourcePath: event.evidence.sourcePath ?? `${event.evidence.adapter}:${event.operation}`,
    note: event.evidence.note ?? `Captured by the ${event.evidence.adapter} adapter.`
  };
}

function applyMemoryMutation(state: Map<string, EngramMemory>, event: MemoryTelemetryEvent) {
  const mapped = telemetryEventToEngramEvent(event);
  if (mapped?.type === "store") {
    for (const supersededId of mapped.memory.supersedes ?? []) {
      const previous = state.get(supersededId);
      if (previous) state.set(supersededId, { ...previous, status: "superseded", retiredReason: "corrected" });
    }
    state.set(mapped.memory.id, mapped.memory);
    return;
  }
  if (mapped?.type === "consolidate") {
    for (const sourceId of mapped.removed) state.delete(sourceId);
    state.set(mapped.added.id, mapped.added);
    return;
  }
  if (event.operation === "supersede") {
    for (const id of event.memoryIds ?? []) {
      const previous = state.get(id);
      if (previous) state.set(id, { ...previous, status: "superseded", retiredReason: "corrected" });
    }
    return;
  }
  if (event.operation === "delete" || event.operation === "expire") {
    for (const id of event.memoryIds ?? []) state.delete(id);
  }
}

function telemetryInput(event: MemoryTelemetryEvent): JsonValue {
  if (event.operation === "retrieve") {
    return toJsonValue({
      query: event.retrieval?.query ?? "",
      selectedIds: event.retrieval?.selectedIds ?? [],
      candidates: event.retrieval?.candidates ?? []
    });
  }
  if (event.memory) return toJsonValue({ memory: event.memory });
  return { memoryIds: event.memoryIds ?? [] };
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function operationName(event: MemoryTelemetryEvent) {
  const names: Record<MemoryTelemetryEvent["operation"], string> = {
    store: "Stored memory",
    retrieve: "Retrieved memory candidates",
    load: "Loaded active context",
    update: "Updated memory",
    supersede: "Superseded stale memory",
    delete: "Deleted memory",
    summarize: "Consolidated memories",
    expire: "Expired memory"
  };
  return names[event.operation];
}

function compactName(input: string) {
  const value = input.trim().replace(/\s+/g, " ");
  return value.length > 72 ? `${value.slice(0, 69)}...` : value;
}
