import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestDeadline } from "@/lib/request-signal";

afterEach(() => vi.useRealTimers());

describe("createRequestDeadline", () => {
  it("propagates caller cancellation", () => {
    const parent = new AbortController();
    const deadline = createRequestDeadline(parent.signal, 10_000);

    parent.abort(new DOMException("Client left.", "AbortError"));

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toMatchObject({ name: "AbortError" });
    deadline.dispose();
  });

  it("aborts provider work when the deadline expires", () => {
    vi.useFakeTimers();
    const deadline = createRequestDeadline(new AbortController().signal, 250);

    vi.advanceTimersByTime(249);
    expect(deadline.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toMatchObject({ name: "TimeoutError" });
    deadline.dispose();
  });

  it("supports explicit stream cancellation and validates timeout input", () => {
    const deadline = createRequestDeadline(new AbortController().signal, 1_000);
    deadline.abort();
    expect(deadline.signal.aborted).toBe(true);
    expect(() => createRequestDeadline(new AbortController().signal, 0)).toThrow(RangeError);
    deadline.dispose();
  });
});
