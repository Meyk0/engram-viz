export type SerializableTraceItem = {
  toJSON: (options?: { includeTracingApiKey?: boolean }) => unknown;
};

export type EngramTracingProcessorOptions = {
  endpoint: string;
  channelId: string;
  fetch?: typeof fetch;
};

export function createEngramTracingProcessor(options: EngramTracingProcessorOptions) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let pending: Promise<void> = Promise.resolve();

  function enqueue(item: SerializableTraceItem) {
    const serialized = item.toJSON({ includeTracingApiKey: false });
    if (!serialized) return Promise.resolve();
    const task = pending
      .catch(() => undefined)
      .then(async () => {
        const url = new URL(options.endpoint);
        url.searchParams.set("channel", options.channelId);
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item: serialized })
        });
        if (!response.ok) throw new Error(`Engram recorder rejected a trace item (${response.status}).`);
      });
    pending = task;
    return task;
  }

  return {
    onTraceStart: enqueue,
    onTraceEnd: enqueue,
    onSpanStart: enqueue,
    onSpanEnd: enqueue,
    forceFlush: async () => pending,
    shutdown: async () => pending,
    start: () => undefined
  };
}
