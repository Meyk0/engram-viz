import { describe, expect, it } from "vitest";
import { getActiveLifecycleStep, getMemoryLifecycleSteps } from "@/lib/memoryLifecycle";
import type { EngramEvent } from "@/types";

describe("memory lifecycle strip", () => {
  it("marks retrieval active while the response is waiting on memory", () => {
    expect(getActiveLifecycleStep([], true)).toBe("retrieve");

    expect(getMemoryLifecycleSteps([], true)).toEqual([
      expect.objectContaining({ id: "store", state: "idle" }),
      expect.objectContaining({ id: "retrieve", state: "active" }),
      expect.objectContaining({ id: "use", state: "idle" }),
      expect.objectContaining({ id: "stabilize", state: "idle" }),
      expect.objectContaining({ id: "reflect", state: "idle" })
    ]);
  });

  it("shows the durable memory lifecycle as events accumulate", () => {
    const events: EngramEvent[] = [
      { type: "load", ids: ["mem-indigo"] },
      { type: "retrieve", query: "What color do I love?", ids: ["mem-indigo"] },
      {
        type: "store",
        memory: {
          id: "mem-indigo",
          text: "User loves indigo.",
          importance: 0.86,
          topic: "preference",
          region: "hippocampus",
          created_at: "2026-05-01T00:00:00.000Z",
          access_count: 1
        }
      }
    ];

    expect(getMemoryLifecycleSteps(events)).toEqual([
      expect.objectContaining({ id: "store", state: "complete" }),
      expect.objectContaining({ id: "retrieve", state: "complete" }),
      expect.objectContaining({ id: "use", state: "active" }),
      expect.objectContaining({ id: "stabilize", state: "idle" }),
      expect.objectContaining({ id: "reflect", state: "idle" })
    ]);
  });

  it("marks consolidation as the active stabilization step", () => {
    expect(
      getMemoryLifecycleSteps([
        {
          type: "consolidate",
          removed: ["mem-a", "mem-b"],
          added: {
            id: "mem-summary",
            text: "User prefers blue hues.",
            importance: 0.82,
            topic: "preference",
            region: "temporal",
            created_at: "2026-05-01T00:00:00.000Z",
            access_count: 0
          }
        }
      ])
    ).toEqual([
      expect.objectContaining({ id: "store", state: "idle" }),
      expect.objectContaining({ id: "retrieve", state: "idle" }),
      expect.objectContaining({ id: "use", state: "idle" }),
      expect.objectContaining({ id: "stabilize", state: "active" }),
      expect.objectContaining({ id: "reflect", state: "idle" })
    ]);
  });

  it("marks dream review events as reflection", () => {
    const proposal = {
      id: "dream-1",
      provider: "deterministic" as const,
      status: "proposed" as const,
      reason: "Review related memories.",
      operations: [],
      created_at: "2026-05-02T00:00:00.000Z"
    };

    expect(getActiveLifecycleStep([{ type: "dream_complete", proposal }])).toBe("reflect");
    expect(getMemoryLifecycleSteps([{ type: "dream_complete", proposal }])).toEqual([
      expect.objectContaining({ id: "store", state: "idle" }),
      expect.objectContaining({ id: "retrieve", state: "idle" }),
      expect.objectContaining({ id: "use", state: "idle" }),
      expect.objectContaining({ id: "stabilize", state: "idle" }),
      expect.objectContaining({ id: "reflect", state: "active" })
    ]);
  });
});
