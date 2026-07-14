import { describe, expect, it, vi } from "vitest";
import { HybridDreamPlanner } from "@/lib/memory/dream-planner";
import { OpenAIDreamPlanner, parseOpenAIDreamProposal } from "@/lib/memory/openai-dream-planner";
import type { EngramMemory } from "@/types";

const NOW = "2026-05-11T12:00:00.000Z";

type RawDreamMemoryFixture = {
  id: string | null;
  text: string;
  importance: number;
  topic: string | null;
  kind: string | null;
  entities: string[];
  confidence: number | null;
  sourceText: string | null;
  cluster: string | null;
  status: "active" | "superseded" | null;
  supersedes: string[];
  sourceMemoryIds: string[];
  region: "prefrontal" | "hippocampus" | "temporal";
};

type RawDreamOperationFixture = {
  id: string;
  type: "merge" | "supersede" | "insight";
  sourceIds: string[];
  result: RawDreamMemoryFixture | null;
  supersedeIds: string[];
  reason: string;
  confidence: number;
};

type RawDreamProposalFixture = {
  status: "proposed" | "skipped";
  reason: string;
  operations: RawDreamOperationFixture[];
};

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
    expect(proposal.operations[0]?.result).toMatchObject({
      kind: "semantic",
      region: "temporal",
      sourceMemoryIds: ["sushi-1", "sushi-2"],
      status: "active",
      supersedes: ["sushi-1", "sushi-2"]
    });
    expect(proposal.operations[0]?.result?.id).toMatch(/^dream-result-merge-/);
    expect(proposal.operations[0]?.result?.id).not.toBe("dream-sushi");
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

  it("falls back deterministically when the model fabricates result lineage", async () => {
    const output = validMergeOutput();
    output.operations[0]!.result!.sourceMemoryIds = ["sushi-1", "design"];
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ output_text: JSON.stringify(output) })
    );
    const planner = new HybridDreamPlanner(new OpenAIDreamPlanner({ apiKey: "test-key", fetcher }));

    const proposal = await planner.decide({ memories: dreamMemories(), now: NOW });

    expect(proposal.provider).toBe("fallback");
    expect(proposal.reason).toContain("sourceMemoryIds must exactly match source ids");
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

  it("normalizes model-controlled lifecycle fields and creates a server-owned result id", () => {
    const output = validMergeOutput();
    output.operations[0]!.result!.id = null;
    output.operations[0]!.result!.kind = "episodic";
    output.operations[0]!.result!.region = "prefrontal";
    output.operations[0]!.result!.status = "superseded";

    const first = parseOpenAIDreamProposal(JSON.stringify(output), { memories: dreamMemories(), now: NOW });
    const second = parseOpenAIDreamProposal(JSON.stringify(output), { memories: dreamMemories(), now: NOW });

    expect(first.operations[0]?.result).toMatchObject({
      kind: "semantic",
      region: "temporal",
      status: "active",
      sourceMemoryIds: ["sushi-1", "sushi-2"],
      supersedes: ["sushi-1", "sushi-2"]
    });
    expect(first.operations[0]?.result?.id).toMatch(/^dream-result-merge-/);
    expect(first.operations[0]?.result?.id).not.toBe(second.operations[0]?.result?.id);
    expect(dreamMemories().map((memory) => memory.id)).not.toContain(first.operations[0]?.result?.id);
  });

  it("normalizes insight results into active temporal semantic memories without retiring sources", () => {
    const output = validInsightOutput();
    output.operations[0]!.result!.kind = "episodic";
    output.operations[0]!.result!.region = "hippocampus";
    output.operations[0]!.result!.status = "superseded";

    const proposal = parseOpenAIDreamProposal(JSON.stringify(output), {
      memories: insightMemories(),
      now: NOW
    });

    expect(proposal.operations[0]).toMatchObject({
      type: "insight",
      sourceIds: ["nature", "hiking", "beaches"]
    });
    expect(proposal.operations[0]?.supersedeIds).toBeUndefined();
    expect(proposal.operations[0]?.result).toMatchObject({
      kind: "semantic",
      region: "temporal",
      sourceMemoryIds: ["nature", "hiking", "beaches"],
      status: "active"
    });
    expect(proposal.operations[0]?.result?.supersedes).toBeUndefined();
    expect(proposal.operations[0]?.result?.id).toMatch(/^dream-result-insight-/);
  });

  it("rejects a model-proposed result id that collides with an existing memory", () => {
    const output = validMergeOutput();
    output.operations[0]!.result!.id = "design";

    expect(() =>
      parseOpenAIDreamProposal(JSON.stringify(output), { memories: dreamMemories(), now: NOW })
    ).toThrow(/collides with an existing memory/);
  });

  it("rejects duplicate model-proposed result ids across operations", () => {
    const output = validMergeOutput();
    output.operations.push({
      ...structuredClone(output.operations[0]),
      id: "op-merge-sushi-again"
    });

    expect(() =>
      parseOpenAIDreamProposal(JSON.stringify(output), { memories: dreamMemories(), now: NOW })
    ).toThrow(/result ids must be unique/);
  });

  it("rejects duplicate operation ids", () => {
    const output = validMergeOutput();
    output.operations.push(structuredClone(output.operations[0]));

    expect(() =>
      parseOpenAIDreamProposal(JSON.stringify(output), { memories: dreamMemories(), now: NOW })
    ).toThrow(/operation ids must be unique/);
  });

  it("rejects result lineage that omits or adds operation sources", () => {
    const missing = validMergeOutput();
    missing.operations[0]!.result!.sourceMemoryIds = ["sushi-1"];
    const unrelated = validMergeOutput();
    unrelated.operations[0]!.result!.sourceMemoryIds = ["sushi-1", "design"];

    expect(() =>
      parseOpenAIDreamProposal(JSON.stringify(missing), { memories: dreamMemories(), now: NOW })
    ).toThrow(/sourceMemoryIds must exactly match source ids/);
    expect(() =>
      parseOpenAIDreamProposal(JSON.stringify(unrelated), { memories: dreamMemories(), now: NOW })
    ).toThrow(/sourceMemoryIds must exactly match source ids/);
  });

  it("rejects unrelated merge sources even when their lineage is internally consistent", () => {
    const output = validMergeOutput();
    output.operations[0].sourceIds = ["sushi-1", "design"];
    output.operations[0].supersedeIds = ["sushi-1", "design"];
    output.operations[0]!.result!.sourceMemoryIds = ["sushi-1", "design"];

    expect(() =>
      parseOpenAIDreamProposal(JSON.stringify(output), { memories: dreamMemories(), now: NOW })
    ).toThrow(/do not share a supported memory signal/);
  });

  it("rejects temporal memories as merge sources", () => {
    const memories = dreamMemories().map((candidate) =>
      candidate.id === "sushi-2" ? { ...candidate, region: "temporal" as const } : candidate
    );

    expect(() =>
      parseOpenAIDreamProposal(JSON.stringify(validMergeOutput()), { memories, now: NOW })
    ).toThrow(/merge sources must be active hippocampus memories/);
  });

  it("rejects inactive and unrelated supersede targets", () => {
    const activeCityMemories = [
      ...dreamMemories(),
      memory({
        id: "city-new",
        text: "User lives in Oakland now.",
        topic: "location",
        cluster: "current_location",
        entities: ["Oakland"]
      }),
      memory({
        id: "city-old",
        text: "User lives in San Francisco.",
        topic: "location",
        cluster: "current_location",
        entities: ["San Francisco"]
      })
    ];
    const inactiveCityMemories = activeCityMemories.map((candidate) =>
      candidate.id === "city-old" ? { ...candidate, status: "superseded" as const } : candidate
    );

    expect(() =>
      parseOpenAIDreamProposal(JSON.stringify(validSupersedeOutput("city-old")), {
        memories: inactiveCityMemories,
        now: NOW
      })
    ).toThrow(/not eligible/);
    expect(() =>
      parseOpenAIDreamProposal(JSON.stringify(validSupersedeOutput("design")), {
        memories: activeCityMemories,
        now: NOW
      })
    ).toThrow(/is unrelated to its source memories/);
  });

  it("rejects supersede operations that try to create a model-owned result", () => {
    const memories = [
      ...dreamMemories(),
      memory({
        id: "city-new",
        text: "User lives in Oakland now.",
        topic: "location",
        cluster: "current_location"
      }),
      memory({
        id: "city-old",
        text: "User lived in San Francisco.",
        topic: "location",
        cluster: "current_location"
      })
    ];
    const output = validSupersedeOutput("city-old");
    output.operations[0].result = {
      ...requiredResult(validMergeOutput()),
      sourceMemoryIds: ["city-new"]
    };

    expect(() => parseOpenAIDreamProposal(JSON.stringify(output), { memories, now: NOW })).toThrow(
      /supersede operations cannot create a result memory/
    );
  });

  it("rejects active memories that were outside the bounded planner prompt", () => {
    const memories = Array.from({ length: 41 }, (_, index) =>
      memory({
        id: `bounded-${index}`,
        text: `User has bounded memory ${index}.`,
        topic: "bounded",
        cluster: "bounded",
        entities: ["bounded"]
      })
    );
    const output = validMergeOutput();
    output.operations[0].sourceIds = ["bounded-0", "bounded-40"];
    output.operations[0].supersedeIds = ["bounded-0", "bounded-40"];
    output.operations[0]!.result!.sourceMemoryIds = ["bounded-0", "bounded-40"];

    expect(() => parseOpenAIDreamProposal(JSON.stringify(output), { memories, now: NOW })).toThrow(/not eligible/);
  });
});

