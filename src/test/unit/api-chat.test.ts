import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/chat/route";
import { decodeSseChunks } from "@/lib/events/sse";

describe("/api/chat", () => {
  it("returns deterministic SSE chunks in demo mode", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: "remember that I like luminous interfaces" })
      })
    );

    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await response.text();
    const chunks = decodeSseChunks(text);

    expect(chunks[0].kind).toBe("event");
    expect(chunks.at(-1)).toEqual({ kind: "done" });
  });
});
