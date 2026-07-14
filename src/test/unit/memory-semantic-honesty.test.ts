import { describe, expect, it } from "vitest";
import {
  findConsolidationCandidate,
  selectConsolidationPool
} from "@/lib/memory/consolidationPolicy";
import { createMemory, createMemorySession, markAccessed } from "@/lib/memory/store";
import type { EngramMemory } from "@/types";

describe("memory region honesty", () => {
  it("never promotes a hippocampus memory through access accounting", () => {
    const session = createMemorySession("access-honesty");
    const raw = createMemory(session, {
      text: "User prefers indigo interfaces.",
      now: "2026-07-14T10:00:00.000Z"
    });

    let accessed = raw;
    for (let index = 0; index < 20; index += 1) {
      [accessed] = markAccessed(session, [raw.id], `2026-07-14T10:${String(index).padStart(2, "0")}:00.000Z`);
    }

    expect(accessed).toMatchObject({
      id: raw.id,
      access_count: 20,
      region: "hippocampus"
    });
  });

  it("preserves an explicitly temporal memory while recording access", () => {
    const session = createMemorySession("temporal-access");
    const temporal = memory({ id: "stable", text: "User prefers indigo.", region: "temporal" });
    session.memories.set(temporal.id, temporal);

    const [accessed] = markAccessed(session, [temporal.id], "2026-07-14T11:00:00.000Z");

    expect(accessed).toMatchObject({ access_count: 1, region: "temporal" });
  });
});

describe("deterministic consolidation honesty", () => {
  it("keeps unrelated memories separate when only their broad topic matches", () => {
    const memories = [
      memory({ id: "sushi", text: "User loves sushi.", topic: "preference", cluster: "preference" }),
      memory({
        id: "climbing",
        text: "User spends weekends climbing.",
        topic: "preference",
        cluster: "preference"
      }),
      memory({
        id: "type",
        text: "User prefers large typography.",
        topic: "preference",
        cluster: "preference"
      })
    ];

    expect(findConsolidationCandidate(memories)).toBeNull();
  });

  it("does not let one related pair pull an unrelated same-topic fact into a merge", () => {
    const candidate = findConsolidationCandidate([
      memory({ id: "red", text: "User prefers red interface accents.", topic: "design" }),
      memory({ id: "medical", text: "User likes restrained medical UI.", topic: "design" }),
      memory({ id: "garden", text: "User wants a rooftop herb garden.", topic: "design" })
    ]);

    expect(candidate?.ids).toEqual(["red", "medical"]);
  });

  it("consolidates memories that share a specific cluster", () => {
    const candidate = findConsolidationCandidate([
      memory({
        id: "stack",
        text: "The project uses React Three Fiber.",
        topic: "work",
        cluster: "engram_project"
      }),
      memory({
        id: "deadline",
        text: "The project deadline is June.",
        topic: "work",
        cluster: "engram_project"
      })
    ]);

    expect(candidate?.ids).toEqual(["stack", "deadline"]);
  });

  it("consolidates memories that share a concrete normalized entity", () => {
    const candidate = findConsolidationCandidate([
      memory({
        id: "move",
        text: "User moved to San Francisco.",
        topic: "location",
        entities: ["SF"]
      }),
      memory({
        id: "nature",
        text: "User loves nearby beaches.",
        topic: "location",
        entities: ["San Francisco"]
      }),
      memory({
        id: "coffee",
        text: "User appreciates local coffee roasters.",
        topic: "location",
        entities: ["san francisco"]
      })
    ]);

    expect(candidate?.ids).toEqual(["move", "nature", "coffee"]);
  });

  it("uses strong normalized text overlap without treating topic equality as similarity", () => {
    const candidate = findConsolidationCandidate([
      memory({ id: "red", text: "I prefer red interface accents.", topic: "design" }),
      memory({ id: "medical", text: "I like restrained medical UI.", topic: "design" })
    ]);

    expect(candidate?.ids).toEqual(["red", "medical"]);
  });

  it("excludes unrelated same-topic memories from the recent consolidation pool", () => {
    const related = memory({
      id: "related",
      text: "User likes restrained medical UI.",
      topic: "design"
    });
    const recent = memory({
      id: "recent",
      text: "User prefers red interface accents.",
      topic: "design"
    });
    const unrelated = memory({
      id: "unrelated",
      text: "User wants a rooftop herb garden.",
      topic: "design"
    });

    expect(
      selectConsolidationPool({ memories: [related, recent, unrelated], recentMemoryIds: [recent.id] }).map(
        ({ id }) => id
      )
    ).toEqual(["related", "recent"]);
  });
});

function memory(overrides: Partial<EngramMemory> & Pick<EngramMemory, "id" | "text">): EngramMemory {
  return {
    importance: 0.75,
    region: "hippocampus",
    created_at: `2026-07-14T10:${overrides.id.length.toString().padStart(2, "0")}:00.000Z`,
    access_count: 0,
    ...overrides
  };
}
