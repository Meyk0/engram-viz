import { describe, expect, it } from "vitest";
import {
  executePublicDemoReplay,
  PUBLIC_DEMO_REPLAY_CAVEAT
} from "@/lib/lab/demo-replay";
import {
  createPublicDemoStory,
  PUBLIC_DEMO_STEP_NAMES
} from "@/lib/lab/demo-story";

describe("public guided demo fixture", () => {
  it("derives exactly five honest frames from the stale-location incident", () => {
    const story = createPublicDemoStory();

    expect(story.frames.map((frame) => frame.name)).toEqual([
      "Store",
      "Correct",
      "Fail",
      "Repair",
      "Test"
    ]);
    expect(PUBLIC_DEMO_STEP_NAMES).toHaveLength(5);
    expect(story.frames[0]?.focusedRegions).toEqual(["hippocampus"]);
    expect(story.frames[2]).toMatchObject({
      loadedMemoryIds: ["sample-memory-san-francisco"],
      retrievedMemoryIds: ["sample-memory-san-francisco"],
      evidence: "You live in San Francisco."
    });
    expect(story.frames[3]).toMatchObject({
      loadedMemoryIds: ["sample-memory-oakland"],
      retrievedMemoryIds: ["sample-memory-oakland"]
    });
    expect(story.frames[4]?.focusedRegions).toEqual(["prefrontal"]);
  });

  it("replays the controlled branch deterministically without mutating its request", async () => {
    const story = createPublicDemoStory();
    const request = {
      record: story.incident.record,
      branch: story.branch,
      branchContextMemories: story.branchContextMemories
    };
    const before = structuredClone(request);

    const first = await executePublicDemoReplay(request);
    const second = await executePublicDemoReplay(request);

    expect(first).toEqual(second);
    expect(request).toEqual(before);
    expect(first).toMatchObject({
      evidence: "replayed",
      baselineMemoryIds: ["sample-memory-san-francisco"],
      branchMemoryIds: ["sample-memory-oakland"],
      baselineAnswer: "You live in San Francisco.",
      branchAnswer: "You live in Oakland.",
      changed: true,
      provider: { id: "demo" }
    });
    expect(first.comparison.normalizedTextDistance).toBeGreaterThan(0);
    expect(first.caveat).toBe(PUBLIC_DEMO_REPLAY_CAVEAT);
    expect(first.caveat).toMatch(/No model.*API call/i);
  });

  it("rejects records outside the bundled fixture boundary", async () => {
    const story = createPublicDemoStory();

    await expect(executePublicDemoReplay({
      record: { ...story.incident.record, sessionId: "another-session" },
      branch: story.branch,
      branchContextMemories: story.branchContextMemories
    })).rejects.toThrow(/only accepts the bundled stale-location fixture/i);
  });

  it("rejects a branch that does not apply the recorded supersession", async () => {
    const story = createPublicDemoStory();

    await expect(executePublicDemoReplay({
      record: story.incident.record,
      branch: { ...story.branch, mutations: [] },
      branchContextMemories: story.branchContextMemories
    })).rejects.toThrow(/must include the recorded Oakland correction/i);
  });
});
