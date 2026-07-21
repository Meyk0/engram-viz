import { InMemoryStore } from "@langchain/langgraph";
import {
  defineLangGraphExecutor
} from "@engramviz/adapter-langgraph";
import { createLocationGraph, seedLocationStore } from "./workflow.mjs";

export default defineLangGraphExecutor({
  id: "langgraph-location-agent",
  name: "LangGraph location agent",
  version: "1.0.0",
  langGraphVersion: "1.4.x",
  deterministic: true,
  supportedSideEffectModes: ["blocked"],
  async createRuntime({ variant, sideEffectMode }) {
    const store = new InMemoryStore();
    await seedLocationStore(store);
    return {
      graph: createLocationGraph({ store }),
      config: { configurable: { thread_id: `engram-${variant}-${crypto.randomUUID()}` } },
      isolation: {
        checkpoint: "isolated",
        memoryStore: "isolated",
        sideEffects: sideEffectMode
      }
    };
  },
  applyIntervention({ checkpoint, intervention }) {
    const forcedMemoryId = intervention.operations.find((operation) =>
      operation.type === "context_override" && operation.action === "include"
    )?.memoryId ?? "";
    const excludeSuperseded = intervention.operations.some((operation) =>
      operation.type === "memory_status"
      && operation.status === "superseded"
    ) || intervention.operations.some((operation) =>
      operation.type === "policy_rule"
      && operation.rule === "exclude_superseded"
      && operation.enabled
    );
    return { ...checkpoint.values, excludeSuperseded, forcedMemoryId };
  },
  observe({ finalState, source, variant }) {
    const state = finalState.values;
    const selectedIds = state.selectedIds ?? [];
    const loadedIds = state.loadedIds ?? [];
    const memoryById = new Map(source.memoryState.before.map((memory) => [memory.id, memory]));
    const recordedCandidateById = new Map(
      source.retrieval.candidates.map((candidate) => [candidate.memoryId, candidate])
    );
    const policy = variant === "treatment" && state.excludeSuperseded
      ? {
          ...structuredClone(source.retrieval.policy),
          configuration: {
            ...(source.retrieval.policy.configuration ?? {}),
            excludeSuperseded: true
          },
          evidence: "observed"
        }
      : structuredClone(source.retrieval.policy);
    return {
      ...structuredClone(source),
      id: `${source.id}-${variant}`,
      completedAt: new Date(Date.parse(source.completedAt) + (variant === "baseline" ? 1 : 2)).toISOString(),
      retrieval: {
        ...structuredClone(source.retrieval),
        candidates: (state.candidates ?? []).map((candidate, index) => {
          const recorded = recordedCandidateById.get(candidate.id);
          return {
            memoryId: candidate.id,
            ...(memoryById.get(candidate.id) ? { memory: memoryById.get(candidate.id) } : {}),
            rank: recorded?.rank ?? index + 1,
            ...(recorded?.score !== undefined ? { score: recorded.score } : {}),
            eligible: recorded?.eligible ?? true,
            selected: selectedIds.includes(candidate.id),
            loaded: loadedIds.includes(candidate.id),
            evidence: "observed"
          };
        }),
        selectedIds,
        policy
      },
      context: {
        loadedIds,
        orderedIds: loadedIds,
        truncatedIds: [],
        forcedIds: [],
        evidence: "observed"
      },
      answer: {
        content: String(state.answer ?? ""),
        provider: { id: "langgraph-location-agent", model: "1.0.0" },
        evidence: "observed"
      },
      evidenceCoverage: {
        memory_state: source.evidenceCoverage.memory_state,
        retrieval: "observed",
        selection: "observed",
        active_context: "observed",
        answer: "observed"
      }
    };
  }
});
