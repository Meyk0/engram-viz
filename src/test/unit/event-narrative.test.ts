import { describe, expect, it } from "vitest";
import { getCurrentEventNarrative } from "@/lib/eventNarrative";
import type { EngramEvent } from "@/types";

describe("event narrative", () => {
  it("explains empty state in plain English", () => {
    expect(getCurrentEventNarrative([])).toEqual({
      title: "Ready for a memory",
      body: "Tell Engram a durable fact or preference, then ask about it."
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
      title: "New fact stored",
      body: "A raw memory landed in the hippocampus.",
      region: "hippocampus"
    });
  });

  it("uses plural grammar for active context firing", () => {
    expect(
      getCurrentEventNarrative([{ type: "fire", region: "prefrontal", ids: ["mem-a"] }])
    ).toMatchObject({
      body: "1 memory is being used in active context."
    });

    expect(
      getCurrentEventNarrative([{ type: "fire", region: "prefrontal", ids: ["mem-a", "mem-b", "mem-c"] }])
    ).toMatchObject({
      body: "3 memories are being used in active context."
    });
  });
});
