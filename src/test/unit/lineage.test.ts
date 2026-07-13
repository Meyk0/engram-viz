import { describe, expect, it } from "vitest";
import { buildMemoryLineage } from "@/lib/lineage/build";
import type { TurnRecord } from "@/lib/evidence/types";
import type { DreamProposal, EngramEvent, EngramMemory } from "@/types";

describe("buildMemoryLineage", () => {
  it("connects the turn that created a memory", () => {
    const indigo = memory("indigo", "User loves indigo.");
    const record = turn("turn-store", "I love indigo.", [{ type: "store", memory: indigo }]);

    const graph = buildMemoryLineage({
      focusMemoryId: indigo.id,
      memories: [indigo],
      turnRecords: [record],
      events: record.events
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(["memory:indigo", "turn:turn-store"]);
    expect(graph.edges).toEqual([
      {
        id: "created:turn:turn-store->memory:indigo",
        sourceId: "turn:turn-store",
        targetId: "memory:indigo",
        kind: "created",
        label: "created memory"
      }
    ]);
    expect(graph.relatedMemoryIds).toEqual(["indigo"]);
  });

  it("describes retrieval as supplied context without claiming causal use", () => {
    const indigo = memory("indigo", "User loves indigo.");
    const record = turn("turn-recall", "What color do I love?", [], [indigo]);

    const graph = buildMemoryLineage({
      focusMemoryId: indigo.id,
      memories: [indigo],
      turnRecords: [record],
      events: []
    });
    const edge = graph.edges[0];

    expect(edge).toMatchObject({
      sourceId: "memory:indigo",
      targetId: "turn:turn-recall",
      kind: "supplied_to_answer",
      label: "supplied to answer"
    });
    expect(edge.label).not.toMatch(/caused|influenced|used/i);
  });

  it("links a corrected memory to its current replacement", () => {
    const sf = memory("sf", "User lives in San Francisco.", { status: "superseded" });
    const oakland = memory("oakland", "User lives in Oakland.", { supersedes: [sf.id] });
    const record = turn("turn-correction", "Actually, I live in Oakland now.", [
      { type: "store", memory: oakland }
    ]);

    const graph = buildMemoryLineage({
      focusMemoryId: sf.id,
      memories: [sf, oakland],
      turnRecords: [record],
      events: record.events
    });

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "memory:sf",
          targetId: "memory:oakland",
          kind: "superseded_by",
          label: "updated by"
        }),
        expect.objectContaining({
          sourceId: "turn:turn-correction",
          targetId: "memory:oakland",
          kind: "created"
        })
      ])
    );
    expect(graph.relatedMemoryIds).toEqual(["oakland", "sf"]);
  });

  it("connects consolidation sources to the stable result without duplicate edges", () => {
    const color = memory("color", "User loves indigo.");
    const calm = memory("calm", "User likes calm blue tones.");
    const preference = memory("preference", "User prefers calm blue colors.", {
      region: "temporal",
      sourceMemoryIds: [color.id, calm.id]
    });
    const event: EngramEvent = {
      type: "consolidate",
      removed: [color.id, calm.id],
      added: preference
    };
    const record = turn("turn-consolidate", "I also like calm blue tones.", [event]);

    const graph = buildMemoryLineage({
      focusMemoryId: preference.id,
      memories: [color, calm, preference],
      turnRecords: [record],
      events: [event]
    });

    expect(graph.edges.filter((edge) => edge.kind === "derived")).toEqual([
      expect.objectContaining({ sourceId: "memory:calm", targetId: "memory:preference" }),
      expect.objectContaining({ sourceId: "memory:color", targetId: "memory:preference" })
    ]);
    expect(graph.edges.filter((edge) => edge.kind === "created")).toHaveLength(1);
    expect(graph.edges.find((edge) => edge.kind === "created")?.label).toBe("created stable memory");
  });

  it("shows only applied Dream operations and their resulting lineage", () => {
    const first = memory("first", "User enjoys coastal walks.");
    const second = memory("second", "User likes ocean views.");
    const result = memory("coast", "User values time near the coast.", {
      region: "temporal",
      sourceMemoryIds: [first.id, second.id]
    });
    const applied = dream("dream-applied", first, second, result);
    const dismissed = dream(
      "dream-dismissed",
      result,
      memory("coffee", "User likes coffee."),
      memory("unused", "User enjoys coastal coffee.", { region: "temporal" })
    );

    const dreamTurn = turn("turn-dream", "Review these memories.", [
      { type: "dream_apply", proposal: applied }
    ]);
    const graph = buildMemoryLineage({
      focusMemoryId: result.id,
      memories: [first, second, result],
      turnRecords: [dreamTurn],
      events: [
        { type: "dream_complete", proposal: dismissed },
        { type: "dream_dismiss", proposal: dismissed },
        { type: "dream_apply", proposal: applied }
      ]
    });

    expect(graph.nodes.map((node) => node.id)).toContain("dream:dream-applied");
    expect(graph.nodes.map((node) => node.id)).not.toContain("dream:dream-dismissed");
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "memory:first",
          targetId: "dream:dream-applied",
          kind: "dream_proposed",
          label: "reviewed in applied Dream"
        }),
        expect.objectContaining({
          sourceId: "dream:dream-applied",
          targetId: "memory:coast",
          kind: "created",
          label: "created during applied Dream"
        }),
        expect.objectContaining({
          sourceId: "memory:second",
          targetId: "memory:coast",
          kind: "derived"
        }),
        expect.objectContaining({
          sourceId: "turn:turn-dream",
          targetId: "memory:coast",
          kind: "created"
        })
      ])
    );
  });

  it("filters unrelated lineage components and returns deterministic ordering", () => {
    const focus = memory("focus", "User loves indigo.");
    const related = memory("related", "User likes blue hues.", { sourceMemoryIds: [focus.id] });
    const unrelated = memory("unrelated", "User owns a bicycle.");
    const unrelatedTurn = turn("turn-bike", "I own a bicycle.", [
      { type: "store", memory: unrelated }
    ]);

    const build = () =>
      buildMemoryLineage({
        focusMemoryId: focus.id,
        memories: [unrelated, related, focus],
        turnRecords: [unrelatedTurn],
        events: unrelatedTurn.events
      });

    expect(build()).toEqual(build());
    expect(build().nodes.map((node) => node.id)).toEqual(["memory:focus", "memory:related"]);
    expect(build().edges).toHaveLength(1);
    expect(build().relatedMemoryIds).toEqual(["focus", "related"]);
  });
});

