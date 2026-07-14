import { DemoChatProvider } from "@/lib/chat/providers/demo";
import { inspectLexicalMemories } from "@/lib/memory/retrieve";
import type {
  MemoryRegressionExecutionFixture,
  MemoryRegressionExecutionObservation,
  MemoryRegressionExecutor
} from "@/lib/regressions/run";
import type { EngramMemory } from "@/types";

export type EngramLexicalRegressionExecutorOptions = {
  limit?: number;
};

/**
 * A deterministic repository-level harness. It validates Engram's lexical
 * retrieval behavior; it is not a replay of a production vector store or LLM.
 */
export function createEngramLexicalRegressionExecutor(
  options: EngramLexicalRegressionExecutorOptions = {}
): MemoryRegressionExecutor {
  const limit = options.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Regression retrieval limit must be between 1 and 100.");
  }

  return async (fixture) => executeFixture(fixture, limit);
}

async function executeFixture(
  fixture: MemoryRegressionExecutionFixture,
  limit: number
): Promise<MemoryRegressionExecutionObservation> {
  const memories = structuredClone(fixture.memories) as EngramMemory[];
  const retrieval = inspectLexicalMemories(memories, fixture.input.userMessage, limit);
  const retrievedMemories = retrieval.results.map((result) => result.memory);
  let answer = "";
  for await (const chunk of new DemoChatProvider().streamTurn({
    message: fixture.input.userMessage,
    history: fixture.input.history.map((message) => ({ ...message })),
    retrievedMemories,
    turnIntent: "memory_question"
  })) {
    if (chunk.kind === "text") answer += chunk.delta;
    if (chunk.kind === "error") throw new Error(chunk.message);
  }

  const ids = retrievedMemories.map((memory) => memory.id);
  return {
    answer,
    retrievedMemoryIds: ids,
    loadedMemoryIds: ids,
    provider: { id: "demo" },
    runtime: {
      name: "engram-lexical-demo",
      metadata: {
        retrievalProvider: "lexical",
        retrievalLimit: limit
      }
    }
  };
}
