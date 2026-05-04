import { describe, expect, it } from "vitest";
import { getCurrentEventNarrative } from "@/lib/eventNarrative";
import type { EngramEvent } from "@/types";

describe("event narrative", () => {
  it("explains empty state in plain English", () => {
    expect(getCurrentEventNarrative([])).toEqual({
      title: "Try a memory",
      body: "Tell Engram one durable fact, then ask a related question."
    });
  });

  it("turns store events into a hippocampus sentence", () => {
    const event: EngramEvent = {
      type: "store",
      memory: {
        id: "mem-red",
        text: "I love red",
        importance: 0.78,
        topic: "preference",
        region: "hippocampus",
        created_at: "2026-04-30T00:00:00.000Z",
        access_count: 0
      }
    };

    expect(getCurrentEventNarrative([event])).toMatchObject({
      title: "Stored new memory",
      body: "Saved as a new memory in the hippocampus.",
      region: "hippocampus"
    });
  });

  it("keeps skipped memory decisions user-facing", () => {
    expect(
      getCurrentEventNarrative([
        {
          type: "plan",
          decision: {
            stage: "memory",
            operation: "ignore",
            provider: "llm",
            confidence: 0.93,
            reason: "This is a question, not a durable fact.",
            relatedMemoryIds: []
          }
        }
      ])
    ).toMatchObject({
      title: "No new memory",
      body: "Nothing new needed to be stored for this turn."
    });
  });

  it("explains retrieved question turns without exposing planner internals", () => {
    expect(
      getCurrentEventNarrative([
        {
          type: "plan",
          decision: {
            stage: "memory",
            operation: "ignore",
            provider: "llm",
            confidence: 0.93,
            reason: "This is a question, not a durable fact.",
            relatedMemoryIds: ["indigo"]
          }
        }
      ])
    ).toMatchObject({
      title: "Used memory",
      body: "1 memory helped answer. Nothing new was stored for this question."
    });
  });

  it("uses plural grammar for active context firing", () => {
    expect(
      getCurrentEventNarrative([{ type: "fire", region: "prefrontal", ids: ["mem-a"] }])
    ).toMatchObject({
      body: "1 memory is active in working memory."
    });

    expect(
      getCurrentEventNarrative([{ type: "fire", region: "prefrontal", ids: ["mem-a", "mem-b", "mem-c"] }])
    ).toMatchObject({
      body: "3 memories are active in working memory."
    });
  });
});
