import { describe, expect, it } from "vitest";
import {
  deterministicMemoryDecisionPlanner,
  memoryDecisionSchema,
  parseMemoryDecision,
  planMemoryDecision
} from "@/lib/memory/decision";

describe("memory decision planner", () => {
  it("stores preferences through the deterministic rules adapter", () => {
    const decision = deterministicMemoryDecisionPlanner.decide({
      message: "I prefer restrained medical cyberpunk interfaces."
    });

    expect(decision).toMatchObject({
      provider: "deterministic",
      operation: "store",
      reason: "preference",
      memoryText: "I prefer restrained medical cyberpunk interfaces.",
      topic: "design"
    });
    expect(decision.importance).toBeGreaterThan(0);
    expect(decision.confidence).toBe(decision.importance);
    expect(decision.relatedMemoryIds).toEqual([]);
  });

  it("ignores questions without changing deterministic behavior", () => {
    const decision = planMemoryDecision({
      message: "What interface style do I prefer?",
      relatedMemoryIds: ["mem-style"]
    });

    expect(decision).toEqual({
      provider: "deterministic",
      operation: "ignore",
      confidence: 1,
      reason: "trivial-question",
      relatedMemoryIds: ["mem-style"]
    });
  });
});

describe("memory decision schema", () => {
  it("rejects invalid JSON for future LLM output", () => {
    expect(() => parseMemoryDecision("{bad json")).toThrow(/Invalid memory decision JSON/);
  });

  it("applies defaults and enforces numeric ranges", () => {
    const decision = parseMemoryDecision({
      provider: "llm",
      operation: "ignore",
      confidence: 0.25,
      reason: "Not durable enough to store"
    });

    expect(decision.relatedMemoryIds).toEqual([]);
    expect(() =>
      memoryDecisionSchema.parse({
        provider: "llm",
        operation: "store",
        confidence: 1.1,
        reason: "Out of range",
        memoryText: "User likes red interfaces",
        importance: -0.1
      })
    ).toThrow();
  });
});
