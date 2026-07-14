import { describe, expect, it } from "vitest";
import { DemoChatProvider } from "@/lib/chat/providers/demo";
import { createLiveMemoryStream, resetLiveMemoryStore } from "@/lib/chat/live";
import { createImmutableTurnRecord } from "@/lib/evidence/turn-record";

describe("turn evidence", () => {
  it("deep-freezes immutable turn snapshots", () => {
    const record = createImmutableTurnRecord({
      id: "turn-1",
      sessionId: "session-1",
      startedAt: "2026-07-13T00:00:00.000Z",
      completedAt: "2026-07-13T00:00:01.000Z",
      userMessage: "What color do I love?",
      history: [],
      retrievedMemories: [],
      events: [],
      originalAnswer: "Indigo.",
      provider: new DemoChatProvider()
    });

    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.history)).toBe(true);
    expect(record.provider).toEqual({ id: "demo" });
  });

  it("emits a complete record immediately before the terminal chunk", async () => {
    resetLiveMemoryStore();
    const sessionId = "turn-record-stream";
    await createLiveMemoryStream({
      sessionId,
      message: "I love the color indigo.",
      now: "2026-07-13T00:00:00.000Z"
    });

    const chunks = await createLiveMemoryStream({
      sessionId,
      message: "What color do I love?",
      now: "2026-07-13T00:01:00.000Z"
    });
    const recordChunk = chunks.find((chunk) => chunk.kind === "turn_record");

    expect(chunks.at(-1)).toEqual({ kind: "done" });
    expect(chunks.at(-2)?.kind).toBe("turn_record");
    expect(recordChunk?.kind).toBe("turn_record");
    if (recordChunk?.kind !== "turn_record") throw new Error("expected turn record");
    expect(recordChunk.record.userMessage).toBe("What color do I love?");
    expect(recordChunk.record.retrievedMemories).toHaveLength(1);
    expect(recordChunk.record.retrieval?.matches?.[0]).toMatchObject({ rank: 1, selected: true });
    expect(recordChunk.record.originalAnswer).toContain("I love the color indigo.");
    expect(recordChunk.record.events.some((event) => event.type === "fire")).toBe(true);
  });
});
