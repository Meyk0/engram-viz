import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEventQueue } from "@/hooks/useEventQueue";
import type { EngramEvent } from "@/types";

describe("useEventQueue", () => {
  it("keeps only the latest init event", () => {
    const firstInit: EngramEvent = { type: "init", memories: [] };
    const secondInit: EngramEvent = {
      type: "init",
      memories: [
        {
          id: "mem-1",
          text: "User prefers quiet cyberpunk medical interfaces.",
          importance: 0.8,
          region: "hippocampus",
          created_at: "2026-04-29T00:00:00.000Z",
          access_count: 0
        }
      ]
    };

    const { result } = renderHook(() => useEventQueue([firstInit]));

    act(() => {
      result.current.pushEvent({ type: "retrieve", query: "style", ids: [] });
      result.current.pushEvent(secondInit);
    });

    expect(result.current.events.filter((event) => event.type === "init")).toEqual([secondInit]);
    expect(result.current.events).toHaveLength(2);
  });
});
