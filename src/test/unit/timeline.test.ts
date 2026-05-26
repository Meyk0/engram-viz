import { describe, expect, it } from "vitest";
import {
  appendTimelineEvent,
  buildDreamTimelineEvents,
  buildTimelineSteps,
  createConversationTimelineEntry,
  createDreamTimelineEntry,
  getTimelineFocus,
  type MemoryTimelineEntry
} from "@/lib/timeline";
import type { DreamProposal, EngramEvent, EngramMemory } from "@/types";

describe("memory timeline", () => {
  it("groups store-only turn events without working-memory use", () => {
    const memory = makeMemory();
    const entry = withEvents(createTurn(), [
      { type: "init", memories: [] },
      { type: "store", memory },
      { type: "fire", region: "hippocampus", ids: [memory.id] }
    ]);

    const steps = buildTimelineSteps(entry);

    expect(steps.map((step) => step.label)).toEqual(["Stored new memory", "hippocampus lit up"]);
    expect(steps.some((step) => step.label === "Used in answer")).toBe(false);
    expect(getTimelineFocus(entry)).toEqual({
      memoryIds: [memory.id],
      regions: ["hippocampus"]
    });
  });

  it("shows retrieve, load, and answer-use steps for memory questions", () => {
    const entry = withEvents(createTurn({ userText: "What color do I love?" }), [
      { type: "retrieve", query: "What color do I love?", ids: ["mem-indigo"] },
      { type: "load", ids: ["mem-indigo"] },
      { type: "fire", region: "prefrontal", ids: ["mem-indigo"] },
      {
        type: "plan",
        decision: {
          stage: "memory",
          operation: "ignore",
          provider: "llm",
          confidence: 0.92,
          reason: "memory-question",
          relatedMemoryIds: ["mem-indigo"]
        }
      }
    ]);

    expect(buildTimelineSteps(entry).map((step) => step.label)).toEqual([
      "Found relevant memory",
      "Loaded working memory",
      "Used in answer",
      "Answered from memory"
    ]);
    expect(getTimelineFocus(entry)).toEqual({
      memoryIds: ["mem-indigo"],
      regions: ["prefrontal"]
    });
  });

  it("marks correction turns as memory updates and focuses old plus current facts", () => {
    const entry = withEvents(createTurn({ userText: "Actually, I moved to Oakland now." }), [
      {
        type: "store",
        memory: {
          ...makeMemory(),
          id: "mem-oakland",
          text: "User lives in Oakland.",
          supersedes: ["mem-sf"]
        }
      }
    ]);

    const steps = buildTimelineSteps(entry);

    expect(steps[0]).toMatchObject({
      label: "Updated memory",
      memoryIds: ["mem-oakland", "mem-sf"]
    });
  });

  it("creates a system timeline entry for Dream Mode events", () => {
    const proposal = makeDreamProposal();
    const events = buildDreamTimelineEvents(proposal);
    const entry = createDreamTimelineEntry({
      events,
      proposal,
      startedAt: "2026-05-26T00:00:00.000Z"
    });

    expect(entry.kind).toBe("dream");
    expect(buildTimelineSteps(entry).map((step) => step.label)).toContain("Dream ready");
    expect(getTimelineFocus(entry)).toEqual({
      memoryIds: ["mem-a", "mem-b", "mem-semantic"],
      regions: ["hippocampus", "temporal"]
    });
  });

  it("keeps timeline entries independent from the capped visual event queue", () => {
    const entries = Array.from({ length: 60 }, (_, index) =>
      createTurn({ id: `turn-${index}`, userText: `Turn ${index}` })
    );

    expect(entries).toHaveLength(60);
  });
});

function createTurn(input: Partial<MemoryTimelineEntry> = {}): MemoryTimelineEntry {
  return createConversationTimelineEntry({
    id: input.id ?? "turn-1",
    startedAt: input.startedAt ?? "2026-05-26T00:00:00.000Z",
    userText: input.userText ?? "I love the color indigo."
  });
}

function withEvents(entry: MemoryTimelineEntry, events: EngramEvent[]): MemoryTimelineEntry {
  return events.reduce((current, event) => appendTimelineEvent([current], current.id, event)[0], entry);
}

function makeMemory(): EngramMemory {
  return {
    id: "mem-indigo",
    text: "User loves indigo.",
    importance: 0.84,
    topic: "personal preference",
    region: "hippocampus",
    created_at: "2026-05-26T00:00:00.000Z",
    access_count: 0
  };
}

function makeDreamProposal(): DreamProposal {
  return {
    id: "dream-1",
    provider: "deterministic",
    status: "proposed",
    reason: "Two memories describe a stable preference.",
    created_at: "2026-05-26T00:00:00.000Z",
    operations: [
      {
        id: "dream-op-1",
        type: "merge",
        sourceIds: ["mem-a", "mem-b"],
        reason: "Both memories are related.",
        confidence: 0.9,
        result: {
          ...makeMemory(),
          id: "mem-semantic",
          region: "temporal",
          sourceMemoryIds: ["mem-a", "mem-b"],
          text: "User consistently likes indigo."
        }
      }
    ]
  };
}
