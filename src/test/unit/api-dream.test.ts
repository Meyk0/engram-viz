import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/dream/route";
import type { EngramMemory } from "@/types";

describe("/api/dream", () => {
  it("rejects malformed, oversized, and unbounded dream inputs", async () => {
    const malformed = await POST(new Request("http://localhost/api/dream", {
      method: "POST",
      body: "{broken"
    }));
    const oversized = await POST(new Request("http://localhost/api/dream", {
      method: "POST",
      headers: { "Content-Length": "256001" },
      body: JSON.stringify({ clientMemories: [] })
    }));
    const tooManyMemories = await POST(new Request("http://localhost/api/dream", {
      method: "POST",
      body: JSON.stringify({ clientMemories: Array.from({ length: 201 }, () => ({})) })
    }));

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(tooManyMemories.status).toBe(400);
  });

  it("returns a deterministic dream proposal for client memories", async () => {
    const memories = [
      makeMemory("mem-red-1", "User likes deep red interfaces.", "interface_style"),
      makeMemory("mem-red-2", "User prefers deep red dashboards.", "interface_style"),
      makeMemory("mem-city", "User lives in San Francisco.", "current_location")
    ];

    const response = await POST(
      new Request("http://localhost/api/dream", {
        method: "POST",
        body: JSON.stringify({
          clientMemories: memories,
          now: "2026-05-11T12:00:00.000Z"
        })
      })
    );
    const payload = (await response.json()) as { proposal: { operations: { type: string }[]; status: string } };

    expect(response.status).toBe(200);
    expect(payload.proposal.status).toBe("proposed");
    expect(payload.proposal.operations[0]?.type).toBe("merge");
    expect(memories.map((memory) => memory.status)).toEqual([undefined, undefined, undefined]);
  });

  it("skips when fewer than three active memories exist", async () => {
    const response = await POST(
      new Request("http://localhost/api/dream", {
        method: "POST",
        body: JSON.stringify({
          clientMemories: [
            makeMemory("mem-a", "User likes sushi.", "food_preference"),
            makeMemory("mem-b", "User likes omakase.", "food_preference")
          ],
          now: "2026-05-11T12:00:00.000Z"
        })
      })
    );
    const payload = (await response.json()) as { proposal: { operations: unknown[]; status: string } };

    expect(response.status).toBe(200);
    expect(payload.proposal.status).toBe("skipped");
    expect(payload.proposal.operations).toEqual([]);
  });
});

function makeMemory(id: string, text: string, cluster: string): EngramMemory {
  return {
    id,
    text,
    importance: 0.8,
    topic: cluster.replace(/_/g, " "),
    kind: "preference",
    cluster,
    region: "hippocampus",
    created_at: "2026-05-11T10:00:00.000Z",
    access_count: 0
  };
}
