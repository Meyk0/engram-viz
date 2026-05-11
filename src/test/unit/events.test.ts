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

  it("accepts planner and semantic retrieval metadata", () => {
    expect(() =>
      parseEngramEvent({
        type: "plan",
        decision: {
          stage: "memory",
          operation: "ignore",
          provider: "llm",
          confidence: 0.91,
          reason: "Question should not be stored.",
          relatedMemoryIds: ["mem-blue"]
        }
      })
    ).not.toThrow();

    expect(() =>
      parseEngramEvent({
        type: "retrieve",
        query: "What color do I like?",
        ids: ["mem-blue"],
        retrieval: {
          provider: "semantic",
          reason: "OpenAI embeddings ranked stored memory traces by semantic similarity."
        }
      })
    ).not.toThrow();
  });

  it("accepts dream mode proposal events", () => {
    const proposal = {
      id: "dream-1",
      provider: "deterministic",
      status: "proposed",
      reason: "Related memories can be reviewed.",
      operations: [
        {
          id: "dream-op-1",
          type: "merge",
          sourceIds: ["mem-a", "mem-b"],
          reason: "Duplicate preference memories.",
          confidence: 0.84,
          result: {
            id: "mem-temporal",
            text: "User likes indigo.",
            importance: 0.82,
            topic: "preference",
            region: "temporal",
            created_at: "2026-05-11T12:00:00.000Z",
            access_count: 0
          }
        }
      ],
      created_at: "2026-05-11T12:00:00.000Z"
    };

    expect(() => parseEngramEvent({ type: "dream_start", proposal })).not.toThrow();
    expect(() =>
      parseEngramEvent({
        type: "dream_merge",
        proposalId: proposal.id,
        operation: proposal.operations[0]
      })
    ).not.toThrow();
    expect(() => parseEngramEvent({ type: "dream_apply", proposal })).not.toThrow();
  });
});

describe("SSE encoding", () => {
  it("round-trips stream chunks through SSE text", () => {
    const text = fixtureStream.map(encodeSseChunk).join("");
    expect(decodeSseChunks(text)).toEqual(fixtureStream);
  });
});
