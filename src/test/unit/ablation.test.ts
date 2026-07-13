import { describe, expect, it, vi } from "vitest";
import {
  CAUSAL_ABLATION_CAVEAT,
  CausalAblationProviderError,
  CausalAblationValidationError,
  compareReplayAnswers,
  runCausalAblation
} from "@/lib/evidence/ablation";
import type { ChatProviderClient, ChatTurnInput } from "@/lib/chat/providers/types";
import type { TurnRecord } from "@/lib/evidence/types";
import type { EngramMemory } from "@/types";

describe("runCausalAblation", () => {
  it("replays the frozen turn once with all memories and once without excluded memories", async () => {
    const record = makeRecord();
    const originalRecord = structuredClone(record);
    const inputs: ChatTurnInput[] = [];
    const provider = providerFrom(async function* (input) {
      inputs.push(structuredClone(input));
      yield {
        kind: "text",
        delta: input.retrievedMemories.some((memory) => memory.id === "mem-color")
          ? "Your favorite color is indigo."
          : "I do not know your favorite color."
      };
      yield { kind: "done" };
    });

    const result = await runCausalAblation(
      { record, excludedMemoryIds: ["mem-color"] },
      provider
    );

    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toEqual({
      message: record.userMessage,
      history: record.history,
      retrievedMemories: record.retrievedMemories
    });
    expect(inputs[1]?.retrievedMemories.map((memory) => memory.id)).toEqual(["mem-location"]);
    expect(result).toMatchObject({
      version: 2,
      recordId: record.id,
      excludedMemoryIds: ["mem-color"],
      originalAnswer: record.originalAnswer,
      baselineAnswer: "Your favorite color is indigo.",
      counterfactualAnswer: "I do not know your favorite color.",
      changed: true,
      comparison: {
        outcome: "changed",
        baselineRuns: 1,
        counterfactualRuns: 1
      },
      caveat: CAUSAL_ABLATION_CAVEAT,
      provider: { id: "demo", model: "test-model" }
    });
    expect(result.comparison.normalizedTextDistance).toBeGreaterThan(0);
    expect(result.comparison.normalizedTextDistance).toBeLessThanOrEqual(1);
    expect(record).toEqual(originalRecord);
  });

  it("rejects duplicate and non-retrieved memory IDs before calling the provider", async () => {
    const streamTurn = vi.fn<ChatProviderClient["streamTurn"]>();
    const provider: ChatProviderClient = { id: "demo", streamTurn };

    await expect(
      runCausalAblation(
        { record: makeRecord(), excludedMemoryIds: ["mem-color", "mem-color"] },
        provider
      )
    ).rejects.toBeInstanceOf(CausalAblationValidationError);
    await expect(
      runCausalAblation(
        { record: makeRecord(), excludedMemoryIds: ["not-retrieved"] },
        provider
      )
    ).rejects.toBeInstanceOf(CausalAblationValidationError);
    await expect(
      runCausalAblation({ record: makeRecord(), excludedMemoryIds: [] }, provider)
    ).rejects.toBeInstanceOf(CausalAblationValidationError);
    expect(streamTurn).not.toHaveBeenCalled();
  });

  it("contains provider exceptions and error chunks behind a safe error", async () => {
    const throwingProvider = providerFrom(async function* () {
      throw new Error("upstream secret: provider payload");
    });
    const errorChunkProvider = providerFrom(async function* () {
      yield { kind: "error", message: "upstream secret: quota details" };
    });

    await expect(
      runCausalAblation(
        { record: makeRecord(), excludedMemoryIds: ["mem-color"] },
        throwingProvider
      )
    ).rejects.toEqual(expect.objectContaining({
      name: "CausalAblationProviderError",
      message: expect.not.stringContaining("secret")
    }));
    await expect(
      runCausalAblation(
        { record: makeRecord(), excludedMemoryIds: ["mem-color"] },
        errorChunkProvider
      )
    ).rejects.toBeInstanceOf(CausalAblationProviderError);
  });
});

describe("compareReplayAnswers", () => {
  it("reports transparent, deterministic comparison measurements", () => {
    expect(compareReplayAnswers("same answer", "same   answer")).toMatchObject({
      outcome: "stable",
      normalizedTextDistance: 0
    });
    expect(compareReplayAnswers("", "").normalizedTextDistance).toBe(0);
    expect(compareReplayAnswers("abc", "xyz").normalizedTextDistance).toBe(1);
    expect(compareReplayAnswers("indigo", "blue")).toEqual(
      compareReplayAnswers("indigo", "blue")
    );
  });
});

function providerFrom(
  streamTurn: ChatProviderClient["streamTurn"]
): ChatProviderClient {
  return { id: "demo", model: "test-model", streamTurn };
}

function makeRecord(): TurnRecord {
  return {
    version: 1,
    id: "turn-ablation-1",
    sessionId: "session-ablation",
    startedAt: "2026-07-13T10:00:00.000Z",
    completedAt: "2026-07-13T10:00:01.000Z",
    userMessage: "What is my favorite color?",
    history: [{ role: "user", content: "We were discussing preferences." }],
    retrievedMemories: [
      memory("mem-color", "User's favorite color is indigo."),
      memory("mem-location", "User lives in San Francisco.")
    ],
    events: [],
    originalAnswer: "You told me your favorite color is indigo.",
    provider: { id: "demo" }
  };
}

function memory(id: string, text: string): EngramMemory {
  return {
    id,
    text,
    importance: 0.8,
    region: "hippocampus",
    created_at: "2026-07-13T09:00:00.000Z",
    access_count: 1
  };
}
