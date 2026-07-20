import type {
  AgentTurnEnvelope,
  MemoryTelemetryEvent,
  TelemetryMemoryOwner
} from "@engramviz/core";
import { telemetryEventToEngramEvent } from "@/lib/telemetry/compat";
import type { StoredMemoryTelemetryEvent } from "@/lib/ingest/types";
import type { StoredAgentTurn } from "@/lib/turns/store";
import type { JsonValue, NormalizedTrace, TraceMemoryMapping } from "@/lib/traces/types";
import type { EngramEvent, EngramMemory, MemoryRetrievalTrace } from "@/types";

export function buildTelemetryTraces(
  turns: readonly StoredAgentTurn[],
  storedEvents: readonly StoredMemoryTelemetryEvent[]
): NormalizedTrace[] {
  const orderedTurns = [...turns].sort((left, right) =>
    left.turn.startedAt.localeCompare(right.turn.startedAt) || left.cursor - right.cursor
  );
  const eventsByTrace = new Map<string, StoredMemoryTelemetryEvent[]>();
  for (const record of storedEvents) {
    const key = tracePartitionKey(record.tenantId, record.projectId, record.event.traceId);
    const records = eventsByTrace.get(key) ?? [];
    records.push(record);
    eventsByTrace.set(key, records);
  }
  const memoryStates = new Map<string, Map<string, EngramMemory>>();

  return orderedTurns.map((storedTurn) => {
    const traceKey = tracePartitionKey(storedTurn.tenantId, storedTurn.projectId, storedTurn.turn.traceId);
    const matchingEvents = (eventsByTrace.get(traceKey) ?? [])
      .filter((record) =>
        eventBelongsToTurn(record.event, storedTurn.turn) && (
          !storedTurn.turn.telemetryEventIds?.length ||
          storedTurn.turn.telemetryEventIds.includes(record.eventId)
        )
      )
      .sort((left, right) => left.event.sequence - right.event.sequence || left.cursor - right.cursor);
    const declaredOwner = declaredTurnOwner(storedTurn.turn);
    const observedOwner = inferSingleEventOwner(matchingEvents);
    const inferredOwner = mergeCompatibleOwners(declaredOwner, observedOwner) ?? declaredOwner ?? observedOwner;
    const identityTurn = inferredOwner
      ? {
          ...storedTurn.turn,
          owner: inferredOwner,
          ...(storedTurn.turn.userId || !inferredOwner.userId ? {} : { userId: inferredOwner.userId })
        }
      : storedTurn.turn;
    const partitionKey = statePartitionKey(storedTurn, inferredOwner);
    const memoryState = memoryStates.get(partitionKey) ?? new Map<string, EngramMemory>();
    memoryStates.set(partitionKey, memoryState);
    const traceEvents = matchingEvents
      .filter((record) => eventBelongsToTurn(record.event, identityTurn))
      .map((record) => ({ ...record, event: eventVisibleToTurn(record.event, identityTurn) }));
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
        ...(turn.userId ? { userId: turn.userId } : {}),
        ...(turn.owner ? { owner: turn.owner } : {}),
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
  const candidateMemories = event.operation === "retrieve"
    ? candidateSnapshotMemories(event)
    : [];
  const mappedWithMemory = mapped.type === "retrieve"
    ? {
        ...mapped,
        accessed: uniqueMemories([
          ...candidateMemories,
          ...mapped.ids.flatMap((id) => {
            const memory = memoryState.get(id);
            return memory ? [structuredClone(memory)] : [];
          })
        ]),
        retrieval: hasSelectionEvidence(event)
          ? mapped.retrieval
          : candidateOnlyRetrieval(mapped.retrieval, event.retrieval?.candidates?.length ?? 0)
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

function candidateSnapshotMemories(event: MemoryTelemetryEvent): EngramMemory[] {
  return event.retrieval?.candidates?.flatMap((candidate) => {
    if (!candidate.memory) return [];
    const mapped = telemetryEventToEngramEvent({
      ...event,
      operation: "store",
      memory: candidate.memory,
      memoryIds: undefined,
      retrieval: undefined,
      mutation: undefined
    });
    return mapped?.type === "store" ? [mapped.memory] : [];
  }) ?? [];
}

function uniqueMemories(memories: readonly EngramMemory[]) {
  return [...new Map(memories.map((memory) => [memory.id, structuredClone(memory)])).values()];
}

function hasSelectionEvidence(event: MemoryTelemetryEvent) {
  return event.retrieval?.selectedIds !== undefined ||
    Boolean(event.retrieval?.candidates?.some((candidate) => candidate.selected !== undefined));
}

function candidateOnlyRetrieval(
  retrieval: MemoryRetrievalTrace | undefined,
  candidateCount: number
): MemoryRetrievalTrace {
  return {
    provider: retrieval?.provider ?? "fallback",
    candidateCount,
    ...(retrieval?.eligibleCount !== undefined ? { eligibleCount: retrieval.eligibleCount } : {}),
    ...(retrieval?.limit !== undefined ? { limit: retrieval.limit } : {}),
    reason: "Candidate generation was observed, but downstream selection was not."
  };
}

function tracePartitionKey(tenantId: string, projectId: string, traceId: string) {
  return JSON.stringify([tenantId, projectId, traceId]);
}

function statePartitionKey(storedTurn: StoredAgentTurn, inferredOwner?: TelemetryMemoryOwner) {
  const { turn } = storedTurn;
  const principal = principalKey(turn, inferredOwner);
  return JSON.stringify([storedTurn.tenantId, storedTurn.projectId, principal]);
}

function eventBelongsToTurn(event: MemoryTelemetryEvent, turn: AgentTurnEnvelope) {
  if (event.traceId !== turn.traceId) return false;
  if (turn.sessionId && event.sessionId && turn.sessionId !== event.sessionId) return false;
  if (turn.userId && event.userId && turn.userId !== event.userId) return false;
  const owner = declaredTurnOwner(turn);
  if (owner && event.owner && ownersConflict(owner, event.owner)) return false;
  if (owner && event.memory?.owner && ownersConflict(owner, event.memory.owner)) return false;
  return true;
}

function eventVisibleToTurn(event: MemoryTelemetryEvent, turn: AgentTurnEnvelope): MemoryTelemetryEvent {
  if (event.operation !== "retrieve" || !event.retrieval?.candidates) return event;
  const owner = turnIdentity(turn);
  const candidates = event.retrieval.candidates.filter((candidate) =>
    !candidate.memory?.owner || !owner || !ownersConflict(owner, candidate.memory.owner)
  );
  if (candidates.length === event.retrieval.candidates.length) return event;
  const visibleIds = new Set(candidates.map((candidate) => candidate.memoryId));
  const hiddenIds = new Set(event.retrieval.candidates
    .map((candidate) => candidate.memoryId)
    .filter((id) => !visibleIds.has(id)));
  return {
    ...event,
    ...(event.memoryIds ? { memoryIds: event.memoryIds.filter((id) => !hiddenIds.has(id)) } : {}),
    retrieval: {
      ...event.retrieval,
      candidates,
      ...(event.retrieval.selectedIds ? {
        selectedIds: event.retrieval.selectedIds.filter((id) => !hiddenIds.has(id))
      } : {}),
      ...(event.retrieval.loadedIds ? {
        loadedIds: event.retrieval.loadedIds.filter((id) => !hiddenIds.has(id))
      } : {})
    }
  };
}

function principalKey(turn: AgentTurnEnvelope, inferredOwner?: TelemetryMemoryOwner) {
  const owner = inferredOwner ?? turn.owner;
  if (owner?.ownerId || owner?.namespace || owner?.agentId || owner?.sessionId) {
    return `owner:${ownerKey(owner)}`;
  }
  const userId = owner?.userId ?? turn.userId;
  if (userId) return `user:${userId}`;
  if (turn.sessionId) return `session:${turn.sessionId}`;
  return `trace:${turn.traceId}`;
}

function declaredTurnOwner(turn: AgentTurnEnvelope): TelemetryMemoryOwner | undefined {
  if (turn.owner) return turn.owner;
  return turn.userId ? { userId: turn.userId } : undefined;
}

function inferSingleEventOwner(records: readonly StoredMemoryTelemetryEvent[]): TelemetryMemoryOwner | undefined {
  const owners = records.flatMap((record) => {
    const { event } = record;
    return [
      ...(event.owner ? [event.owner] : []),
      ...(!event.owner && event.userId ? [{ userId: event.userId }] : []),
      ...(event.memory?.owner ? [event.memory.owner] : []),
      ...(event.retrieval?.candidates?.flatMap((candidate) => candidate.memory?.owner ? [candidate.memory.owner] : []) ?? [])
    ];
  });
  if (owners.length === 0) return undefined;
  let merged = owners[0]!;
  for (const owner of owners.slice(1)) {
    const next = mergeCompatibleOwners(merged, owner);
    if (!next) return undefined;
    merged = next;
  }
  return merged;
}

function turnIdentity(turn: AgentTurnEnvelope): TelemetryMemoryOwner | undefined {
  if (turn.owner) return turn.owner;
  if (turn.userId || turn.sessionId) {
    return {
      ...(turn.userId ? { userId: turn.userId } : {}),
      ...(turn.sessionId ? { sessionId: turn.sessionId } : {})
    };
  }
  return undefined;
}

function ownerKey(owner: TelemetryMemoryOwner) {
  return JSON.stringify({
    ownerId: owner.ownerId ?? null,
    userId: owner.userId ?? null,
    sessionId: owner.sessionId ?? null,
    agentId: owner.agentId ?? null,
    namespace: owner.namespace ?? null
  });
}

function ownersConflict(left: TelemetryMemoryOwner, right: TelemetryMemoryOwner) {
  const scalarKeys = ["ownerId", "userId", "sessionId", "agentId"] as const;
  let compared = false;
  for (const key of scalarKeys) {
    if (!left[key] || !right[key]) continue;
    compared = true;
    if (left[key] !== right[key]) return true;
  }
  if (left.namespace && right.namespace) {
    compared = true;
    if (ownerKey({ namespace: left.namespace }) !== ownerKey({ namespace: right.namespace })) return true;
  }
  return !compared;
}

function mergeCompatibleOwners(
  left: TelemetryMemoryOwner | undefined,
  right: TelemetryMemoryOwner | undefined
): TelemetryMemoryOwner | undefined {
  if (!left) return right;
  if (!right) return left;
  if (ownersConflict(left, right)) return undefined;
  return {
    ...left,
    ...right,
    ...(left.namespace || right.namespace ? { namespace: right.namespace ?? left.namespace } : {})
  };
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
