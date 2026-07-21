import { langGraphReplayMetadata } from "@engramviz/adapter-langgraph";
import { parseMemoryDecisionRunV3 } from "@engramviz/core";
import { supportMemories } from "./workflow.mjs";

export function supportSourceRun() {
  const memories = supportMemories.map((memory) => ({
    id: memory.engramId,
    content: memory.data,
    subject: memory.subject,
    value: memory.value,
    status: memory.status,
    tier: "semantic",
    scope: "user",
    evidence: "observed"
  }));
  const stale = memories[0];
  const current = memories[1];
  return parseMemoryDecisionRunV3({
    format: "engram.memory-decision-run",
    version: 3,
    id: "support-replacement-run",
    traceId: "support-replacement-trace",
    turnId: "support-replacement-turn",
    sessionId: "support-replacement-session",
    startedAt: "2026-07-21T12:00:00.000Z",
    completedAt: "2026-07-21T12:00:00.500Z",
    input: "Where should I send the customer's replacement order?",
    memoryState: { before: memories, after: memories },
    retrieval: {
      query: "Where should I send the customer's replacement order?",
      limit: 1,
      candidates: [
        { memoryId: stale.id, memory: stale, rank: 1, score: 0.97, eligible: true, selected: true, loaded: true, evidence: "observed" },
        { memoryId: current.id, memory: current, rank: 2, score: 0.91, eligible: true, selected: false, loaded: false, evidence: "observed" }
      ],
      selectedIds: [stale.id],
      policy: { id: "support-shipping-policy", configuration: { excludeSuperseded: false }, evidence: "observed" }
    },
    context: { loadedIds: [stale.id], orderedIds: [stale.id], truncatedIds: [], forcedIds: [], evidence: "observed" },
    answer: {
      content: "Send the replacement to the address in San Francisco.",
      provider: { id: "support-replacement-agent", model: "offline-deterministic" },
      evidence: "observed"
    },
    evidenceCoverage: {
      memory_state: "observed",
      retrieval: "observed",
      selection: "observed",
      active_context: "observed",
      answer: "observed"
    },
    metadata: langGraphReplayMetadata({
      values: {
        question: "Where should I send the customer's replacement order?",
        excludeSuperseded: false,
        forcedMemoryId: "",
        candidates: [],
        selectedIds: [],
        loadedIds: [],
        answer: ""
      },
      asNode: "entry"
    })
  });
}
