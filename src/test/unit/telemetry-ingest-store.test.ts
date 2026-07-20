import { describe, expect, it, vi } from "vitest";
import type { MemoryTelemetryEvent } from "@/lib/telemetry";
import type { TelemetryTenantContext } from "@/lib/ingest/types";
import {
  createInMemoryMemoryTelemetryStore,
  createMemoryTelemetryStoreFromEnv,
  createSupabaseMemoryTelemetryStore,
  InMemoryMemoryTelemetryStore,
  MemoryTelemetryStoreCapacityError,
  MemoryTelemetryStoreConfigurationError,
  MemoryTelemetryStoreRequestError,
  SupabaseDataApiMemoryTelemetryStore
} from "@/lib/ingest/store";

const occurredAt = "2026-07-14T18:00:00.000Z";
const receivedAt = "2026-07-14T18:00:01.000Z";

const tenantA: TelemetryTenantContext = {
  tenantId: "tenant-a",
  projectId: "project-a",
  keyId: "key-a"
};

const tenantB: TelemetryTenantContext = {
  tenantId: "tenant-b",
  projectId: "project-b",
  keyId: "key-b"
};

function event(sequence: number, overrides: Partial<MemoryTelemetryEvent> = {}): MemoryTelemetryEvent {
  return {
    schemaVersion: 2,
    eventId: `event-${sequence}`,
    traceId: "trace-ingest",
    projectId: "project-a",
    timestamp: occurredAt,
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

function storedRow(
  cursor: number,
  telemetryEvent: MemoryTelemetryEvent,
  overrides: Record<string, unknown> = {}
) {
  return {
    cursor,
    tenant_id: tenantA.tenantId,
    project_id: tenantA.projectId,
    event_id: telemetryEvent.eventId,
    sequence: telemetryEvent.sequence,
    occurred_at: telemetryEvent.timestamp,
    received_at: receivedAt,
    payload: telemetryEvent,
    ...overrides
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("InMemoryMemoryTelemetryStore", () => {
  it("preserves append order with deterministic cursors and clock values", async () => {
    const times = [
      "2026-07-14T18:00:01.000Z",
      "2026-07-14T18:00:02.000Z"
    ];
    const store = createInMemoryMemoryTelemetryStore({ now: () => times.shift() ?? receivedAt });

    const appended = await store.append(tenantA, [event(2), event(1)]);
    const read = await store.read(tenantA, { afterCursor: 0, limit: 10 });

    expect(appended).toEqual({
      acceptedEventIds: ["event-2", "event-1"],
      duplicateEventIds: [],
      highWaterCursor: 2
    });
    expect(read.events.map(({ cursor, eventId, receivedAt: received }) => ({
      cursor,
      eventId,
      receivedAt: received
    }))).toEqual([
      { cursor: 1, eventId: "event-2", receivedAt: "2026-07-14T18:00:01.000Z" },
      { cursor: 2, eventId: "event-1", receivedAt: "2026-07-14T18:00:02.000Z" }
    ]);
    expect(read.highWaterCursor).toBe(2);
  });

  it("isolates tenants and projects while supporting resumable pages", async () => {
    const store = createInMemoryMemoryTelemetryStore({ now: () => receivedAt });
    await store.append(tenantA, [event(0), event(1)]);
    await store.append(tenantB, [
      event(0, { eventId: "event-b", projectId: "project-b" })
    ]);
    await store.append(tenantA, [event(2)]);

    const firstPage = await store.read(tenantA, { afterCursor: 0, limit: 2 });
    const secondPage = await store.read(tenantA, {
      afterCursor: firstPage.highWaterCursor,
      limit: 2
    });
    const otherTenant = await store.read(tenantB, { afterCursor: 0, limit: 10 });

    expect(firstPage.events.map(({ cursor }) => cursor)).toEqual([1, 2]);
    expect(firstPage.highWaterCursor).toBe(2);
    expect(secondPage.events.map(({ cursor }) => cursor)).toEqual([4]);
    expect(secondPage.highWaterCursor).toBe(4);
    expect(otherTenant.events.map(({ cursor, eventId }) => ({ cursor, eventId }))).toEqual([
      { cursor: 3, eventId: "event-b" }
    ]);
  });

  it("is idempotent within a tenant/project without conflating other scopes", async () => {
    const store = createInMemoryMemoryTelemetryStore({ now: () => receivedAt });

    expect(await store.append(tenantA, [event(0), event(0)])).toEqual({
      acceptedEventIds: ["event-0"],
      duplicateEventIds: ["event-0"],
      highWaterCursor: 1
    });
    expect(await store.append(tenantA, [event(0)])).toEqual({
      acceptedEventIds: [],
      duplicateEventIds: ["event-0"],
      highWaterCursor: 1
    });
    expect(await store.append(tenantB, [event(0, { projectId: "project-b" })])).toEqual({
      acceptedEventIds: ["event-0"],
      duplicateEventIds: [],
      highWaterCursor: 2
    });
  });

  it("accepts same-sequence events from two turns while deduping retry delivery", async () => {
    const store = createInMemoryMemoryTelemetryStore({ now: () => receivedAt });
    const first = event(0, {
      eventId: "trace:turn-a:memory:0",
      turnId: "turn-a",
      tenantId: tenantA.tenantId
    });
    const second = event(0, {
      eventId: "trace:turn-b:memory:0",
      turnId: "turn-b",
      tenantId: tenantA.tenantId,
      memory: {
        id: "memory-turn-b",
        tier: "episodic",
        scope: "user"
      }
    });

    expect(await store.append(tenantA, [first, second, first])).toEqual({
      acceptedEventIds: [first.eventId, second.eventId],
      duplicateEventIds: [first.eventId],
      highWaterCursor: 2
    });
    expect((await store.read(tenantA, { afterCursor: 0, limit: 10 })).events.map((record) => ({
      eventId: record.eventId,
      turnId: record.event.turnId,
      sequence: record.sequence
    }))).toEqual([
      { eventId: first.eventId, turnId: "turn-a", sequence: 0 },
      { eventId: second.eventId, turnId: "turn-b", sequence: 0 }
    ]);
  });

  it("rejects telemetry that declares a different tenant", async () => {
    const store = createInMemoryMemoryTelemetryStore({ now: () => receivedAt });
    await expect(store.append(tenantA, [event(0, { tenantId: "tenant-other" })]))
      .rejects.toThrow(/different tenant/i);
  });

  it("returns deeply immutable snapshots that cannot mutate stored data", async () => {
    const original = event(0);
    const store = createInMemoryMemoryTelemetryStore({ now: () => receivedAt });
    await store.append(tenantA, [original]);
    original.memory!.content = "Changed after append";

    const first = await store.read(tenantA, { afterCursor: 0, limit: 1 });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.events)).toBe(true);
    expect(Object.isFrozen(first.events[0])).toBe(true);
    expect(Object.isFrozen(first.events[0].event.memory)).toBe(true);
    expect(() => {
      first.events[0].event.memory!.content = "Attempted mutation";
    }).toThrow(TypeError);

    const second = await store.read(tenantA, { afterCursor: 0, limit: 1 });
    expect(second.events[0].event.memory?.content).toBe("Memory 0");
  });

  it("rejects invalid events, project confusion, invalid reads, and capacity atomically", async () => {
    const store = createInMemoryMemoryTelemetryStore({
      capacity: 1,
      now: () => receivedAt
    });

    await expect(store.append(tenantA, [
      event(0, { operation: "retrieve", retrieval: undefined })
    ])).rejects.toThrow(/retrieval evidence/i);
    await expect(store.append(tenantA, [
      event(0, { projectId: "project-other" })
    ])).rejects.toBeInstanceOf(MemoryTelemetryStoreConfigurationError);
    await expect(store.read(tenantA, { afterCursor: -1, limit: 1 })).rejects.toThrow(/afterCursor/);
    await expect(store.read(tenantA, { afterCursor: 0, limit: 0 })).rejects.toThrow(/limit/);

    await expect(store.append(tenantA, [event(0), event(1)])).rejects.toBeInstanceOf(
      MemoryTelemetryStoreCapacityError
    );
    expect((await store.read(tenantA, { afterCursor: 0, limit: 10 })).events).toEqual([]);
  });
});

describe("SupabaseDataApiMemoryTelemetryStore", () => {
  it("uses conflict-ignore insertion and reports accepted and duplicate events", async () => {
    const events = [event(0), event(1), event(2), event(2)];
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse([
        storedRow(39, events[0]),
        storedRow(41, events[2])
      ]))
      .mockResolvedValueOnce(jsonResponse([{ cursor: 41 }]));
    const store = createSupabaseMemoryTelemetryStore({
      url: "https://project.supabase.co/",
      secretKey: "server-secret",
      fetch: request,
      now: () => receivedAt
    });

    const result = await store.append(tenantA, events);

    expect(result).toEqual({
      acceptedEventIds: ["event-0", "event-2"],
      duplicateEventIds: ["event-1", "event-2"],
      highWaterCursor: 41
    });
    expect(request).toHaveBeenCalledTimes(2);
    const [input, init] = request.mock.calls[0] as [URL, RequestInit];
    const url = new URL(input);
    expect(url.pathname).toBe("/rest/v1/memory_telemetry_events");
    expect(url.searchParams.get("on_conflict")).toBe("tenant_id,project_id,event_id");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("prefer")).toBe(
      "resolution=ignore-duplicates,return=representation"
    );
    expect(new Headers(init.headers).get("apikey")).toBe("server-secret");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer server-secret");
    expect(JSON.parse(String(init.body))).toEqual(events.slice(0, 3).map((telemetryEvent) => ({
      tenant_id: tenantA.tenantId,
      project_id: tenantA.projectId,
      ingest_key_id: tenantA.keyId,
      event_id: telemetryEvent.eventId,
      sequence: telemetryEvent.sequence,
      occurred_at: telemetryEvent.timestamp,
      received_at: receivedAt,
      payload: telemetryEvent
    })));

    const [highWaterInput, highWaterInit] = request.mock.calls[1] as [URL, RequestInit];
    const highWaterUrl = new URL(highWaterInput);
    expect(highWaterUrl.searchParams.get("tenant_id")).toBe("eq.tenant-a");
    expect(highWaterUrl.searchParams.get("project_id")).toBe("eq.project-a");
    expect(highWaterUrl.searchParams.get("order")).toBe("cursor.desc");
    expect(highWaterInit.method).toBe("GET");
  });

  it("reads multiple scoped pages in cursor order without skipping global gaps", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse([
        storedRow(2, event(0)),
        storedRow(5, event(1))
      ]))
      .mockResolvedValueOnce(jsonResponse([
        storedRow(8, event(2))
      ]))
      .mockResolvedValueOnce(jsonResponse([]));
    const store = createSupabaseMemoryTelemetryStore({
      url: "https://project.supabase.co",
      secretKey: "server-secret",
      fetch: request,
      pageSize: 2
    });

    const result = await store.read(tenantA, { afterCursor: 1, limit: 3 });

    expect(result.events.map(({ cursor }) => cursor)).toEqual([2, 5, 8]);
    expect(result.highWaterCursor).toBe(8);
    expect(Object.isFrozen(result.events[0].event)).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(request.mock.calls[0][0] as URL);
    const secondUrl = new URL(request.mock.calls[1][0] as URL);
    expect(firstUrl.searchParams.get("cursor")).toBe("gt.1");
    expect(firstUrl.searchParams.get("limit")).toBe("2");
    expect(secondUrl.searchParams.get("cursor")).toBe("gt.5");
    expect(secondUrl.searchParams.get("limit")).toBe("1");
    for (const call of request.mock.calls) {
      const url = new URL(call[0] as URL);
      expect(url.searchParams.get("tenant_id")).toBe("eq.tenant-a");
      expect(url.searchParams.get("project_id")).toBe("eq.project-a");
      expect(url.searchParams.get("order")).toBe("cursor.asc");
    }
  });

  it("continues paging when the Data API returns fewer rows than requested", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse([storedRow(2, event(0))]))
      .mockResolvedValueOnce(jsonResponse([storedRow(5, event(1))]))
      .mockResolvedValueOnce(jsonResponse([]));
    const store = createSupabaseMemoryTelemetryStore({
      url: "https://project.supabase.co",
      secretKey: "server-secret",
      fetch: request,
      pageSize: 10
    });

    const result = await store.read(tenantA, { afterCursor: 0, limit: 5 });

    expect(result.events.map(({ cursor }) => cursor)).toEqual([2, 5]);
    expect(result.highWaterCursor).toBe(5);
    expect(request).toHaveBeenCalledTimes(3);
    expect(new URL(request.mock.calls[1][0] as URL).searchParams.get("cursor")).toBe("gt.2");
    expect(new URL(request.mock.calls[2][0] as URL).searchParams.get("cursor")).toBe("gt.5");
  });

  it("rejects out-of-scope, malformed, non-monotonic, and failed Data API responses", async () => {
    const scopedRequest = vi.fn().mockResolvedValue(jsonResponse([
      storedRow(1, event(0), { tenant_id: "tenant-other" })
    ]));
    const scopedStore = createSupabaseMemoryTelemetryStore({
      url: "https://project.supabase.co",
      secretKey: "server-secret",
      fetch: scopedRequest
    });
    await expect(scopedStore.read(tenantA, { afterCursor: 0, limit: 1 })).rejects.toThrow(
      /outside the requested scope/
    );

    const orderRequest = vi.fn().mockResolvedValue(jsonResponse([
      storedRow(2, event(0)),
      storedRow(2, event(1))
    ]));
    const orderStore = createSupabaseMemoryTelemetryStore({
      url: "https://project.supabase.co",
      secretKey: "server-secret",
      fetch: orderRequest
    });
    await expect(orderStore.read(tenantA, { afterCursor: 0, limit: 2 })).rejects.toThrow(
      /non-monotonic/
    );

    const failedRequest = vi.fn().mockResolvedValue(jsonResponse({ message: "permission denied" }, 403));
    const failedStore = createSupabaseMemoryTelemetryStore({
      url: "https://project.supabase.co",
      secretKey: "do-not-leak-this",
      fetch: failedRequest
    });
    const failure = failedStore.read(tenantA, { afterCursor: 0, limit: 1 });
    await expect(failure).rejects.toBeInstanceOf(MemoryTelemetryStoreRequestError);
    await expect(failure).rejects.not.toThrow(/do-not-leak-this/);
  });
});

