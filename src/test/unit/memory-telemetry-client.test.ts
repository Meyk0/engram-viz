import { describe, expect, it, vi } from "vitest";
import {
  createMemoryTelemetryClient,
  MemoryTelemetryBufferOverflowError,
  MemoryTelemetryClientClosedError,
  MemoryTelemetryDeliveryError,
  MissingMemoryTelemetryEventIdError,
  type MemoryTelemetryDeliveryFailure,
  type MemoryTelemetryEventInput,
  type MemoryTelemetryScheduler
} from "@/lib/telemetry/client";
import type { MemoryTelemetryEvent } from "@/lib/telemetry/types";

const timestamp = "2026-07-14T18:00:00.000Z";

function event(
  sequence: number,
  overrides: Partial<MemoryTelemetryEvent> = {}
): MemoryTelemetryEvent {
  return {
    schemaVersion: 2,
    eventId: `event-${sequence}`,
    traceId: "trace-client",
    timestamp,
    sequence,
    operation: "store",
    memory: {
      id: `memory-${sequence}`,
      content: `Memory ${sequence}`,
      tier: "episodic",
      scope: "user"
    },
    evidence: { level: "observed", adapter: "unit-test" },
    ...overrides
  };
}

function withoutEventId(sequence: number): MemoryTelemetryEventInput {
  const { eventId: _eventId, ...input } = event(sequence);
  return input;
}

function noWaitClient(
  transport: (events: readonly MemoryTelemetryEvent[]) => Promise<void>,
  options: Parameters<typeof createMemoryTelemetryClient>[0] = { transport }
) {
  return createMemoryTelemetryClient({
    flushIntervalMs: 0,
    retry: { maxAttempts: 1 },
    ...options,
    transport
  });
}

