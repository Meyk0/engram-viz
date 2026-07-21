import { InMemoryStore } from "@langchain/langgraph";
import { defineLangGraphExecutor } from "@engramviz/adapter-langgraph";
import { createSupportGraph, seedSupportStore, supportMemories } from "./workflow.mjs";

const offline = process.env.ENGRAM_EXAMPLE_OFFLINE === "true" || !process.env.OPENAI_API_KEY;

export default defineLangGraphExecutor({
  id: "support-replacement-agent",
  name: "Support replacement agent",
  version: offline ? "offline-deterministic" : String(process.env.OPENAI_MODEL ?? "openai"),
  langGraphVersion: "1.4.x",
  deterministic: offline,
  supportedSideEffectModes: ["blocked"],
  async createRuntime({ source, variant, sideEffectMode }) {
    const store = new InMemoryStore();
    const scores = new Map(source.retrieval.candidates.map((candidate) => [candidate.memoryId, candidate.score ?? 0]));
    const sourceMemories = source.memoryState.before.map((memory, index) => ({
      key: supportMemories.find((item) => item.engramId === memory.id)?.key ?? `memory-${index}`,
      engramId: memory.id,
      data: typeof memory.content === "string" ? memory.content : JSON.stringify(memory.content),
      subject: memory.subject ?? "unknown",
      value: typeof memory.value === "string" ? memory.value : JSON.stringify(memory.value ?? null),
      status: memory.status,
      score: scores.get(memory.id) ?? 0
    }));
    await seedSupportStore(store, sourceMemories);
    return {
      graph: createSupportGraph({ store }),
      config: { configurable: { thread_id: `support-replay-${variant}-${crypto.randomUUID()}` } },
      isolation: { checkpoint: "isolated", memoryStore: "isolated", sideEffects: sideEffectMode }
    };
  },
  applyIntervention({ checkpoint, intervention }) {
    const forcedMemoryId = intervention.operations.find((operation) =>
      operation.type === "context_override" && operation.action === "include"
    )?.memoryId ?? "";
    const excludeSuperseded = intervention.operations.some((operation) =>
      operation.type === "policy_rule" && operation.rule === "exclude_superseded" && operation.enabled
    ) || intervention.operations.some((operation) =>
      operation.type === "memory_status" && operation.status === "superseded"
    );
    return { ...checkpoint.values, forcedMemoryId, excludeSuperseded };
  },
  observe({ finalState, source, variant }) {
    const state = finalState.values;
    const selectedIds = state.selectedIds ?? [];
    const loadedIds = state.loadedIds ?? [];
    const candidateById = new Map(source.retrieval.candidates.map((candidate) => [candidate.memoryId, candidate]));
    const memoryById = new Map(source.memoryState.before.map((memory) => [memory.id, memory]));
    return {
      ...structuredClone(source),
      id: `${source.id}-${variant}`,
      completedAt: new Date(Date.parse(source.completedAt) + (variant === "baseline" ? 1 : 2)).toISOString(),
      retrieval: {
        ...structuredClone(source.retrieval),
        candidates: (state.candidates ?? []).map((candidate, index) => ({
          memoryId: candidate.id,
          memory: memoryById.get(candidate.id),
          rank: candidateById.get(candidate.id)?.rank ?? index + 1,
          score: candidateById.get(candidate.id)?.score ?? candidate.score,
          eligible: true,
          selected: selectedIds.includes(candidate.id),
          loaded: loadedIds.includes(candidate.id),
          evidence: "observed"
        })),
        selectedIds,
        policy: structuredClone(source.retrieval.policy)
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
        provider: { id: "support-replacement-agent", model: offline ? "offline-deterministic" : String(process.env.OPENAI_MODEL) },
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
