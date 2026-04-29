import { describe, expect, it } from "vitest";
import { explainEvent, firstTimeCaptions, regionExplanations } from "@/lib/explanations";
import { fixtureEvents } from "@/lib/events/fixtures";

describe("explanations", () => {
  it("covers the teaching captions required by the spec", () => {
    expect(firstTimeCaptions.store).toContain("episodic memory");
    expect(firstTimeCaptions.retrieve).toContain("retrieval");
    expect(firstTimeCaptions.consolidate).toContain("consolidation");
    expect(firstTimeCaptions.decay).toContain("drop in retrieval ranking");
  });

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
});
