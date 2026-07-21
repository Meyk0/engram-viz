import {
  langGraphMemoryId,
  langGraphReplayMetadata
} from "@engramviz/adapter-langgraph";
import { parseMemoryDecisionRunV3 } from "@engramviz/core";
import executor from "./engram.executor.mjs";
import { memories, namespace } from "./workflow.mjs";

const decisionMemories = memories.map((memory) => ({
  id: langGraphMemoryId(namespace, memory.key),
  content: memory.data,
  subject: memory.subject,
  value: memory.data.includes("Oakland") ? "Oakland" : "San Francisco",
  status: memory.status,
  tier: "semantic",
  scope: "user",
  evidence: "observed"
}));
const stale = decisionMemories[0];
const current = decisionMemories[1];
const source = parseMemoryDecisionRunV3({
  format: "engram.memory-decision-run",
  version: 3,
  id: "langgraph-example-run",
  traceId: "langgraph-example-trace",
  turnId: "langgraph-example-turn",
  sessionId: "langgraph-example-session",
  startedAt: "2026-07-21T10:00:00.000Z",
  completedAt: "2026-07-21T10:00:00.500Z",
  input: "What city do I live in now?",
  memoryState: { before: decisionMemories, after: decisionMemories },
  retrieval: {
    query: "What city do I live in now?",
    limit: 1,
    candidates: [
      { memoryId: stale.id, memory: stale, rank: 1, score: 0.97, eligible: true, selected: true, loaded: true, evidence: "observed" },
      { memoryId: current.id, memory: current, rank: 2, score: 0.91, eligible: true, selected: false, loaded: false, evidence: "observed" }
    ],
    selectedIds: [stale.id],
    policy: { id: "location-policy", configuration: { excludeSuperseded: false }, evidence: "observed" }
  },
  context: { loadedIds: [stale.id], orderedIds: [stale.id], truncatedIds: [], forcedIds: [], evidence: "observed" },
  answer: { content: stale.content, provider: { id: "langgraph-location-agent", model: "1.0.0" }, evidence: "observed" },
  evidenceCoverage: {
    memory_state: "observed",
    retrieval: "observed",
    selection: "observed",
    active_context: "observed",
    answer: "observed"
  },
  metadata: langGraphReplayMetadata({
    values: {
      question: "What city do I live in now?",
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

const result = await executor.replay({
  baseline: source,
  intervention: {
    format: "engram.memory-intervention",
    version: 2,
    id: "prefer-current-city",
    targetRunId: source.id,
    label: "Prefer current city",
    rationale: "Supersede the stale city.",
    createdAt: "2026-07-21T10:01:00.000Z",
    operations: [{
      id: "include-oakland",
      type: "context_override",
      action: "include",
      memoryId: current.id,
      reason: "The current city should reach the answer context."
    }]
  },
  answerAssertion: { type: "contains_all", values: ["Oakland"], forbidden: ["San Francisco"] }
});

if (!result.reproduction.reproduced) throw new Error("LangGraph example did not reproduce its baseline.");
if (result.diff.earliestDivergence !== "selection") throw new Error("LangGraph example diverged at the wrong stage.");
if (!result.verification.passed) throw new Error(result.verification.failures.join(" "));
console.log("PASS LangGraph checkpoint replay: San Francisco -> Oakland at selection.");
