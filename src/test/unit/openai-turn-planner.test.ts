import { describe, expect, it, vi } from "vitest";
import { OpenAITurnMemoryPlanner, parseOpenAITurnPlan } from "@/lib/memory/openai-turn-planner";

describe("OpenAITurnMemoryPlanner", () => {
  it("requests a strict structured turn plan and accepts valid output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify({
          confidence: 0.91,
          reason: "The user stated a durable relationship fact.",
          intent: "durable_statement",
          shouldRetrieve: false,
          retrieveQuery: null,
          memories: [
            {
              text: "User's partner is named Alex.",
              kind: "relationship",
              topic: "relationship",
              importance: 0.76,
              confidence: 0.91,
              entities: ["Alex", "relationship"],
              sourceText: "My partner's name is Alex",
              cluster: "relationship",
              supersedes: []
            }
          ],
          supersedeMemoryIds: []
        })
      })
    );
    const planner = new OpenAITurnMemoryPlanner({
      apiKey: "test-key",
      fetcher,
      model: "test-model"
    });

    const plan = await planner.decide({ message: "My partner's name is Alex" });

    expect(plan).toMatchObject({
      provider: "llm",
      intent: "durable_statement",
      shouldRetrieve: false
    });
    expect(plan.memories[0]).toMatchObject({
      text: "User's partner is named Alex.",
      kind: "relationship"
    });
    const request = fetcher.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body.model).toBe("test-model");
    expect(body.text.format).toMatchObject({
      type: "json_schema",
      name: "engram_turn_memory_plan",
      strict: true
    });
  });

  it("falls back for invalid model output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ output_text: "{bad json" }));
    const planner = new OpenAITurnMemoryPlanner({ apiKey: "test-key", fetcher });

    const plan = await planner.decide({ message: "I love sushi" });

    expect(plan.provider).toBe("fallback");
    expect(plan.memories[0]?.text).toBe("I love sushi");
    expect(plan.reason).toContain("failed validation");
  });

  it("falls back when confidence is below threshold", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output_text: JSON.stringify({
          confidence: 0.2,
          reason: "Unsure.",
          intent: "general_chat",
          shouldRetrieve: false,
          retrieveQuery: null,
          memories: [],
          supersedeMemoryIds: []
        })
      })
    );
    const planner = new OpenAITurnMemoryPlanner({ apiKey: "test-key", fetcher, minConfidence: 0.65 });

    const plan = await planner.decide({ message: "Deep red interfaces are my thing." });

    expect(plan.provider).toBe("fallback");
    expect(plan.reason).toContain("below 0.65");
  });
});

describe("parseOpenAITurnPlan", () => {
  it("rejects supersede ids that are not active memories", () => {
    expect(() =>
      parseOpenAITurnPlan(
        JSON.stringify({
          confidence: 0.9,
          reason: "Correction.",
          intent: "correction",
          shouldRetrieve: false,
          retrieveQuery: null,
          memories: [],
          supersedeMemoryIds: ["missing"]
        }),
        { message: "Actually I live in Oakland now", memories: [] }
      )
    ).toThrow(/not eligible/);
  });
});
