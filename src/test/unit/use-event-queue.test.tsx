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
    expect(result.current.eventHistory).toHaveLength(2);
  });

  it("keeps complete session history while capping animation events", () => {
    const { result } = renderHook(() => useEventQueue());

    act(() => {
      for (let index = 0; index < 60; index += 1) {
        result.current.pushEvent({ type: "retrieve", query: `query-${index}`, ids: [] });
      }
    });

    expect(result.current.events).toHaveLength(50);
    expect(result.current.eventHistory).toHaveLength(60);
    expect(result.current.eventHistory.at(-1)).toMatchObject({ query: "query-0" });
  });
});
