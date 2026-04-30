import { describe, expect, it } from "vitest";
import {
  buildMemoryExplanations,
  explainEvent,
  getMatchedWords,
  regionExplanations
} from "@/lib/explanations";
import { fixtureEvents, fixtureMemories } from "@/lib/events/fixtures";

describe("explanations", () => {
  it("defines only the three honest animated memory regions", () => {
    expect(Object.keys(regionExplanations).sort()).toEqual([
      "hippocampus",
      "prefrontal",
      "temporal"
    ]);
  });

  it("provides inline copy for every fixture event", () => {
    fixtureEvents.forEach((event) => {
      expect(explainEvent(event).length).toBeGreaterThan(10);
    });
  });

  it("extracts deterministic matched words from query and memory metadata", () => {
    expect(
      getMatchedWords("What should Engram remember about memory interfaces?", {
        text: "User is a designer exploring AI memory interfaces",
        topic: "user-profile"
      })
    ).toEqual(["interface", "memory"]);
  });

  it("builds retrieval explanations from events and memory-derived state", () => {
    const explanations = buildMemoryExplanations(
      [
        { type: "retrieve", query: "visual clarity user", ids: ["mem-user-product-context"] },
        fixtureEvents[4],
        fixtureEvents[0]
      ],
      [
        ...fixtureMemories,
        {
          id: "mem-user-product-context",
          text: "User cares about visual clarity and credible AI memory metaphors",
          importance: 0.88,
          topic: "product-direction",
          region: "temporal",
          created_at: "2026-04-29T17:01:00.000Z",
          access_count: 1
        }
      ]
    );

    expect(explanations).toEqual([
      expect.objectContaining({
        id: "mem-user-product-context",
        matchedWords: ["clarity", "visual"],
        region: "temporal",
        regionLabel: "Temporal Cortex",
        accessCount: 1,
        importance: 0.88,
        sourceEvent: "retrieve",
        sourceQuery: "visual clarity user"
      })
    ]);
  });

  it("uses the nearest retrieval query to explain fired memories", () => {
    const explanations = buildMemoryExplanations(
      [
        { type: "fire", region: "prefrontal", ids: ["mem-user-designer"] },
        { type: "retrieve", query: "designer memory", ids: ["mem-user-designer"] },
        fixtureEvents[0]
      ],
      fixtureMemories
    );

    expect(explanations[0]).toEqual(
      expect.objectContaining({
        id: "mem-user-designer",
        matchedWords: ["designer", "memory"],
        sourceEvent: "fire",
        sourceQuery: "designer memory"
      })
    );
  });
});