describe("MemoryTelemetryClient", () => {
  it("validates v2 envelopes before buffering or delivery", async () => {
    const transport = vi.fn(async () => undefined);
    const client = noWaitClient(transport);
    const invalid = event(0, { operation: "retrieve", retrieval: undefined });

    await expect(client.emit(invalid)).rejects.toThrow(/retrieval evidence/i);
    expect(client.bufferedEventCount).toBe(0);
    expect(transport).not.toHaveBeenCalled();
    await client.close();
  });

  it("requires an explicit id factory for envelopes without event ids", async () => {
    const transport = vi.fn(async () => undefined);
    const client = noWaitClient(transport);

    await expect(client.emit(withoutEventId(0))).rejects.toBeInstanceOf(
      MissingMemoryTelemetryEventIdError
    );
    expect(client.bufferedEventCount).toBe(0);
    await client.close();
  });

  it("uses an explicit deterministic factory without replacing supplied ids", async () => {
    const delivered: MemoryTelemetryEvent[] = [];
    const eventIdFactory = vi.fn((input: { traceId: string; sequence: number; operation: string }) =>
      `${input.traceId}:${input.sequence}:${input.operation}`
    );
    const client = noWaitClient(async (batch) => {
      delivered.push(...batch);
    }, { transport: async () => undefined, eventIdFactory });

    const generated = await client.emit(withoutEventId(2));
    const supplied = await client.emit(event(3));
    await client.flush();

    expect(generated.eventId).toBe("trace-client:2:store");
    expect(supplied.eventId).toBe("event-3");
    expect(eventIdFactory).toHaveBeenCalledTimes(1);
    expect(delivered.map(({ eventId }) => eventId)).toEqual([
      "trace-client:2:store",
      "event-3"
    ]);
    await client.close();
  });

  it("batches by size and preserves event order across batches", async () => {
    const batches: string[][] = [];
    const client = noWaitClient(async (batch) => {
      batches.push(batch.map(({ eventId }) => eventId));
    }, { transport: async () => undefined, maxBatchSize: 2 });

    await client.emit(event(0));
    await client.emit(event(1));
    await client.emit(event(2));
    await client.close();

    expect(batches).toEqual([["event-0", "event-1"], ["event-2"]]);
    expect(client.bufferedEventCount).toBe(0);
  });

  it("serializes overlapping flushes without concurrent transport calls", async () => {
    let releaseFirst: (() => void) | undefined;
    let activeTransports = 0;
    let maxActiveTransports = 0;
    const delivered: string[] = [];
    const client = noWaitClient(async (batch) => {
      activeTransports += 1;
      maxActiveTransports = Math.max(maxActiveTransports, activeTransports);

      if (batch[0].eventId === "event-0") {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }

      delivered.push(...batch.map(({ eventId }) => eventId));
      activeTransports -= 1;
    }, { transport: async () => undefined, maxBatchSize: 1 });

    const firstEmit = client.emit(event(0));
    await vi.waitFor(() => expect(releaseFirst).toBeTypeOf("function"));
    const secondEmit = client.emit(event(1));

    releaseFirst?.();
    await Promise.all([firstEmit, secondEmit]);

    expect(maxActiveTransports).toBe(1);
    expect(delivered).toEqual(["event-0", "event-1"]);
    await client.close();
  });

  it("uses the injected scheduler and cancels pending timers on close", async () => {
    let scheduled: (() => void) | undefined;
    const clearTimeout = vi.fn(() => {
      scheduled = undefined;
    });
    const scheduler: MemoryTelemetryScheduler = {
      setTimeout: vi.fn((callback) => {
        scheduled = callback;
        return "timer-1";
      }),
      clearTimeout
    };
    const transport = vi.fn(async () => undefined);
    const client = createMemoryTelemetryClient({
      transport,
      flushIntervalMs: 50,
      scheduler,
      retry: { maxAttempts: 1 }
    });

    await client.emit(event(0));
    expect(scheduler.setTimeout).toHaveBeenCalledWith(expect.any(Function), 50);

    await client.close();
    expect(clearTimeout).toHaveBeenCalledWith("timer-1");
    expect(scheduled).toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("flushes from the injected interval scheduler without leaving another timer", async () => {
    let scheduled: (() => void) | undefined;
    const scheduler: MemoryTelemetryScheduler = {
      setTimeout(callback) {
        scheduled = callback;
        return "timer-1";
      },
      clearTimeout() {
        scheduled = undefined;
      }
    };
    const delivered: string[] = [];
    const client = createMemoryTelemetryClient({
      transport: async (batch) => {
        delivered.push(...batch.map(({ eventId }) => eventId));
      },
      flushIntervalMs: 25,
      scheduler,
      retry: { maxAttempts: 1 }
    });

    await client.emit(event(0));
    const callback = scheduled;
    expect(callback).toBeTypeOf("function");
    scheduled = undefined;
    callback?.();
    await client.flush();

    expect(delivered).toEqual(["event-0"]);
    expect(scheduled).toBeUndefined();
    await client.close();
  });

  it("rejects overflow instead of dropping accepted buffered events", async () => {
    const delivered: string[] = [];
    const client = noWaitClient(async (batch) => {
      delivered.push(...batch.map(({ eventId }) => eventId));
    }, {
      transport: async () => undefined,
      maxBatchSize: 10,
      maxBufferedEvents: 2
    });

    await client.emit(event(0));
    await client.emit(event(1));
    await expect(client.emit(event(2))).rejects.toBeInstanceOf(
      MemoryTelemetryBufferOverflowError
    );

    expect(client.getBufferedEvents().map(({ eventId }) => eventId)).toEqual([
      "event-0",
      "event-1"
    ]);
    await client.close();
    expect(delivered).toEqual(["event-0", "event-1"]);
  });

  it("retries the exact batch with bounded exponential delays", async () => {
    const attempts: (readonly MemoryTelemetryEvent[])[] = [];
    const delays: number[] = [];
    const client = createMemoryTelemetryClient({
      transport: async (batch) => {
        attempts.push(batch);
        if (attempts.length < 4) {
          throw new Error(`temporary-${attempts.length}`);
        }
      },
      flushIntervalMs: 0,
      retry: {
        maxAttempts: 4,
        initialDelayMs: 5,
        maxDelayMs: 10,
        multiplier: 3
      },
      delay: async (delayMs) => {
        delays.push(delayMs);
      }
    });

    await client.emit(event(0));
    await client.emit(event(1));
    await client.flush();

    expect(delays).toEqual([5, 10, 10]);
    expect(attempts).toHaveLength(4);
    expect(attempts.every((batch) => batch === attempts[0])).toBe(true);
    expect(attempts[0].map(({ eventId }) => eventId)).toEqual(["event-0", "event-1"]);
    await client.close();
  });

  it("reports terminal failures, retains data, and delivers it before newer events", async () => {
    const reports: MemoryTelemetryDeliveryFailure[] = [];
    const deliveryOrder: string[][] = [];
    let fail = true;
    const client = createMemoryTelemetryClient({
      transport: async (batch) => {
        if (fail) {
          throw new Error("offline");
        }
        deliveryOrder.push(batch.map(({ eventId }) => eventId));
      },
      flushIntervalMs: 0,
      maxBatchSize: 10,
      retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
      delay: async () => undefined,
      onDeliveryFailure: (failure) => reports.push(failure)
    });

    await client.emit(event(0));
    await expect(client.flush()).rejects.toBeInstanceOf(MemoryTelemetryDeliveryError);

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ attempts: 2, bufferedEventCount: 1 });
    expect(client.lastDeliveryFailure).toBe(reports[0]);
    expect(client.getBufferedEvents().map(({ eventId }) => eventId)).toEqual(["event-0"]);

    await client.emit(event(1));
    fail = false;
    await client.flush();

    expect(deliveryOrder).toEqual([["event-0", "event-1"]]);
    expect(client.lastDeliveryFailure).toBeUndefined();
    await client.close();
  });

  it("closes by flushing and rejects events accepted after close", async () => {
    const transport = vi.fn(async () => undefined);
    const client = noWaitClient(transport);

    await client.emit(event(0));
    await client.close();

    expect(client.isClosed).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(client.emit(event(1))).rejects.toBeInstanceOf(
      MemoryTelemetryClientClosedError
    );
  });

  it("rejects invalid batching and retry configuration at construction", () => {
    const transport = async () => undefined;

    expect(() => createMemoryTelemetryClient({ transport, maxBatchSize: 0 })).toThrow(
      /maxBatchSize/
    );
    expect(() => createMemoryTelemetryClient({
      transport,
      retry: { initialDelayMs: 20, maxDelayMs: 10 }
    })).toThrow(/maxDelayMs/);
  });
});
