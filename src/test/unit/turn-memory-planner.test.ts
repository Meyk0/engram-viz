import { describe, expect, it } from "vitest";
import {
  deterministicTurnMemoryPlanner,
  HybridTurnMemoryPlanner,
  parseTurnMemoryPlan,
  type TurnMemoryPlanner
} from "@/lib/memory/turn-planner";
import type { EngramMemory } from "@/types";

describe("turn memory planner", () => {
  it("stores standalone durable preferences without retrieval", () => {
    const plan = deterministicTurnMemoryPlanner.decide({
      message: "I love sushi"
    });

    expect(plan).toMatchObject({
      provider: "deterministic",
      intent: "durable_statement",
      shouldRetrieve: false
    });
    expect(plan.memories).toHaveLength(1);
    expect(plan.memories[0]).toMatchObject({
      kind: "preference",
      topic: "food",
      cluster: "food_preference"
    });
  });

  it("retrieves only for explicit memory questions", () => {
    const plan = deterministicTurnMemoryPlanner.decide({
      message: "What food do I like?"
    });

    expect(plan.memories).toEqual([]);
    expect(plan.shouldRetrieve).toBe(true);
    expect(plan.intent).toBe("memory_question");
  });

  it("does not store standalone world facts as user memory", () => {
    const plan = deterministicTurnMemoryPlanner.decide({
      message: "San Francisco has amazing coffee roasters"
    });

    expect(plan.intent).toBe("general_chat");
    expect(plan.shouldRetrieve).toBe(false);
    expect(plan.memories).toEqual([]);
  });

  it("stores contextual place appreciation when prior user context exists", () => {
    const plan = deterministicTurnMemoryPlanner.decide({
      message: "San Francisco has amazing coffee roasters",
      memories: [
        memory({
          id: "sf",
          text: "User moved to San Francisco a couple years ago.",
          topic: "location",
          entities: ["san francisco"]
        })
      ]
    });

    expect(plan.memories[0]).toMatchObject({
      kind: "place_fact",
      topic: "location",
      cluster: "location_life"
    });
    expect(plan.shouldRetrieve).toBe(false);
  });

  it("marks correction memories as superseding prior active memories", () => {
    const plan = deterministicTurnMemoryPlanner.decide({
      message: "Actually, I live in Oakland now",
      memories: [
        memory({
          id: "sf",
          text: "User moved to San Francisco a couple years ago.",
          topic: "location",
          cluster: "current_location",
          entities: ["san francisco"]
        })
      ]
    });

    expect(plan.intent).toBe("correction");
    expect(plan.supersedeMemoryIds).toEqual(["sf"]);
    expect(plan.memories[0]).toMatchObject({
      kind: "correction",
      topic: "location",
      supersedes: ["sf"]
    });
  });

  it("uses the model planner only for ambiguous durable turns", async () => {
    let calls = 0;
    const modelPlanner: TurnMemoryPlanner = {
      provider: "llm",
      decide: () => {
        calls += 1;
        return {
          provider: "llm",
          confidence: 0.9,
          reason: "Ambiguous user preference.",
          intent: "durable_statement",
          shouldRetrieve: false,
          retrieveQuery: null,
          memories: [
            {
              text: "User prefers deep red interfaces.",
              kind: "preference",
              topic: "design",
              importance: 0.8,
              confidence: 0.9,
              entities: ["red"],
              sourceText: "Deep red interfaces are my thing.",
              cluster: "favorite_color",
              supersedes: []
            }
          ],
          supersedeMemoryIds: []
        };
      }
    };
    const planner = new HybridTurnMemoryPlanner(modelPlanner);

    const fastPlan = await planner.decide({ message: "I love sushi" });
    const modelPlan = await planner.decide({ message: "Deep red interfaces are my thing." });

    expect(fastPlan.provider).toBe("deterministic");
    expect(modelPlan.provider).toBe("llm");
    expect(calls).toBe(1);
  });
});

describe("turn memory plan schema", () => {
  it("rejects invalid planner JSON", () => {
    expect(() => parseTurnMemoryPlan("{bad json")).toThrow(/Invalid turn memory plan JSON/);
  });
});

function memory(input: Partial<EngramMemory> & { id: string; text: string }): EngramMemory {
  return {
    importance: 0.78,
    region: "hippocampus",
    created_at: "2026-04-29T17:00:00.000Z",
    access_count: 0,
    ...input
  };
}