function validMergeOutput(): RawDreamProposalFixture {
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

function insightMemories(): EngramMemory[] {
  return [
    memory({ id: "nature", text: "User loves nature.", topic: "outdoors", cluster: "outdoors" }),
    memory({ id: "hiking", text: "User hikes every weekend.", topic: "outdoors", cluster: "outdoors" }),
    memory({ id: "beaches", text: "User enjoys beaches.", topic: "outdoors", cluster: "outdoors" })
  ];
}

function validInsightOutput(): RawDreamProposalFixture {
  return {
    status: "proposed",
    reason: "Several memories support an outdoors pattern.",
    operations: [
      {
        id: "op-insight-outdoors",
        type: "insight",
        sourceIds: ["nature", "hiking", "beaches"],
        result: {
          id: "model-owned-outdoors-insight",
          text: "User consistently enjoys outdoor activities.",
          importance: 0.8,
          topic: "outdoors",
          kind: "semantic",
          entities: [],
          confidence: 0.82,
          sourceText: null,
          cluster: "outdoors",
          status: null,
          supersedes: [],
          sourceMemoryIds: ["nature", "hiking", "beaches"],
          region: "temporal"
        },
        supersedeIds: [],
        reason: "The source memories consistently describe outdoor interests.",
        confidence: 0.82
      }
    ]
  };
}

function validSupersedeOutput(targetId: string): RawDreamProposalFixture {
  return {
    status: "proposed",
    reason: "A newer location memory replaces an older location memory.",
    operations: [
      {
        id: "op-supersede-city",
        type: "supersede",
        sourceIds: ["city-new"],
        result: null,
        supersedeIds: [targetId],
        reason: "The current city changed.",
        confidence: 0.9
      }
    ]
  };
}

function requiredResult(output: RawDreamProposalFixture): RawDreamMemoryFixture {
  const result = output.operations[0]?.result;
  if (!result) throw new Error("Expected test fixture to include a result memory.");
  return result;
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
