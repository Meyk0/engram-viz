import { describe, expect, it, vi } from "vitest";
import { HybridDreamPlanner } from "@/lib/memory/dream-planner";
import { OpenAIDreamPlanner, parseOpenAIDreamProposal } from "@/lib/memory/openai-dream-planner";
import type { EngramMemory } from "@/types";

const NOW = "2026-05-11T12:00:00.000Z";

describe("OpenAIDreamPlanner", () => {
  it("requests a strict structured dream proposal and accepts valid output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ output_text: JSON.stringify(validMergeOutput()) }));
    const planner = new OpenAIDreamPlanner({
      apiKey: "test-key",
      fetcher,
      model: "test-model"
    });

    const proposal = await planner.decide({ memories: dreamMemories(), now: NOW });

    expect(proposal).toMatchObject({
      provider: "llm",
      status: "proposed"
    });
    expect(proposal.operations[0]).toMatchObject({
      type: "merge",
      sourceIds: ["sushi-1", "sushi-2"],
      confidence: 0.86
    });
    const request = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body.model).toBe("test-model");
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      name: "engram_dream_proposal",
      strict: true
    });
  });

  it("falls back through the hybrid planner for invalid model output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ output_text: "{bad json" }));
    const planner = new HybridDreamPlanner(new OpenAIDreamPlanner({ apiKey: "test-key", fetcher }));

    const proposal = await planner.decide({ memories: dreamMemories(), now: NOW });

    expect(proposal.provider).toBe("fallback");
    expect(proposal.reason).toContain("failed validation");
    expect(proposal.operations[0]?.type).toBe("merge");
  });

  it("falls back through the hybrid planner when confidence is below threshold", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify({
          ...validMergeOutput(),
          operations: [{ ...validMergeOutput().operations[0], confidence: 0.2 }]
        })
      })
    );
    const planner = new HybridDreamPlanner(
      new OpenAIDreamPlanner({ apiKey: "test-key", fetcher, minConfidence: 0.65 })
    );

    const proposal = await planner.decide({ memories: dreamMemories(), now: NOW });

    expect(proposal.provider).toBe("fallback");
    expect(proposal.reason).toContain("below 0.65");
    expect(proposal.operations[0]?.type).toBe("merge");
  });
});

describe("parseOpenAIDreamProposal", () => {
  it("rejects operation ids that are not active memories", () => {
    expect(() =>
      parseOpenAIDreamProposal(
        JSON.stringify({
          ...validMergeOutput(),
          operations: [
            {
              ...validMergeOutput().operations[0],
              sourceIds: ["missing", "sushi-2"]
            }
          ]
        }),
        { memories: dreamMemories(), now: NOW }
      )
    ).toThrow(/not eligible/);
  });
});

function validMergeOutput() {
  return {
    status: "proposed",
    reason: "Sushi memories are tightly related hippocampus traces.",
    operations: [
      {
        id: "op-merge-sushi",
        type: "merge",
        sourceIds: ["sushi-1", "sushi-2"],
        result: {
          id: "dream-sushi",
          text: "User has a recurring sushi preference.",
          importance: 0.78,
          topic: "food",
          kind: "semantic",
          entities: ["sushi"],
          confidence: 0.86,
          sourceText: null,
          cluster: "food_preference",
          status: null,
          supersedes: [],
          sourceMemoryIds: ["sushi-1", "sushi-2"],
          region: "temporal"
        },
        supersedeIds: ["sushi-1", "sushi-2"],
        reason: "The source memories repeat the same sushi preference.",
        confidence: 0.86
      }
    ]
  };
}

function dreamMemories(): EngramMemory[] {
  return [
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
    memory({ id: "design", text: "User likes blue interfaces.", topic: "design", entities: ["blue"] })
  ];
}

function memory(input: Partial<EngramMemory> & { id: string; text: string }): EngramMemory {
  return {
    importance: 0.7,
    region: "hippocampus",
    created_at: "2026-05-10T12:00:00.000Z",
    access_count: 0,
    ...input
  };
}
