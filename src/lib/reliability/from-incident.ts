import type {
  MemoryDecisionEvidenceLevel,
  MemoryDecisionMemory,
  MemoryDecisionRunV3
} from "@engramviz/core";
import { parseMemoryDecisionRunV3 } from "@engramviz/core";
import type { MemoryIncident } from "@/lib/incidents/types";
import type { EngramEvent, EngramMemory } from "@/types";

export function memoryDecisionRunFromIncident(incident: MemoryIncident): MemoryDecisionRunV3 {
  const retrievedIds = unique(incident.record.retrievedMemories.map((memory) => memory.id));
  const retrievedIdSet = new Set(retrievedIds);
  const loadedIds = unique(incident.checkpoint.loadedMemoryIds);
  const loadedIdSet = new Set(loadedIds);
  const matches = incident.record.retrieval?.matches ?? incident.checkpoint.retrieval?.matches ?? [];
  const reportedCoverage = evidenceCoverage(incident);
  const state = reconstructMemoryState(incident.record.events, reportedCoverage.memory_state);
  const coverage: MemoryDecisionRunV3["evidenceCoverage"] = {
    ...reportedCoverage,
    memory_state: state.evidence,
    active_context: reportedCoverage.active_context === "unavailable" ? "unavailable" : "mapped"
  };
  const decisionMemoryById = candidateMemoryMap(incident, state);
  const candidateInputs: Array<{
    id: string;
    rank?: number;
    score?: number;
    components?: Record<string, number | undefined>;
    eligible?: boolean;
    filterReason?: string;
    evidence: MemoryDecisionEvidenceLevel;
  }> = matches.map((match) => ({ ...match, evidence: coverage.retrieval }));
  for (const memory of incident.record.retrievedMemories) {
    if (candidateInputs.some((candidate) => candidate.id === memory.id)) continue;
    candidateInputs.push({
      id: memory.id,
      eligible: true,
      evidence: "mapped"
    });
  }
  const candidateIds = new Set(candidateInputs.map((candidate) => candidate.id));
  const selectedIds = coverage.selection === "unavailable"
    ? []
    : retrievedIds.filter((id) => candidateIds.has(id));
  const selectedIdSet = new Set(selectedIds);
  const contextLoadedIds = coverage.active_context === "unavailable" ? [] : loadedIds;
  const forcedIds = contextLoadedIds.filter((id) => !selectedIdSet.has(id));
  const truncatedIds = coverage.active_context === "unavailable"
    ? []
    : selectedIds.filter((id) => !loadedIdSet.has(id));

  return parseMemoryDecisionRunV3({
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
      before: state.before,
      after: state.after
    },
    retrieval: {
      query: incident.record.retrieval?.reason ? incident.question : incident.record.userMessage,
      ...(incident.record.retrieval?.limit ? { limit: incident.record.retrieval.limit } : {}),
      candidates: coverage.retrieval === "unavailable" ? [] : candidateInputs.map((match) => ({
        memoryId: match.id,
        ...(decisionMemoryById.get(match.id) ? { memory: structuredClone(decisionMemoryById.get(match.id)) } : {}),
        ...(match.rank !== undefined ? { rank: match.rank } : {}),
        ...(match.score !== undefined ? { score: match.score } : {}),
        ...(match.components ? { scoreComponents: compactNumbers(match.components) } : {}),
        eligible: match.eligible !== false,
        selected: selectedIdSet.has(match.id),
        loaded: contextLoadedIds.includes(match.id),
        ...(match.filterReason ? { filterReason: match.filterReason } : {}),
        evidence: match.evidence
      })),
      selectedIds,
      policy: {
        id: `${incident.record.retrieval?.provider ?? "unknown"}-recorded-policy`,
        configuration: {
          limit: incident.record.retrieval?.limit ?? selectedIds.length,
          candidateSource: "recorded"
        },
        evidence: coverage.retrieval === "unavailable" ? "unavailable" : "mapped"
      }
    },
    context: {
      loadedIds: contextLoadedIds,
      orderedIds: [...contextLoadedIds],
      truncatedIds,
      forcedIds,
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
  });
}

function toDecisionMemory(
  memory: EngramMemory,
  evidence: MemoryDecisionEvidenceLevel
): MemoryDecisionMemory {
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
    evidence
  };
}

function reconstructMemoryState(
  events: readonly EngramEvent[],
  reportedEvidence: MemoryDecisionEvidenceLevel
): {
  before: MemoryDecisionMemory[];
  after: MemoryDecisionMemory[];
  evidence: MemoryDecisionEvidenceLevel;
} {
  const initIndex = events.findIndex((event) => event.type === "init");
  const init = initIndex >= 0 ? events[initIndex] : undefined;
  if (!init || init.type !== "init" || reportedEvidence === "unavailable") {
    return { before: [], after: [], evidence: "unavailable" };
  }

  const initial = init.memories.map((memory) => toDecisionMemory(memory, reportedEvidence));
  const materialized = new Map(initial.map((memory) => [memory.id, structuredClone(memory)]));
  for (const event of events.slice(initIndex + 1)) {
    if (event.type === "store") {
      materialized.set(event.memory.id, toDecisionMemory(event.memory, "mapped"));
    } else if (event.type === "consolidate") {
      for (const id of event.removed) materialized.delete(id);
      materialized.set(event.added.id, toDecisionMemory(event.added, "mapped"));
    } else if (event.type === "dream_apply") {
      return { before: [], after: [], evidence: "unavailable" };
    }
  }

  return {
    before: structuredClone(initial),
    after: [...materialized.values()],
    evidence: reportedEvidence === "observed" ? "mapped" : reportedEvidence
  };
}

function candidateMemoryMap(
  incident: MemoryIncident,
  state: { before: MemoryDecisionMemory[]; after: MemoryDecisionMemory[] }
) {
  const memories = new Map<string, MemoryDecisionMemory>();
  for (const memory of [...state.before, ...state.after]) memories.set(memory.id, structuredClone(memory));
  for (const memory of incident.memories) memories.set(memory.id, toDecisionMemory(memory, "mapped"));
  for (const memory of incident.record.retrievedMemories) {
    memories.set(memory.id, toDecisionMemory(memory, evidenceCoverage(incident).retrieval));
  }
  return memories;
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
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}
