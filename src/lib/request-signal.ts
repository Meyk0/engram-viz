export type RequestDeadline = {
  abort: (reason?: unknown) => void;
  dispose: () => void;
  signal: AbortSignal;
};

export function createRequestDeadline(
  parent: AbortSignal,
  timeoutMs: number
): RequestDeadline {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Request deadline must be a positive number of milliseconds.");
  }

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent.reason ?? new DOMException("Request aborted.", "AbortError"));
  if (parent.aborted) abortFromParent();
  else parent.addEventListener("abort", abortFromParent, { once: true });

  const timeout = setTimeout(() => {
    controller.abort(new DOMException("Request deadline exceeded.", "TimeoutError"));
  }, timeoutMs);
  timeout.unref?.();

  return {
    abort(reason) {
      controller.abort(reason ?? new DOMException("Request canceled.", "AbortError"));
    },
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parent.removeEventListener("abort", abortFromParent);
    }
  };
}
