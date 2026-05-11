import { describe, expect, it } from "vitest";
import {
  deterministicDreamPlanner,
  HybridDreamPlanner,
  type DreamPlanner
} from "@/lib/memory/dream-planner";
import type { EngramMemory } from "@/types";

const NOW = "2026-05-11T12:00:00.000Z";

describe("deterministicDreamPlanner", () => {
  it("skips when fewer than three active memories exist", () => {
    const proposal = deterministicDreamPlanner.decide({
      now: NOW,
      memories: [memory({ id: "one", text: "User likes sushi.", topic: "food" })]
    });

    expect(proposal).toMatchObject({
      provider: "deterministic",
      status: "skipped",
      operations: []
    });
    expect(proposal.reason).toContain("at least three active memories");
  });

  it("merges duplicate or related same-topic hippocampus memories", () => {
    const proposal = deterministicDreamPlanner.decide({
      now: NOW,
      memories: [
        memory({
          id: "sushi-1",
          text: "User likes sushi.",
          topic: "food",
          cluster: "food_preference",
          entities: ["sushi"]
        }),
        memory({
          id: "sushi-2",
          text: "User loves sushi restaurants.",
          topic: "food",
          cluster: "food_preference",
          entities: ["sushi"]
        }),
        memory({ id: "color", text: "User likes blue interfaces.", topic: "design", entities: ["blue"] })
      ]
    });

    expect(proposal.status).toBe("proposed");
    expect(proposal.operations[0]).toMatchObject({
      type: "merge",
      sourceIds: ["sushi-1", "sushi-2"],
      supersedeIds: ["sushi-1", "sushi-2"],
      confidence: 0.78
    });
    expect(proposal.operations[0]?.result).toMatchObject({
      region: "temporal",
      sourceMemoryIds: ["sushi-1", "sushi-2"],
      topic: "food"
    });
  });

  it("supersedes older active memories when a newer memory explicitly replaces them", () => {
    const proposal = deterministicDreamPlanner.decide({
      now: NOW,
      memories: [
        memory({
          id: "old-color",
          text: "User's favorite color is blue.",
          topic: "preference",
          cluster: "favorite_color",
          entities: ["blue"],
          created_at: "2026-05-09T12:00:00.000Z"
        }),
        memory({
          id: "new-color",
          text: "Actually, user's favorite color is red now.",
          topic: "preference",
          cluster: "favorite_color",
          entities: ["red"],
          supersedes: ["old-color"],
          created_at: "2026-05-10T12:00:00.000Z"
        }),
        memory({ id: "food", text: "User likes sushi.", topic: "food", entities: ["sushi"] })
      ]
    });

    expect(proposal.status).toBe("proposed");
    expect(proposal.operations[0]).toMatchObject({
      type: "supersede",
      sourceIds: ["new-color"],
      supersedeIds: ["old-color"]
    });
  });

  it("proposes an insight for recurring patterns across three active memories", () => {
    const proposal = deterministicDreamPlanner.decide({
      now: NOW,
      memories: [
        memory({ id: "d1", text: "User likes calm interfaces.", topic: "design", region: "prefrontal" }),
        memory({ id: "d2", text: "User prefers precise medical UI language.", topic: "design", region: "temporal" }),
        memory({ id: "d3", text: "User values scan-friendly dashboards.", topic: "design", region: "hippocampus" })
      ]
    });

    expect(proposal.status).toBe("proposed");
    expect(proposal.operations[0]).toMatchObject({
      type: "insight",
      sourceIds: ["d1", "d2", "d3"]
    });
    expect(proposal.operations[0]?.result).toMatchObject({
      kind: "semantic",
      region: "temporal",
      sourceMemoryIds: ["d1", "d2", "d3"]
    });
  });
});

describe("HybridDreamPlanner", () => {
  it("falls back when the model planner cannot produce a valid proposal", async () => {
    const modelPlanner: DreamPlanner = {
      provider: "llm",
      decide: async () => {
        throw new Error("model output failed validation");
      }
    };
    const planner = new HybridDreamPlanner(modelPlanner);

    const proposal = await planner.decide({
      now: NOW,
      memories: [
        memory({ id: "a", text: "User likes sushi.", topic: "food", cluster: "food_preference", entities: ["sushi"] }),
        memory({
          id: "b",
          text: "User loves sushi restaurants.",
          topic: "food",
          cluster: "food_preference",
          entities: ["sushi"]
        }),
        memory({ id: "c", text: "User likes blue.", topic: "design", entities: ["blue"] })
      ]
    });

    expect(proposal.provider).toBe("fallback");
    expect(proposal.reason).toContain("model output failed validation");
    expect(proposal.operations[0]?.type).toBe("merge");
  });
});

function memory(input: Partial<EngramMemory> & { id: string; text: string }): EngramMemory {
  return {
    importance: 0.7,
    region: "hippocampus",
    created_at: "2026-05-10T12:00:00.000Z",
    access_count: 0,
    ...input
  };
}
