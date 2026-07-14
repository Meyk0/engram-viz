import type { BrainRegion, EngramEvent, EngramMemory } from "@/types";
import type {
  MemoryScope,
  MemoryTelemetryContext,
  MemoryTelemetryEvent,
  MemoryTier,
  TelemetryMemoryRef
} from "@/lib/telemetry/types";

export function brainRegionToMemoryTier(region: BrainRegion): MemoryTier {
  if (region === "prefrontal") return "working";
  if (region === "hippocampus") return "episodic";
  return "semantic";
}

export function memoryTierToBrainRegion(tier: MemoryTier): BrainRegion | undefined {
  if (tier === "working") return "prefrontal";
  if (tier === "episodic") return "hippocampus";
  if (tier === "semantic") return "temporal";
  return undefined;
}

export function engramEventToTelemetry(
  event: EngramEvent,
  context: MemoryTelemetryContext
): MemoryTelemetryEvent[] {
  const base = telemetryBase(context);
  const memoryRef = (memory: EngramMemory, scope = context.scope ?? "unknown"): TelemetryMemoryRef => ({
    id: memory.id,
    content: memory.text,
    tier: brainRegionToMemoryTier(memory.region),
    scope,
    ...(context.provider ? { provider: context.provider } : {}),
    ...(context.storeId ? { storeId: context.storeId } : {}),
    metadata: memoryMetadata(memory)
  });

  if (event.type === "store") {
    return [{ ...base, operation: event.memory.supersedes?.length ? "update" : "store", memory: memoryRef(event.memory) }];
  }

  if (event.type === "retrieve") {
    return [{
      ...base,
      operation: "retrieve",
      memoryIds: event.ids,
      retrieval: {
        query: event.query,
        ...(event.retrieval?.limit ? { limit: event.retrieval.limit } : {}),
        selectedIds: event.ids,
        candidates: event.retrieval?.matches?.map((match) => ({
          memoryId: match.id,
          rank: match.rank,
          score: match.score,
          ...(match.eligible !== undefined ? { eligible: match.eligible } : {}),
          selected: match.selected,
          ...(match.filterReason ? { filterReason: match.filterReason } : {})
        }))
      }
    }];
  }

  if (event.type === "load") {
    return [{ ...base, operation: "load", memoryIds: event.ids, retrieval: { loadedIds: event.ids } }];
  }

  if (event.type === "consolidate") {
    return [{
      ...base,
      operation: "summarize",
      memory: memoryRef(event.added),
      mutation: {
        sourceMemoryIds: event.removed,
        targetMemoryIds: [event.added.id],
        reason: event.decision?.reason ?? "Memory consolidation"
      }
    }];
  }

  if (event.type === "decay") {
    return [{ ...base, operation: "expire", memoryIds: event.ids }];
  }

  return [];
}

export function telemetryEventToEngramEvent(event: MemoryTelemetryEvent): EngramEvent | null {
  if (event.operation === "store" || event.operation === "update") {
    if (!event.memory) return null;
    const memory = telemetryMemoryToEngram(event.memory, event.timestamp);
    if (!memory) return null;
    return {
      type: "store",
      memory: event.operation === "update" && event.mutation?.sourceMemoryIds?.length
        ? { ...memory, supersedes: event.mutation.sourceMemoryIds }
        : memory
    };
  }

  if (event.operation === "retrieve") {
    return {
      type: "retrieve",
      query: event.retrieval?.query ?? "",
      ids: event.retrieval?.selectedIds ?? event.memoryIds ?? [],
      retrieval: {
        provider: "fallback",
        ...(event.retrieval?.limit ? { limit: event.retrieval.limit } : {}),
        ...(event.retrieval?.candidates ? {
          matches: event.retrieval.candidates.map((candidate, index) => ({
            id: candidate.memoryId,
            rank: candidate.rank ?? index + 1,
            score: candidate.score ?? 0,
            basis: "guardrail",
            ...(candidate.eligible !== undefined ? { eligible: candidate.eligible } : {}),
            selected: candidate.selected ?? (event.retrieval?.selectedIds ?? []).includes(candidate.memoryId),
            ...(candidate.filterReason ? { filterReason: candidate.filterReason } : {})
          }))
        } : {})
      }
    };
  }

  if (event.operation === "load") return { type: "load", ids: event.retrieval?.loadedIds ?? event.memoryIds ?? [] };

  if (event.operation === "summarize") {
    if (!event.memory) return null;
    const added = telemetryMemoryToEngram(event.memory, event.timestamp);
    if (!added) return null;
    return {
      type: "consolidate",
      removed: event.mutation?.sourceMemoryIds ?? [],
      added
    };
  }

  if (event.operation === "expire" || event.operation === "delete") {
    return { type: "decay", ids: event.memoryIds ?? [] };
  }

  return null;
}

function telemetryBase(context: MemoryTelemetryContext): Omit<MemoryTelemetryEvent, "operation"> {
  return {
    schemaVersion: 2,
    eventId: context.eventId ?? `${context.traceId}:memory:${context.sequence}`,
    traceId: context.traceId,
    timestamp: context.timestamp,
    sequence: context.sequence,
    ...(context.spanId ? { spanId: context.spanId } : {}),
    ...(context.parentSpanId ? { parentSpanId: context.parentSpanId } : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.userId ? { userId: context.userId } : {}),
    ...(context.actor ? { actor: context.actor } : {}),
    evidence: {
      level: context.evidence?.level ?? "mapped",
      adapter: context.evidence?.adapter ?? "engram-v1-compat",
      ...(context.evidence?.sourcePath ? { sourcePath: context.evidence.sourcePath } : {}),
      ...(context.evidence?.note ? { note: context.evidence.note } : {})
    }
  };
}

function telemetryMemoryToEngram(memory: TelemetryMemoryRef, timestamp: string): EngramMemory | null {
  const region = memoryTierToBrainRegion(memory.tier);
  if (!region) return null;
  const metadata = memory.metadata ?? {};
  const confidence = optionalNumberMetadata(metadata.confidence);

  return {
    id: memory.id,
    text: typeof memory.content === "string" ? memory.content : JSON.stringify(memory.content ?? "Imported memory"),
    importance: numberMetadata(metadata.importance, 0.5),
    region,
    created_at: stringMetadata(metadata.createdAt, timestamp),
    access_count: Math.max(0, Math.trunc(numberMetadata(metadata.accessCount, 0))),
    ...(stringMetadata(metadata.topic) ? { topic: stringMetadata(metadata.topic) } : {}),
    ...(stringMetadata(metadata.kind) ? { kind: stringMetadata(metadata.kind) } : {}),
    ...(confidence !== undefined ? { confidence } : {})
  };
}

function memoryMetadata(memory: EngramMemory) {
  return {
    importance: memory.importance,
    createdAt: memory.created_at,
    accessCount: memory.access_count,
    ...(memory.topic ? { topic: memory.topic } : {}),
    ...(memory.kind ? { kind: memory.kind } : {}),
    ...(memory.confidence !== undefined ? { confidence: memory.confidence } : {})
  };
}

function numberMetadata(value: unknown, fallback?: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : (fallback ?? 0);
}

function optionalNumberMetadata(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringMetadata(value: unknown, fallback?: string): string {
  return typeof value === "string" ? value : (fallback ?? "");
}

export function normalizeMemoryScope(scope?: string): MemoryScope {
  if (scope === "user" || scope === "agent" || scope === "run" || scope === "shared") return scope;
  return "unknown";
}
