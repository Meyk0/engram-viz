import { describe, expect, it } from "vitest";
import { fixtureStream } from "@/lib/events/fixtures";
import { parseEngramEvent, parseStreamChunk } from "@/lib/events/schema";
import { decodeSseChunks, encodeSseChunk } from "@/lib/events/sse";

describe("event schema", () => {
  it("accepts all deterministic fixture stream chunks", () => {
    fixtureStream.forEach((chunk) => {
      expect(() => parseStreamChunk(chunk)).not.toThrow();
    });
  });

  it("rejects memories with out-of-range importance", () => {
    expect(() =>
      parseEngramEvent({
        type: "store",
        memory: {
          id: "bad",
          text: "bad memory",
          importance: 2,
          region: "hippocampus",
          created_at: "2026-04-29T17:00:00.000Z",
          access_count: 0
        }
      })
    ).toThrow();
  });
});

describe("SSE encoding", () => {
  it("round-trips stream chunks through SSE text", () => {
    const text = fixtureStream.map(encodeSseChunk).join("");
    expect(decodeSseChunks(text)).toEqual(fixtureStream);
  });
});
