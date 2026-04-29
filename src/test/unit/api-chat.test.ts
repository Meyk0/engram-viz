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
    const fireChunk = chunks.find((chunk) => chunk.kind === "event" && chunk.event.type === "fire");

    expect(retrieveChunk?.kind).toBe("event");
    if (retrieveChunk?.kind === "event" && retrieveChunk.event.type === "retrieve") {
      expect(retrieveChunk.event.ids.length).toBeGreaterThan(0);
    }
    expect(fireChunk?.kind).toBe("event");
  });
});
