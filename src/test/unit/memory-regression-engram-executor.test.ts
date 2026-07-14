import { describe, expect, it } from "vitest";
import { createEngramLexicalRegressionExecutor } from "@/lib/regressions/engram-executor";

describe("Engram lexical regression executor", () => {
  it("retrieves active matching memories and answers from their evidence", async () => {
    const execute = createEngramLexicalRegressionExecutor({ limit: 1 });
    const observation = await execute({
      memories: [
        memory("old-city", "User lived in San Francisco.", "superseded"),
        memory("current-city", "User lives in Oakland now.", "active")
      ],
      input: { userMessage: "What city do I live in now?", history: [] }
    });

    expect(observation).toMatchObject({
      answer: "Based on the retrieved memory: User lives in Oakland now.",
      retrievedMemoryIds: ["current-city"],
      loadedMemoryIds: ["current-city"],
      runtime: { name: "engram-lexical-demo" }
    });
  });

  it("validates its deterministic retrieval limit", () => {
    expect(() => createEngramLexicalRegressionExecutor({ limit: 0 })).toThrow(/between 1 and 100/);
  });
});

function memory(id: string, text: string, status: "active" | "superseded") {
  return {
    id,
    text,
    importance: 0.85,
    topic: "current location",
    region: "hippocampus" as const,
    created_at: "2026-07-14T18:00:00.000Z",
    access_count: 0,
    status
  };
}
