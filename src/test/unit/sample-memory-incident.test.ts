import { describe, expect, it } from "vitest";
import { buildTimelineCheckpoints } from "@/lib/lab/checkpoints";
import {
  createSampleMemoryIncident,
  SAMPLE_INCIDENT_TIMELINE_ID
} from "@/lib/lab/sample-incident";

describe("sample memory incident", () => {
  it("creates a replayable wrong-answer checkpoint with complete retrieval evidence", () => {
    const incident = createSampleMemoryIncident();
    const checkpoints = buildTimelineCheckpoints(
      [incident.entry],
      { [SAMPLE_INCIDENT_TIMELINE_ID]: incident.record }
    );

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({
      label: "What city do I live in now?",
      memories: [
        { id: "sample-memory-san-francisco" },
        { id: "sample-memory-oakland" }
      ],
      loadedMemoryIds: ["sample-memory-san-francisco"],
      answer: "You live in San Francisco.",
      turnRecord: { id: "sample-turn-current-city" }
    });
    expect(checkpoints[0]?.retrieval?.matches).toEqual([
      expect.objectContaining({ id: "sample-memory-san-francisco", rank: 1, selected: true }),
      expect.objectContaining({ id: "sample-memory-oakland", rank: 2, selected: false })
    ]);
  });

  it("returns isolated copies so experiments cannot mutate the fixture", () => {
    const first = createSampleMemoryIncident();
    const second = createSampleMemoryIncident();
    first.entry.events.pop();
    first.record.retrievedMemories[0]!.text = "Mutated";

    expect(second.entry.events).toHaveLength(4);
    expect(second.record.retrievedMemories[0]?.text).toBe("User moved to San Francisco in 2022.");
  });
});
