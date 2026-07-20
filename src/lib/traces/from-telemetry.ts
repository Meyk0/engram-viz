import type {
  AgentTurnEnvelope,
  MemoryTelemetryPrincipal,
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
  const traceTurnCounts = countTurnsByTrace(orderedTurns);
  const contexts = orderedTurns.map((storedTurn) => {
    const matchingEvents = storedEvents
      .filter((record) => eventMatchesStoredTurn(record, storedTurn, traceTurnCounts))
      .sort(compareStoredEvents);
    const traceKey = tracePartitionKey(storedTurn.tenantId, storedTurn.projectId, storedTurn.turn.traceId);
    const ambiguousAssociation = (traceTurnCounts.get(traceKey) ?? 0) > 1 && storedEvents.some((record) =>
      record.tenantId === storedTurn.tenantId &&
      record.projectId === storedTurn.projectId &&
      record.event.traceId === storedTurn.turn.traceId &&
      !record.event.turnId &&
      !storedTurn.turn.telemetryEventIds?.includes(record.eventId)
    );
    return resolveTurnContext(storedTurn, matchingEvents, ambiguousAssociation);
  });
  const globalMutations = contexts
    .flatMap((context) => context.events.map((record) => ({ context, record })))
    .filter(({ record }) => isMutation(record.event))
    .filter((item, index, all) => all.findIndex((candidate) =>
      candidate.record.tenantId === item.record.tenantId &&
      candidate.record.projectId === item.record.projectId &&
      candidate.record.eventId === item.record.eventId
    ) === index)
    .sort((left, right) => compareStoredEvents(left.record, right.record));

  return contexts.map((context) => {
    const before = reconstructMemoryStateBefore(context, globalMutations);
    const visibleEvents = context.events.map((record) => ({
      ...record,
      event: eventVisibleToTurn(record.event, context.turn)
    }));
    return telemetryTurnToNormalizedTrace(
      context.turn,
      visibleEvents,
      before.memories,
      {
        principal: context.principal,
        stateStatus: before.status,
        stateReason: before.reason
      }
    );
  });
}

type TurnReconstructionContext = {
  storedTurn: StoredAgentTurn;
  turn: AgentTurnEnvelope;
  events: StoredMemoryTelemetryEvent[];
  principal: MemoryTelemetryPrincipal;
  stateKey: string;
  identityStatus: "resolved" | "conflicting";
  identityReason?: string;
};

type GlobalMutation = {
  context: TurnReconstructionContext;
  record: StoredMemoryTelemetryEvent;
};

type ReconstructionOptions = {
  principal?: MemoryTelemetryPrincipal;
  stateStatus?: "mapped" | "unavailable";
  stateReason?: string;
};

