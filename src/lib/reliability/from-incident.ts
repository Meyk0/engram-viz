import type {
  MemoryDecisionEvidenceLevel,
  MemoryDecisionMemory,
  MemoryDecisionRunV3
} from "@engramviz/core";
import type { MemoryIncident } from "@/lib/incidents/types";
import type { EngramMemory } from "@/types";

export function memoryDecisionRunFromIncident(incident: MemoryIncident): MemoryDecisionRunV3 {
  const retrievedIds = new Set(incident.record.retrievedMemories.map((memory) => memory.id));
  const loadedIds = new Set(incident.checkpoint.loadedMemoryIds);
  const matches = incident.record.retrieval?.matches ?? incident.checkpoint.retrieval?.matches ?? [];
  const coverage = evidenceCoverage(incident);
  const decisionMemories = incident.memories.map(toDecisionMemory);
  const decisionMemoryById = new Map(decisionMemories.map((memory) => [memory.id, memory]));

  return {
    format: "engram.memory-decision-run",
    version: 3,
    id: `${incident.id}-baseline`,
    traceId: incident.record.id,
    turnId: incident.record.id,
    sessionId: incident.record.sessionId,
    startedAt: incident.record.startedAt,
    completedAt: incident.record.completedAt,
    input: incident.question,
    memoryState: {
      before: structuredClone(decisionMemories),
      after: structuredClone(decisionMemories)
    },
    retrieval: {
      query: incident.record.retrieval?.reason ? incident.question : incident.record.userMessage,
      ...(incident.record.retrieval?.limit ? { limit: incident.record.retrieval.limit } : {}),
      candidates: matches.map((match) => ({
        memoryId: match.id,
        ...(decisionMemoryById.get(match.id) ? { memory: structuredClone(decisionMemoryById.get(match.id)) } : {}),
        rank: match.rank,
        score: match.score,
        ...(match.components ? { scoreComponents: compactNumbers(match.components) } : {}),
        eligible: match.eligible !== false,
        selected: match.selected || retrievedIds.has(match.id),
        loaded: loadedIds.has(match.id),
        ...(match.filterReason ? { filterReason: match.filterReason } : {}),
        evidence: coverage.retrieval
      })),
      selectedIds: [...retrievedIds],
      policy: {
        id: `${incident.record.retrieval?.provider ?? "unknown"}-recorded-policy`,
        configuration: {
          limit: incident.record.retrieval?.limit ?? retrievedIds.size,
          candidateSource: "recorded"
        },
        evidence: coverage.retrieval
      }
    },
    context: {
      loadedIds: [...loadedIds],
      orderedIds: [...loadedIds],
      truncatedIds: [],
      forcedIds: [],
      evidence: coverage.active_context
    },
    answer: {
      content: incident.observedAnswer,
      provider: incident.record.provider,
      evidence: coverage.answer
    },
    evidenceCoverage: coverage,
    metadata: {
      incidentId: incident.id,
      diagnosis: incident.diagnosis.kind
    }
  };
}

function toDecisionMemory(memory: EngramMemory): MemoryDecisionMemory {
  const value = memory.entities?.length === 1 ? memory.entities[0] : memory.text;
  return {
    id: memory.id,
    content: memory.text,
    ...(memory.topic || memory.kind ? { subject: normalizeSubject(memory.topic ?? memory.kind ?? "") } : {}),
    value,
    status: memory.status ?? "active",
    tier: memory.region === "temporal" ? "semantic" : memory.region === "prefrontal" ? "working" : "episodic",
    scope: "user",
    ...(memory.provider ? { provider: memory.provider } : {}),
    ...(memory.storeId ? { storeId: memory.storeId } : {}),
    createdAt: memory.created_at,
    ...(memory.supersedes?.length ? { supersedes: [...memory.supersedes] } : {}),
    metadata: {
      importance: memory.importance,
      accessCount: memory.access_count,
      ...(memory.confidence !== undefined ? { confidence: memory.confidence } : {})
    },
    evidence: "observed"
  };
}

function evidenceCoverage(incident: MemoryIncident): MemoryDecisionRunV3["evidenceCoverage"] {
  const level = (stage: MemoryIncident["evidence"][number]["stage"]): MemoryDecisionEvidenceLevel => {
    const evidence = incident.evidence.find((item) => item.stage === stage);
    if (!evidence) return "unavailable";
    return evidence.origin === "inferred" ? "derived" : evidence.origin;
  };

  return {
    memory_state: level("memory_state"),
    retrieval: level("retrieval"),
    selection: level("retrieval"),
    active_context: level("active_context"),
    answer: level("answer")
  };
}

function compactNumbers(value: Record<string, number | undefined>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => entry[1] !== undefined)
  );
}

function normalizeSubject(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
