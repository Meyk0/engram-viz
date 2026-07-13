import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTracePlayback } from "@/hooks/useTracePlayback";
import type { NormalizedTrace } from "@/lib/traces/types";

describe("useTracePlayback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("plays one trace step at a time and stops at the end", () => {
    const { result } = renderHook(() => useTracePlayback(trace));

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(600));
    expect(result.current.stepIndex).toBe(0);
    act(() => vi.advanceTimersByTime(600));
    expect(result.current.stepIndex).toBe(1);
    act(() => vi.advanceTimersByTime(600));
    expect(result.current.stepIndex).toBe(2);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.playing).toBe(false);
  });

  it("supports deterministic seek, previous, next, and restart", () => {
    const { result } = renderHook(() => useTracePlayback(trace));

    act(() => result.current.seek(1));
    expect(result.current.currentStep?.id).toBe("step-2");
    act(() => result.current.previous());
    expect(result.current.stepIndex).toBe(0);
    act(() => result.current.next());
    expect(result.current.stepIndex).toBe(1);
    act(() => result.current.restart());
    expect(result.current.stepIndex).toBe(-1);
  });

  it("scales playback delay without changing source ordering", () => {
    const { result } = renderHook(() => useTracePlayback(trace));
    act(() => result.current.setSpeed(2));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(259));
    expect(result.current.stepIndex).toBe(-1);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.stepIndex).toBe(0);
  });
});

const trace: NormalizedTrace = {
  schemaVersion: 1,
  trace: { id: "trace-1", name: "Test trace", source: { provider: "openai", format: "agents-sdk" } },
  steps: [0, 1, 2].map((index) => ({
    id: `step-${index + 1}`,
    index,
    kind: "tool" as const,
    name: `Step ${index + 1}`,
    status: "completed" as const,
    startedAt: `2026-07-13T00:00:0${index}.000Z`,
    memoryMappings: []
  }))
};