export function telemetryTurnToNormalizedTrace(
  turn: AgentTurnEnvelope,
  storedEvents: readonly StoredMemoryTelemetryEvent[],
  memoriesBeforeTurn: readonly EngramMemory[] = [],
  reconstruction: ReconstructionOptions = {}
): NormalizedTrace {
  const steps: NormalizedTrace["steps"] = [];
  const turnMemoryState = new Map(memoriesBeforeTurn.map((memory) => [memory.id, structuredClone(memory)]));
  if (reconstruction.stateStatus === "unavailable") {
    steps.push({
      id: `${turn.turnId}:memory-state-unavailable`,
      index: steps.length,
      kind: "custom",
      name: "Memory state before turn unavailable",
      status: "unknown",
      startedAt: turn.startedAt,
      endedAt: turn.startedAt,
      memoryMappings: [{
        provenance: "inferred",
        event: null,
        sourcePath: "telemetry reconstruction boundary",
        note: reconstruction.stateReason ?? "The event order was insufficient to reconstruct a trustworthy before-state."
      }]
    });
  } else if (memoriesBeforeTurn.length > 0) {
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
        memoryStateBefore: reconstruction.stateStatus ?? "mapped",
        ...(reconstruction.stateReason ? { memoryStateReason: reconstruction.stateReason } : {}),
        ...(reconstruction.principal ? { principal: toJsonValue(reconstruction.principal) } : {}),
        ...(turn.tenantId ? { tenantId: turn.tenantId } : {}),
        ...(turn.userId ? { userId: turn.userId } : {}),
        ...(turn.namespace ? { namespace: turn.namespace } : {}),
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

function countTurnsByTrace(turns: readonly StoredAgentTurn[]) {
  const counts = new Map<string, number>();
  for (const storedTurn of turns) {
    const key = tracePartitionKey(storedTurn.tenantId, storedTurn.projectId, storedTurn.turn.traceId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function tracePartitionKey(tenantId: string, projectId: string, traceId: string) {
  return JSON.stringify([tenantId, projectId, traceId]);
}

function eventMatchesStoredTurn(
  record: StoredMemoryTelemetryEvent,
  storedTurn: StoredAgentTurn,
  traceTurnCounts: ReadonlyMap<string, number>
) {
  const { event } = record;
  const { turn } = storedTurn;
  if (record.tenantId !== storedTurn.tenantId || record.projectId !== storedTurn.projectId) return false;
  if (event.tenantId && event.tenantId !== storedTurn.tenantId) return false;
  if (event.projectId && event.projectId !== storedTurn.projectId) return false;
  if (event.traceId !== turn.traceId) return false;
  if (event.turnId) return event.turnId === turn.turnId;
  if (turn.telemetryEventIds?.length) return turn.telemetryEventIds.includes(record.eventId);
  const key = tracePartitionKey(storedTurn.tenantId, storedTurn.projectId, turn.traceId);
  return (traceTurnCounts.get(key) ?? 0) === 1;
}

function resolveTurnContext(
  storedTurn: StoredAgentTurn,
  events: StoredMemoryTelemetryEvent[],
  ambiguousAssociation: boolean
): TurnReconstructionContext {
  const { turn } = storedTurn;
  const principal: MemoryTelemetryPrincipal = {
    tenantId: storedTurn.tenantId,
    projectId: storedTurn.projectId,
    ...(turn.userId ? { userId: turn.userId } : {}),
    ...(turn.sessionId ? { sessionId: turn.sessionId } : {}),
    ...(turn.namespace ? { namespace: [...turn.namespace] } : {}),
    ...(turn.owner ? { owner: structuredClone(turn.owner) } : {})
  };
  const conflicts: string[] = [];
  if (turn.tenantId && turn.tenantId !== storedTurn.tenantId) conflicts.push("turn tenant conflicts with ingest tenant");
  if (turn.projectId && turn.projectId !== storedTurn.projectId) conflicts.push("turn project conflicts with ingest project");
  if (principal.owner?.userId && principal.userId && principal.owner.userId !== principal.userId) {
    conflicts.push("turn user conflicts with memory owner user");
  }
  if (principal.owner?.sessionId && principal.sessionId && principal.owner.sessionId !== principal.sessionId) {
    conflicts.push("turn session conflicts with memory owner session");
  }
  if (principal.owner?.namespace && principal.namespace &&
      !sameNamespace(principal.owner.namespace, principal.namespace)) {
    conflicts.push("turn namespace conflicts with memory owner namespace");
  }

  for (const record of events) {
    const { event } = record;
    mergeScalarIdentity(principal, "userId", event.userId, conflicts, "event user");
    mergeScalarIdentity(principal, "sessionId", event.sessionId, conflicts, "event session");
    mergeNamespaceIdentity(principal, event.namespace, conflicts, "event namespace");
    const directOwner = mergeOwnerList([event.owner, event.memory?.owner], conflicts, "event owner");
    if (directOwner) principal.owner = mergeOwner(principal.owner, directOwner, conflicts, "turn/event owner");

    if (!directOwner && !principal.owner?.ownerId && !principal.owner?.userId && !principal.namespace) {
      const candidateOwners = event.retrieval?.candidates?.map((candidate) => candidate.memory?.owner)
        .filter((owner): owner is TelemetryMemoryOwner => Boolean(owner)) ?? [];
      const inferred = mergeOwnerList(candidateOwners, conflicts, "retrieval candidate owner");
      if (inferred) principal.owner = mergeOwner(principal.owner, inferred, conflicts, "turn/candidate owner");
    }
  }

  if (principal.owner?.userId) {
    mergeScalarIdentity(principal, "userId", principal.owner.userId, conflicts, "memory owner user");
  }
  if (principal.owner?.sessionId) {
    mergeScalarIdentity(principal, "sessionId", principal.owner.sessionId, conflicts, "memory owner session");
  }
  if (principal.owner?.namespace) {
    mergeNamespaceIdentity(principal, principal.owner.namespace, conflicts, "memory owner namespace");
  }
  if (principal.userId || principal.namespace) {
    principal.owner = {
      ...(principal.owner ?? {}),
      ...(principal.userId ? { userId: principal.userId } : {}),
      ...(principal.namespace ? { namespace: [...principal.namespace] } : {})
    };
  }
  if (ambiguousAssociation) conflicts.push("legacy events share a trace without turn identifiers");

  const enrichedTurn: AgentTurnEnvelope = {
    ...turn,
    tenantId: storedTurn.tenantId,
    projectId: storedTurn.projectId,
    ...(principal.userId ? { userId: principal.userId } : {}),
    ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
    ...(principal.namespace ? { namespace: principal.namespace } : {}),
    ...(principal.owner ? { owner: principal.owner } : {})
  };
  const identityStatus = conflicts.length > 0 ? "conflicting" : "resolved";
  return {
    storedTurn,
    turn: enrichedTurn,
    events: identityStatus === "resolved" ? events.filter((record) => eventFitsPrincipal(record.event, principal)) : [],
    principal,
    stateKey: identityStatus === "resolved"
      ? stateKeyForPrincipal(principal, turn.traceId)
      : JSON.stringify([storedTurn.tenantId, storedTurn.projectId, "conflict", turn.turnId]),
    identityStatus,
    ...(conflicts.length ? { identityReason: `Principal evidence is conflicting: ${[...new Set(conflicts)].join("; ")}.` } : {})
  };
}

function reconstructMemoryStateBefore(
  target: TurnReconstructionContext,
  mutations: readonly GlobalMutation[]
): { memories: EngramMemory[]; status: "mapped" | "unavailable"; reason?: string } {
  if (target.identityStatus === "conflicting") {
    return { memories: [], status: "unavailable", reason: target.identityReason };
  }
  const state = new Map<string, EngramMemory>();
  const targetStart = Date.parse(target.turn.startedAt);
  for (const mutation of mutations) {
    if (mutation.context.stateKey !== target.stateKey) continue;
    if (mutation.context.turn.turnId === target.turn.turnId) continue;
    const occurredAt = Date.parse(mutation.record.occurredAt);
    if (!Number.isFinite(occurredAt) || occurredAt > targetStart) continue;
    if (occurredAt !== Date.parse(mutation.record.event.timestamp)) {
      return unavailable("Stored occurrence time conflicts with the telemetry payload timestamp.");
    }
    const sourceStart = Date.parse(mutation.context.turn.startedAt);
    const sourceEnd = Date.parse(mutation.context.turn.completedAt);
    if (sourceStart > occurredAt) {
      return unavailable("A mutation timestamp precedes its source turn, so ordering cannot be trusted.");
    }
    if (occurredAt < targetStart) {
      if (sourceStart < targetStart && sourceEnd > targetStart) {
        return unavailable("A prior memory mutation came from a turn that overlapped this turn boundary.");
      }
      applyMemoryMutation(state, mutation.record.event);
      continue;
    }
    const isOrderedBefore = sourceEnd <= targetStart &&
      mutation.context.storedTurn.cursor < target.storedTurn.cursor;
    if (!isOrderedBefore) {
      return unavailable("A memory mutation shares this turn boundary without a stable completed-turn order.");
    }
    applyMemoryMutation(state, mutation.record.event);
  }
  return { memories: [...state.values()].map((memory) => structuredClone(memory)), status: "mapped" };
}

function unavailable(reason: string) {
  return { memories: [] as EngramMemory[], status: "unavailable" as const, reason };
}

function isMutation(event: MemoryTelemetryEvent) {
  return ["store", "update", "supersede", "delete", "summarize", "expire"].includes(event.operation);
}

function compareStoredEvents(left: StoredMemoryTelemetryEvent, right: StoredMemoryTelemetryEvent) {
  return left.occurredAt.localeCompare(right.occurredAt) ||
    left.cursor - right.cursor ||
    (left.sequence ?? left.event.sequence) - (right.sequence ?? right.event.sequence) ||
    left.eventId.localeCompare(right.eventId);
}

function eventVisibleToTurn(event: MemoryTelemetryEvent, turn: AgentTurnEnvelope): MemoryTelemetryEvent {
  if (event.operation !== "retrieve" || !event.retrieval?.candidates) return event;
  const owner = turnIdentity(turn);
  const candidates = event.retrieval.candidates.filter((candidate) =>
    !candidate.memory?.owner || !owner || ownersVisibleToPrincipal(owner, candidate.memory.owner)
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

function turnIdentity(turn: AgentTurnEnvelope): TelemetryMemoryOwner | undefined {
  if (turn.owner || turn.userId || turn.sessionId || turn.namespace) {
    return {
      ...(turn.owner ?? {}),
      ...(turn.userId ? { userId: turn.userId } : {}),
      ...(turn.sessionId ? { sessionId: turn.sessionId } : {}),
      ...(turn.namespace ? { namespace: turn.namespace } : {})
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
  for (const key of scalarKeys) {
    if (!left[key] || !right[key]) continue;
    if (left[key] !== right[key]) return true;
  }
  if (left.namespace && right.namespace) {
    if (ownerKey({ namespace: left.namespace }) !== ownerKey({ namespace: right.namespace })) return true;
  }
  return false;
}

function ownersVisibleToPrincipal(left: TelemetryMemoryOwner, right: TelemetryMemoryOwner) {
  if (ownersConflict(left, right)) return false;
  const scalarKeys = ["ownerId", "userId", "sessionId", "agentId"] as const;
  if (scalarKeys.some((key) => left[key] && right[key] && left[key] === right[key])) return true;
  return Boolean(left.namespace && right.namespace && sameNamespace(left.namespace, right.namespace));
}

function mergeOwner(
  left: TelemetryMemoryOwner | undefined,
  right: TelemetryMemoryOwner,
  conflicts: string[],
  label: string
): TelemetryMemoryOwner {
  if (!left) return structuredClone(right);
  if (ownersConflict(left, right)) {
    conflicts.push(`${label} conflicts`);
    return left;
  }
  return {
    ...left,
    ...right,
    ...(left.namespace || right.namespace ? { namespace: right.namespace ?? left.namespace } : {})
  };
}

function mergeOwnerList(
  owners: readonly (TelemetryMemoryOwner | undefined)[],
  conflicts: string[],
  label: string
) {
  let merged: TelemetryMemoryOwner | undefined;
  for (const owner of owners) {
    if (!owner) continue;
    merged = mergeOwner(merged, owner, conflicts, label);
  }
  return merged;
}

function mergeScalarIdentity(
  principal: MemoryTelemetryPrincipal,
  key: "userId" | "sessionId",
  value: string | undefined,
  conflicts: string[],
  label: string
) {
  if (!value) return;
  if (principal[key] && principal[key] !== value) conflicts.push(`${label} conflicts with ${key}`);
  else principal[key] = value;
}

function mergeNamespaceIdentity(
  principal: MemoryTelemetryPrincipal,
  value: readonly string[] | undefined,
  conflicts: string[],
  label: string
) {
  if (!value) return;
  if (principal.namespace && !sameNamespace(principal.namespace, value)) conflicts.push(`${label} conflicts`);
  else principal.namespace = [...value];
}

function sameNamespace(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function eventFitsPrincipal(event: MemoryTelemetryEvent, principal: MemoryTelemetryPrincipal) {
  if (event.tenantId && event.tenantId !== principal.tenantId) return false;
  if (event.projectId && event.projectId !== principal.projectId) return false;
  if (event.userId && principal.userId && event.userId !== principal.userId) return false;
  if (event.sessionId && principal.sessionId && event.sessionId !== principal.sessionId) return false;
  if (event.namespace && principal.namespace && !sameNamespace(event.namespace, principal.namespace)) return false;
  if (event.owner && principal.owner && ownersConflict(event.owner, principal.owner)) return false;
  if (event.memory?.owner && principal.owner && ownersConflict(event.memory.owner, principal.owner)) return false;
  return true;
}

function stateKeyForPrincipal(principal: MemoryTelemetryPrincipal, traceId: string) {
  const owner = principal.owner;
  const stableIdentity = {
    ownerId: owner?.ownerId ?? null,
    namespace: principal.namespace ?? owner?.namespace ?? null,
    userId: principal.userId ?? owner?.userId ?? null,
    agentId: owner?.agentId ?? null
  };
  const hasStableIdentity = Object.values(stableIdentity).some((value) => value !== null);
  const identity: unknown = hasStableIdentity
    ? ["principal", stableIdentity]
    : owner?.sessionId || principal.sessionId
      ? ["session", owner?.sessionId ?? principal.sessionId]
      : ["trace", traceId];
  return JSON.stringify([principal.tenantId, principal.projectId, identity]);
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