function memory(
  id: string,
  text: string,
  overrides: Partial<EngramMemory> = {}
): EngramMemory {
  return {
    id,
    text,
    importance: 0.8,
    region: "hippocampus",
    created_at: `2026-07-13T00:00:${String(memorySequence++).padStart(2, "0")}.000Z`,
    access_count: 0,
    ...overrides
  };
}

let memorySequence = 0;

function turn(
  id: string,
  userMessage: string,
  events: EngramEvent[],
  retrievedMemories: EngramMemory[] = []
): TurnRecord {
  return {
    version: 1,
    id,
    sessionId: "lineage-test",
    startedAt: "2026-07-13T00:01:00.000Z",
    completedAt: "2026-07-13T00:01:01.000Z",
    userMessage,
    history: [],
    retrievedMemories,
    events,
    originalAnswer: "Here is the answer.",
    provider: { id: "demo" }
  };
}

function dream(
  id: string,
  first: EngramMemory,
  second: EngramMemory,
  result: EngramMemory
): DreamProposal {
  return {
    id,
    provider: "deterministic",
    status: "proposed",
    reason: "Related memories can be reviewed together.",
    created_at: "2026-07-13T00:02:00.000Z",
    operations: [
      {
        id: `${id}-merge`,
        type: "merge",
        sourceIds: [first.id, second.id],
        result,
        reason: "These memories describe a recurring theme.",
        confidence: 0.9
      }
    ]
  };
}
