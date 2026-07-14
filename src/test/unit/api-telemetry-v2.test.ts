import { describe, expect, it, vi } from "vitest";
import { createTelemetryV2Handlers } from "@/app/api/telemetry/v2/route";
import type { MemoryTelemetryStore, TelemetryTenantContext } from "@/lib/ingest/types";

const context: TelemetryTenantContext = {
  tenantId: "tenant-a",
  projectId: "project-a",
  keyId: "key-a"
};

describe("telemetry v2 API", () => {
  it("binds valid events to the authenticated project and reports idempotency", async () => {
    const store = mockStore();
    store.append.mockResolvedValue({
      acceptedEventIds: ["event-1"],
      duplicateEventIds: ["event-2"],
      highWaterCursor: 12
    });
    const handlers = createTelemetryV2Handlers({ store, authenticate: () => context });

    const response = await handlers.POST(request("POST", {
      events: [event("event-1"), event("event-2")]
    }));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      projectId: "project-a",
      accepted: 1,
      duplicates: 1,
      highWaterCursor: 12
    });
    expect(store.append).toHaveBeenCalledWith(
      context,
      expect.arrayContaining([expect.objectContaining({ projectId: "project-a" })])
    );
  });

  it("rejects cross-project claims before storage", async () => {
    const store = mockStore();
    const handlers = createTelemetryV2Handlers({ store, authenticate: () => context });
    const response = await handlers.POST(request("POST", {
      events: [{ ...event("event-1"), projectId: "project-b" }]
    }));

    expect(response.status).toBe(403);
    expect(store.append).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated, malformed, and oversized batches", async () => {
    const store = mockStore();
    const unauthenticated = createTelemetryV2Handlers({ store, authenticate: () => undefined });
    expect((await unauthenticated.POST(request("POST", { events: [event("event-1")] }))).status).toBe(401);

    const handlers = createTelemetryV2Handlers({ store, authenticate: () => context });
    expect((await handlers.POST(new Request("https://engram.test/api/telemetry/v2", {
      method: "POST",
      body: "not-json"
    }))).status).toBe(400);
    expect((await handlers.POST(request("POST", { events: [] }))).status).toBe(400);
    expect((await handlers.POST(request("POST", { events: [event("")] }))).status).toBe(400);
  });

  it("reads only through the authenticated project cursor", async () => {
    const store = mockStore();
    store.read.mockResolvedValue({
      events: [{
        cursor: 9,
        tenantId: context.tenantId,
        projectId: context.projectId,
        eventId: "event-9",
        occurredAt: "2026-07-14T18:00:00.000Z",
        receivedAt: "2026-07-14T18:00:01.000Z",
        event: event("event-9", context.projectId)
      }],
      highWaterCursor: 9
    });
    const handlers = createTelemetryV2Handlers({ store, authenticate: () => context });
    const response = await handlers.GET(new Request("https://engram.test/api/telemetry/v2?after=8&limit=25"));

    expect(response.status).toBe(200);
    expect(store.read).toHaveBeenCalledWith(context, { afterCursor: 8, limit: 25 });
    expect(await response.json()).toMatchObject({ projectId: "project-a", highWaterCursor: 9 });
  });

  it("does not allow browser origins unless explicitly configured", async () => {
    const previous = process.env.ENGRAM_INGEST_ALLOWED_ORIGINS;
    process.env.ENGRAM_INGEST_ALLOWED_ORIGINS = "https://allowed.example";
    try {
      const handlers = createTelemetryV2Handlers({ store: mockStore(), authenticate: () => context });
      const denied = await handlers.OPTIONS(new Request("https://engram.test/api/telemetry/v2", {
        method: "OPTIONS",
        headers: { Origin: "https://denied.example" }
      }));
      const allowed = await handlers.OPTIONS(new Request("https://engram.test/api/telemetry/v2", {
        method: "OPTIONS",
        headers: { Origin: "https://allowed.example" }
      }));

      expect(denied.headers.get("access-control-allow-origin")).toBeNull();
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
    } finally {
      if (previous === undefined) delete process.env.ENGRAM_INGEST_ALLOWED_ORIGINS;
      else process.env.ENGRAM_INGEST_ALLOWED_ORIGINS = previous;
    }
  });
});

function request(method: string, body: unknown) {
  return new Request("https://engram.test/api/telemetry/v2", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function event(eventId: string, projectId?: string) {
  return {
    schemaVersion: 2 as const,
    eventId,
    traceId: "trace-1",
    timestamp: "2026-07-14T18:00:00.000Z",
    sequence: 1,
    operation: "retrieve" as const,
    ...(projectId ? { projectId } : {}),
    evidence: { level: "observed" as const, adapter: "test" },
    memoryIds: ["memory-1"],
    retrieval: { query: "Where do I live?", selectedIds: ["memory-1"] }
  };
}

function mockStore() {
  return {
    append: vi.fn<MemoryTelemetryStore["append"]>(),
    read: vi.fn<MemoryTelemetryStore["read"]>()
  };
}
