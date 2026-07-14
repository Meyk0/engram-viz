import { describe, expect, it } from "vitest";
import { benchmarkDreamProposal, projectDreamMemories } from "@/lib/integrity/dream-benchmark";
import type { DreamOperation, DreamProposal, EngramMemory } from "@/types";

describe("dream benchmark", () => {
  it("projects merge effects without mutating the current memories", () => {
    const before = [
      memory("one", "User loves indigo."),
      memory("two", "User loves indigo.")
    ];
    const proposal = dreamProposal({
      id: "merge",
      type: "merge",
      sourceIds: ["one", "two"],
      supersedeIds: ["one", "two"],
      result: memory("stable", "User loves indigo.", { region: "temporal", sourceMemoryIds: ["one", "two"] })
    });
    const original = structuredClone(before);

    const benchmark = benchmarkDreamProposal(before, proposal);

    expect(before).toEqual(original);
    expect(benchmark.before.duplicatePairs).toBe(1);
    expect(benchmark.after.duplicatePairs).toBe(0);
    expect(benchmark.after.temporalMemories).toBe(1);
    expect(benchmark.verdict).toBe("improved");
  });

  it("marks destructive proposals as regressed", () => {
    const before = [memory("one", "User lives in Oakland and loves Lake Merritt.")];
    const proposal = dreamProposal({
      id: "remove",
      type: "supersede",
      sourceIds: ["one"],
      supersedeIds: ["one"]
    });

    const benchmark = benchmarkDreamProposal(before, proposal);
    expect(benchmark.estimatedInformationRetention).toBe(0);
    expect(benchmark.verdict).toBe("regressed");
  });

  it("leaves memory state unchanged for skipped proposals", () => {
    const before = [memory("one", "User likes tea.")];
    const proposal: DreamProposal = {
      id: "skip",
      provider: "deterministic",
      status: "skipped",
      reason: "No safe operation",
      operations: [],
      created_at: "2026-01-01T00:00:00.000Z"
    };
    expect(projectDreamMemories(before, proposal)).toEqual(before);
  });
});

function dreamProposal(operation: Omit<DreamOperation, "reason" | "confidence">): DreamProposal {
  return {
    id: "dream",
    provider: "deterministic",
    status: "proposed",
    reason: "Test proposal",
    operations: [{ reason: "Test operation", confidence: 0.9, ...operation }],
    created_at: "2026-01-01T00:00:00.000Z"
  };
}

function memory(id: string, text: string, overrides: Partial<EngramMemory> = {}): EngramMemory {
  return {
    id,
    text,
    importance: 0.7,
    confidence: 0.8,
    sourceText: text,
    cluster: "preference",
    region: "hippocampus",
    created_at: "2026-01-01T00:00:00.000Z",
    access_count: 0,
    ...overrides
  };
}