describe("createMemoryTelemetryStoreFromEnv", () => {
  it("uses memory only when durable storage is entirely unconfigured", () => {
    expect(createMemoryTelemetryStoreFromEnv({ env: {} })).toBeInstanceOf(
      InMemoryMemoryTelemetryStore
    );
    expect(() => createMemoryTelemetryStoreFromEnv({
      env: { SUPABASE_URL: "https://project.supabase.co" }
    })).toThrow(/requires both SUPABASE_URL/);
    expect(() => createMemoryTelemetryStoreFromEnv({
      env: { SUPABASE_SECRET_KEY: "orphan-secret" }
    })).toThrow(/requires both SUPABASE_URL/);
  });

  it("prefers the current secret key and supports the legacy service role key", () => {
    const fetch = vi.fn();
    expect(createMemoryTelemetryStoreFromEnv({
      env: {
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SECRET_KEY: "new-secret",
        SUPABASE_SERVICE_ROLE_KEY: "legacy-secret"
      },
      fetch
    })).toBeInstanceOf(SupabaseDataApiMemoryTelemetryStore);
    expect(createMemoryTelemetryStoreFromEnv({
      env: {
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SECRET_KEY: "   ",
        SUPABASE_SERVICE_ROLE_KEY: "legacy-secret"
      },
      fetch
    })).toBeInstanceOf(SupabaseDataApiMemoryTelemetryStore);
  });
});
