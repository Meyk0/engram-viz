import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMemoryStore } from "@/hooks/useMemoryStore";
import type { EngramEvent, EngramMemory } from "@/types";

describe("useMemoryStore", () => {
  it("applies updated access metadata from retrieval events", () => {
    const stored = makeMemory();
    const accessed = {
      ...stored,
      access_count: 1,
      last_accessed: "2026-07-13T12:01:00.000Z"
    };
    const events: EngramEvent[] = [
      {
        type: "retrieve",
        query: "What color do I love?",
        ids: [stored.id],
        accessed: [accessed]
      },
      { type: "store", memory: stored }
    ];

    const { result } = renderHook(() => useMemoryStore(events));

    expect(result.current).toEqual([accessed]);
  });

  it("remains compatible with retrieval events that predate access snapshots", () => {
    const stored = makeMemory();
    const events: EngramEvent[] = [
      { type: "retrieve", query: "What color do I love?", ids: [stored.id] },
      { type: "store", memory: stored }
    ];

    const { result } = renderHook(() => useMemoryStore(events));

    expect(result.current).toEqual([stored]);
  });
});

function makeMemory(): EngramMemory {
  return {
    id: "mem-indigo",
    text: "User loves indigo.",
    importance: 0.8,
    region: "hippocampus",
    created_at: "2026-07-13T12:00:00.000Z",
    access_count: 0
  };
}
