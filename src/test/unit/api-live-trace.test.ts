import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/traces/live/route";

describe("POST /api/traces/live", () => {
  it("accepts a trace item and reports normalized evidence counts", async () => {
    const response = await POST(new Request("http://localhost/api/traces/live?channel=channel-api-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ object: "trace", id: "trace-api", workflow_name: "API recorder" }, {
          object: "trace.span",
          id: "span-api-memory",
          trace_id: "trace-api",
          span_data: {
            type: "function",
            name: "retrieve_memory",
            input: { query: "favorite color" },
            output: { ids: ["memory-indigo"] }
          }
        }]
      })
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: 2,
      itemCount: 2,
      stepCount: 1,
      memoryEventCount: 1
    });
  });

  it("rejects invalid channels and malformed payloads", async () => {
    const invalidChannel = await POST(new Request("http://localhost/api/traces/live?channel=bad", {
      method: "POST",
      body: "{}"
    }));
    expect(invalidChannel.status).toBe(400);

    const invalidJson = await POST(new Request("http://localhost/api/traces/live?channel=valid-channel", {
      method: "POST",
      body: "{broken"
    }));
    expect(invalidJson.status).toBe(400);
  });

  it("streams the current snapshot to an SSE subscriber", async () => {
    const channel = "channel-sse-test";
    await POST(new Request(`http://localhost/api/traces/live?channel=${channel}`, {
      method: "POST",
      body: JSON.stringify({ item: { object: "trace", id: "trace-sse", workflow_name: "SSE trace" } })
    }));
    const response = await GET(new Request(`http://localhost/api/traces/live?channel=${channel}`));
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const decoder = new TextDecoder();
    const first = decoder.decode((await reader!.read()).value);
    const second = decoder.decode((await reader!.read()).value);
    await reader!.cancel();

    expect(first).toContain("retry: 1500");
    expect(second).toContain("event: trace");
    expect(second).toContain("trace-sse");
  });
});
