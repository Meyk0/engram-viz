import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveTraceRecorder } from "@/hooks/useLiveTraceRecorder";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useLiveTraceRecorder", () => {
  it("opens an SSE channel and publishes validated snapshots", async () => {
    const onSnapshot = vi.fn();
    vi.stubGlobal("EventSource", FakeEventSource);
    const { result } = renderHook(() => useLiveTraceRecorder(onSnapshot));

    act(() => result.current.connect());
    expect(result.current.status).toBe("connecting");
    expect(result.current.channelId).toMatch(/^live-/);

    act(() => FakeEventSource.current?.open());
    expect(result.current.status).toBe("listening");
    act(() => FakeEventSource.current?.emit("trace", JSON.stringify(snapshot)));

    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(result.current.itemCount).toBe(1);
    expect(onSnapshot).toHaveBeenCalledWith(snapshot);

    act(() => result.current.disconnect());
    expect(result.current.status).toBe("idle");
    expect(FakeEventSource.current?.closed).toBe(true);
  });
});

class FakeEventSource {
  static current?: FakeEventSource;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, (event: MessageEvent<string>) => void>();

  constructor(public url: string) {
    FakeEventSource.current = this;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener as (event: MessageEvent<string>) => void);
  }

  open() {
    this.onopen?.();
  }

  emit(type: string, data: string) {
    this.listeners.get(type)?.({ data } as MessageEvent<string>);
  }

  close() {
    this.closed = true;
  }
}

const snapshot = {
  channelId: "live-test-channel",
  receivedAt: "2026-07-13T12:00:00.000Z",
  itemCount: 1,
  trace: {
    schemaVersion: 1 as const,
    trace: {
      id: "trace-live-hook",
      name: "Live hook trace",
      source: { provider: "openai", format: "agents-sdk-export" }
    },
    steps: []
  },
  warnings: []
};
