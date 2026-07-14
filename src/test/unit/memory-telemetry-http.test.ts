import { describe, expect, it, vi } from "vitest";
import {
  createMemoryTelemetryHttpTransport,
  MemoryTelemetryHttpError
} from "@/lib/telemetry/http";

describe("memory telemetry HTTP transport", () => {
  it("posts a batch with a bearer credential", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const transport = createMemoryTelemetryHttpTransport({
      endpoint: "https://engram.example/api/telemetry/v2",
      token: "secret-token",
      fetch: fetcher
    });

    await transport([event]);

    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://engram.example/api/telemetry/v2"),
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json"
        }
      })
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ events: [event] });
  });

  it("reports bounded errors without leaking the token or response body", async () => {
    const transport = createMemoryTelemetryHttpTransport({
      endpoint: "https://engram.example/api/telemetry/v2",
      token: "do-not-leak",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive internal body", { status: 503 }))
    });

    const error = await transport([event]).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(MemoryTelemetryHttpError);
    expect(String(error)).toContain("503");
    expect(String(error)).not.toContain("do-not-leak");
    expect(String(error)).not.toContain("sensitive internal body");
  });

  it("rejects unsupported endpoint protocols and blank tokens", () => {
    expect(() => createMemoryTelemetryHttpTransport({ endpoint: "file:///tmp/events", token: "secret" })).toThrow(/HTTP/);
    expect(() => createMemoryTelemetryHttpTransport({ endpoint: "https://engram.example", token: " " })).toThrow(/token/);
  });
});

const event = {
  schemaVersion: 2 as const,
  eventId: "event-http-1",
  traceId: "trace-http-1",
  timestamp: "2026-07-14T18:00:00.000Z",
  sequence: 1,
  operation: "retrieve" as const,
  evidence: { level: "observed" as const, adapter: "test" },
  memoryIds: ["memory-1"],
  retrieval: { query: "What changed?", selectedIds: ["memory-1"] }
};
