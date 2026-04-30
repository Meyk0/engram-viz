import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/chat/route";
import { decodeSseChunks } from "@/lib/events/sse";
import { resetLiveMemoryStore } from "@/lib/chat/live";

describe("/api/chat", () => {
  it("returns live memory SSE chunks in demo mode", async () => {
    resetLiveMemoryStore();

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-a",
          message: "remember that I like luminous interfaces"
        })
      })
    );

    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await response.text();
    const chunks = decodeSseChunks(text);

    expect(chunks[0]).toEqual({ kind: "event", event: { type: "init", memories: [] } });
    expect(chunks.some((chunk) => chunk.kind === "event" && chunk.event.type === "retrieve")).toBe(true);
    expect(chunks.some((chunk) => chunk.kind === "event" && chunk.event.type === "store")).toBe(true);
    expect(chunks.at(-1)).toEqual({ kind: "done" });
    expect(chunks.slice(0, -1).some((chunk) => chunk.kind === "done")).toBe(false);
  });

  it("retrieves memories stored by prior turns in the same session", async () => {
    resetLiveMemoryStore();

    await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-b",
          message: "remember that I prefer restrained medical cyberpunk design"
        })
      })
    );

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-b",
          message: "what design style do I prefer?"
        })
      })
    );
    const chunks = decodeSseChunks(await response.text());
    const retrieveChunk = chunks.find(
      (chunk) => chunk.kind === "event" && chunk.event.type === "retrieve"
    );
    const loadChunk = chunks.find((chunk) => chunk.kind === "event" && chunk.event.type === "load");
    const fireChunk = chunks.find((chunk) => chunk.kind === "event" && chunk.event.type === "fire");

    expect(retrieveChunk?.kind).toBe("event");
    if (retrieveChunk?.kind === "event" && retrieveChunk.event.type === "retrieve") {
      expect(retrieveChunk.event.ids.length).toBeGreaterThan(0);
    }
    expect(loadChunk?.kind).toBe("event");
    expect(fireChunk?.kind).toBe("event");
  });

  it("loads retrieved memories into active context before firing prefrontal", async () => {
    resetLiveMemoryStore();

    await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-load",
          message: "remember that I love red"
        })
      })
    );

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-load",
          message: "what color do I love?"
        })
      })
    );
    const chunks = decodeSseChunks(await response.text());
    const eventTypes = chunks
      .filter((chunk) => chunk.kind === "event")
      .map((chunk) => (chunk.kind === "event" ? chunk.event.type : "none"));

    expect(eventTypes.indexOf("retrieve")).toBeLessThan(eventTypes.indexOf("load"));
    expect(eventTypes.indexOf("load")).toBeLessThan(eventTypes.indexOf("fire"));
  });

  it("does not load active context for unrelated standalone preference stores", async () => {
    resetLiveMemoryStore();

    await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-unrelated-store",
          message: "I like the color blue"
        })
      })
    );

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-unrelated-store",
          message: "I like the ocean"
        })
      })
    );
    const chunks = decodeSseChunks(await response.text());
    const events = chunks
      .filter((chunk) => chunk.kind === "event")
      .map((chunk) => (chunk.kind === "event" ? chunk.event : null))
      .filter((event): event is NonNullable<typeof event> => Boolean(event));
    const eventTypes = events.map((event) => event.type);

    expect(eventTypes).toContain("store");
    expect(eventTypes).not.toContain("load");
    expect(events.some((event) => event.type === "fire" && event.region === "prefrontal")).toBe(false);
  });

  it("does not store trivial questions but still streams a response and done", async () => {
    resetLiveMemoryStore();

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-c",
          message: "What is this app?"
        })
      })
    );

    const chunks = decodeSseChunks(await response.text());

    expect(chunks.some((chunk) => chunk.kind === "text" && chunk.delta.length > 0)).toBe(true);
    expect(chunks.some((chunk) => chunk.kind === "event" && chunk.event.type === "store")).toBe(
      false
    );
    expect(chunks.at(-1)).toEqual({ kind: "done" });
  });

  it("consolidates repeated same-topic hippocampus memories into temporal memory", async () => {
    resetLiveMemoryStore();

    await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-d",
          message: "remember that I prefer quiet cyberpunk medical interfaces"
        })
      })
    );

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          sessionId: "api-chat-d",
          message: "remember that I like restrained interface design"
        })
      })
    );

    const chunks = decodeSseChunks(await response.text());
    const consolidateChunk = chunks.find(
      (chunk) => chunk.kind === "event" && chunk.event.type === "consolidate"
    );

    expect(consolidateChunk?.kind).toBe("event");
    if (consolidateChunk?.kind !== "event" || consolidateChunk.event.type !== "consolidate") {
      throw new Error("expected consolidate event");
    }
    expect(consolidateChunk.event.removed).toHaveLength(2);
    expect(consolidateChunk.event.added.region).toBe("temporal");
    expect(consolidateChunk.event.added.text).toContain("recurring design memories");
  });
});
