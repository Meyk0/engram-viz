import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGuidedDemoPlayback } from "@/hooks/useGuidedDemoPlayback";

const prompts = ["First memory.", "Recall it.", "Correct it."] as const;

describe("useGuidedDemoPlayback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts with stable controls and waits 1100ms before staging the first line", () => {
    const sendTurn = vi.fn(async () => undefined);
    const { result } = renderPlayback({ sendTurn });
    const initialStart = result.current.start;
    const initialStop = result.current.stop;

    act(() => result.current.start());
    expect(result.current.active).toBe(true);
    expect(result.current.stagedPrompt).toBeNull();

    act(() => vi.advanceTimersByTime(1_099));
    expect(result.current.message).toBe("");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.message).toBe("First memory.");
    expect(result.current.stagedPrompt).toBe("First memory.");

    expect(result.current.start).toBe(initialStart);
    expect(result.current.stop).toBe(initialStop);
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it("holds a staged line for 3000ms before sending it", () => {
    const sendTurn = vi.fn(async () => undefined);
    const { result } = renderPlayback({ sendTurn });

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(1_100));
    act(() => vi.advanceTimersByTime(2_999));
    expect(sendTurn).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(sendTurn).toHaveBeenCalledTimes(1);
    expect(sendTurn).toHaveBeenCalledWith("First memory.");
    expect(result.current.stagedPrompt).toBeNull();
  });

  it("uses the 4200ms inter-turn hold and never sends while work is in flight", () => {
    const sendTurn = vi.fn(async () => undefined);
    let turnInFlight = true;
    const { result, rerender } = renderPlayback({
      conversationCount: 1,
      isTurnInFlight: () => turnInFlight,
      sendTurn
    });

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(8_000));
    expect(result.current.message).toBe("");

    turnInFlight = false;
    rerender({ count: 1, streaming: false, inFlight: () => turnInFlight });
    act(() => vi.advanceTimersByTime(4_199));
    expect(result.current.stagedPrompt).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.stagedPrompt).toBe("Recall it.");

    rerender({ count: 1, streaming: true, inFlight: () => false });
    act(() => vi.advanceTimersByTime(3_000));
    expect(sendTurn).not.toHaveBeenCalled();

    turnInFlight = true;
    rerender({ count: 1, streaming: false, inFlight: () => turnInFlight });
    act(() => vi.advanceTimersByTime(3_000));
    expect(sendTurn).not.toHaveBeenCalled();
  });

  it("stops and clears only the input that is still staged by the demo", () => {
    const { result } = renderPlayback();

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(1_100));
    act(() => result.current.stop());

    expect(result.current.active).toBe(false);
    expect(result.current.stagedPrompt).toBeNull();
    expect(result.current.message).toBe("");

    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.sendTurn).not.toHaveBeenCalled();
  });

  it("pauses when the user enters conflicting input and resumes only after it is cleared", () => {
    const { result } = renderPlayback();

    act(() => {
      result.current.setMessage("My own question");
      result.current.start();
    });
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.active).toBe(true);
    expect(result.current.stagedPrompt).toBeNull();
    expect(result.current.sendTurn).not.toHaveBeenCalled();

    act(() => result.current.setMessage(""));
    act(() => vi.advanceTimersByTime(1_100));
    expect(result.current.stagedPrompt).toBe("First memory.");

    act(() => result.current.setMessage("Edited staged line"));
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current.sendTurn).not.toHaveBeenCalled();
    expect(result.current.message).toBe("Edited staged line");
  });

  it("stops automatically when every prompt has a completed conversation", () => {
    const { result } = renderPlayback({ conversationCount: prompts.length });

    act(() => result.current.start());
    expect(result.current.active).toBe(true);
    act(() => vi.advanceTimersByTime(0));

    expect(result.current.active).toBe(false);
    expect(result.current.stagedPrompt).toBeNull();
  });

  it("does not stage or send from stale timers after unmount", () => {
    const setMessage = vi.fn();
    const sendTurn = vi.fn(async () => undefined);
    const { result, unmount } = renderHook(() =>
      useGuidedDemoPlayback({
        prompts,
        message: "",
        setMessage,
        conversationCount: 0,
        isStreaming: false,
        isTurnInFlight: () => false,
        sendTurn
      })
    );

    act(() => result.current.start());
    unmount();
    act(() => vi.advanceTimersByTime(10_000));

    expect(setMessage).not.toHaveBeenCalled();
    expect(sendTurn).not.toHaveBeenCalled();
  });
});

function renderPlayback({
  conversationCount = 0,
  isStreaming = false,
  isTurnInFlight = () => false,
  sendTurn = vi.fn(async () => undefined)
}: {
  conversationCount?: number;
  isStreaming?: boolean;
  isTurnInFlight?: () => boolean;
  sendTurn?: ReturnType<typeof vi.fn<(prompt: string) => Promise<void>>>;
} = {}) {
  return renderHook(
    ({ count, streaming, inFlight }) => {
      const [message, setMessage] = useState("");
      const playback = useGuidedDemoPlayback({
        prompts,
        message,
        setMessage,
        conversationCount: count,
        isStreaming: streaming,
        isTurnInFlight: inFlight,
        sendTurn
      });

      return { ...playback, message, setMessage, sendTurn };
    },
    { initialProps: { count: conversationCount, streaming: isStreaming, inFlight: isTurnInFlight } }
  );
}
