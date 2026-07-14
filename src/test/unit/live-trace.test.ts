import { describe, expect, it, vi } from "vitest";
import { createEngramTracingProcessor } from "@/lib/traces/flight-recorder-client";
import { createLiveTraceHub } from "@/lib/traces/live";

describe("live trace flight recorder", () => {
  it("upserts span lifecycle updates and broadcasts normalized snapshots", () => {
    const hub = createLiveTraceHub();
    const listener = vi.fn();
    hub.subscribe("channel-test", listener);
    hub.append("channel-test", [{
      object: "trace",
      id: "trace-live",
      workflow_name: "Live agent"
    }, {
      object: "trace.span",
      id: "span-memory",
      trace_id: "trace-live",
      span_data: {
        type: "function",
        name: "store_memory",
        input: { text: "User likes indigo.", api_key: "sk-live-secret-123456" }
      }
    }]);
    const snapshot = hub.append("channel-test", [{
      object: "trace.span",
      id: "span-memory",
      trace_id: "trace-live",
      ended_at: "2026-07-13T12:00:01.000Z",
      span_data: {
        type: "function",
        name: "store_memory",
        input: { text: "User likes indigo." }
      }
    }]);

    expect(snapshot.itemCount).toBe(2);
    expect(snapshot.trace.steps).toHaveLength(1);
    expect(snapshot.trace.steps[0]).toMatchObject({ status: "completed", name: "store_memory" });
    expect(snapshot.trace.steps[0]?.memoryMappings[0]?.event).toMatchObject({ type: "store" });
    expect(JSON.stringify(snapshot)).not.toContain("sk-live-secret");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("implements the Agents SDK processor lifecycle over the ingest endpoint", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(init?.body));
      return new Response(null, { status: 202 });
    });
    const processor = createEngramTracingProcessor({
      endpoint: "https://engram.example/api/traces/live",
      channelId: "channel-123",
      fetch: fetchMock
    });
    const trace = {
      toJSON: vi.fn(() => ({ object: "trace", id: "trace-1", tracing_api_key: "secret" }))
    };
    const span = {
      toJSON: vi.fn(() => ({ object: "trace.span", id: "span-1" }))
    };

    await processor.onTraceStart(trace);
    await processor.onSpanEnd(span);
    await processor.forceFlush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("channel=channel-123");
    expect(JSON.parse(calls[0] ?? "{}").item).toMatchObject({ object: "trace" });
    expect(trace.toJSON).toHaveBeenCalledWith({ includeTracingApiKey: false });
  });
});
