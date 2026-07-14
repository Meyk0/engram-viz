import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, OPTIONS, POST } from "@/app/api/traces/live/route";
import { hashTelemetryIngestToken } from "@/lib/ingest/auth";

describe("legacy live trace API", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ENGRAM_LEGACY_LIVE_RECORDER_ENABLED", "");
    vi.stubEnv("ENGRAM_INGEST_KEYS_JSON", "");
    vi.stubEnv("ENGRAM_INGEST_ALLOWED_ORIGINS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserves unauthenticated ephemeral recording in local development", async () => {
    const response = await POST(traceRequest("channel-api-test", {
      items: [trace("trace-api"), memorySpan("trace-api")]
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
    const invalidChannel = await POST(traceRequest("bad", {}));
    expect(invalidChannel.status).toBe(400);

    const invalidJson = await POST(new Request(liveUrl("valid-channel"), {
      method: "POST",
      body: "{broken"
    }));
    expect(invalidJson.status).toBe(400);
  });

  it("streams the current snapshot to a local SSE subscriber", async () => {
    const channel = "channel-sse-test";
    await POST(traceRequest(channel, { item: trace("trace-sse") }));
    const response = await GET(new Request(liveUrl(channel)));
    const output = await readInitialSnapshot(response);

    expect(response.status).toBe(200);
    expect(output.preamble).toContain("retry: 1500");
    expect(output.snapshot).toContain("event: trace");
    expect(output.snapshot).toContain("trace-sse");
    expect(output.snapshot).toContain(`\"channelId\":\"${channel}\"`);
  });

  it("fails closed in production unless explicitly enabled and authenticated", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const disabled = await POST(traceRequest("channel-production", { item: trace("trace-prod") }));
    expect(disabled.status).toBe(404);

    vi.stubEnv("ENGRAM_LEGACY_LIVE_RECORDER_ENABLED", "true");
    const missingKeys = await POST(traceRequest("channel-production", { item: trace("trace-prod") }));
    expect(missingKeys.status).toBe(503);

    configureKeys([{ token: "secret-a", keyId: "key-a", tenantId: "tenant-a", projectId: "project-a" }]);
    const missingBearer = await POST(traceRequest("channel-production", { item: trace("trace-prod") }));
    const validBearer = await POST(traceRequest(
      "channel-production",
      { item: trace("trace-prod") },
      { Authorization: "Bearer secret-a" }
    ));

    expect(missingBearer.status).toBe(401);
    expect(validBearer.status).toBe(200);
  });

  it("requires a valid bearer credential whenever ingest keys are configured", async () => {
    configureKeys([{ token: "secret-a", keyId: "key-a", tenantId: "tenant-a", projectId: "project-a" }]);

    const missing = await POST(traceRequest("channel-auth-test", { item: trace("trace-auth") }));
    const invalid = await POST(traceRequest(
      "channel-auth-test",
      { item: trace("trace-auth") },
      { Authorization: "Bearer wrong-secret" }
    ));
    const valid = await POST(traceRequest(
      "channel-auth-test",
      { item: trace("trace-auth") },
      { Authorization: "Bearer secret-a" }
    ));
    const missingSubscriber = await GET(new Request(liveUrl("channel-auth-test")));

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(valid.status).toBe(200);
    expect(missingSubscriber.status).toBe(401);
  });

  it("rejects cross-tenant and cross-project envelope claims", async () => {
    configureKeys([{ token: "secret-a", keyId: "key-a", tenantId: "tenant-a", projectId: "project-a" }]);

    const bodyClaim = await POST(traceRequest(
      "channel-claims-test",
      { tenantId: "tenant-b", item: trace("trace-claim") },
      { Authorization: "Bearer secret-a" }
    ));
    const queryClaim = await GET(new Request(
      `${liveUrl("channel-claims-test")}&projectId=project-b`,
      { headers: { Authorization: "Bearer secret-a" } }
    ));
    const repeatedQueryClaim = await GET(new Request(
      `${liveUrl("channel-claims-test")}&projectId=project-a&projectId=project-b`,
      { headers: { Authorization: "Bearer secret-a" } }
    ));

    expect(bodyClaim.status).toBe(403);
    expect(queryClaim.status).toBe(403);
    expect(repeatedQueryClaim.status).toBe(403);
  });

  it("isolates identical channel IDs between authenticated tenants", async () => {
    configureKeys([
      { token: "secret-a", keyId: "key-a", tenantId: "tenant-a", projectId: "project-a" },
      { token: "secret-b", keyId: "key-b", tenantId: "tenant-b", projectId: "project-b" }
    ]);
    const channel = "shared-channel-test";
    await POST(traceRequest(channel, { item: trace("trace-tenant-a") }, { Authorization: "Bearer secret-a" }));
    await POST(traceRequest(channel, { item: trace("trace-tenant-b") }, { Authorization: "Bearer secret-b" }));

    const tenantA = await readInitialSnapshot(await GET(new Request(liveUrl(channel), {
      headers: { Authorization: "Bearer secret-a" }
    })));
    const tenantB = await readInitialSnapshot(await GET(new Request(liveUrl(channel), {
      headers: { Authorization: "Bearer secret-b" }
    })));

    expect(tenantA.snapshot).toContain("trace-tenant-a");
    expect(tenantA.snapshot).not.toContain("trace-tenant-b");
    expect(tenantB.snapshot).toContain("trace-tenant-b");
    expect(tenantB.snapshot).not.toContain("trace-tenant-a");
  });

  it("returns exact-origin CORS headers without a wildcard", async () => {
    vi.stubEnv(
      "ENGRAM_INGEST_ALLOWED_ORIGINS",
      "https://allowed.example, https://second.example"
    );

    const denied = await OPTIONS(new Request(liveUrl("channel-cors-test"), {
      method: "OPTIONS",
      headers: { Origin: "https://denied.example" }
    }));
    const allowed = await OPTIONS(new Request(liveUrl("channel-cors-test"), {
      method: "OPTIONS",
      headers: { Origin: "https://allowed.example" }
    }));

    expect(denied.status).toBe(204);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
    expect(allowed.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(allowed.headers.get("access-control-allow-headers")).toBe("Authorization, Content-Type");
    expect(allowed.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(allowed.headers.get("vary")).toContain("Origin");
    expect(allowed.headers.get("x-engram-transport")).toBe("legacy-ephemeral");

    const posted = await POST(new Request(liveUrl("channel-cors-test"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://allowed.example" },
      body: JSON.stringify({ item: trace("trace-cors") })
    }));
    const streamed = await GET(new Request(liveUrl("channel-cors-test"), {
      headers: { Origin: "https://allowed.example" }
    }));
    expect(posted.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
    expect(streamed.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
    await streamed.body?.cancel();
  });

  it("gates preflight when the legacy production route is disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENGRAM_INGEST_ALLOWED_ORIGINS", "https://allowed.example");

    const response = await OPTIONS(new Request(liveUrl("channel-cors-test"), {
      method: "OPTIONS",
      headers: { Origin: "https://allowed.example" }
    }));

    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
  });

  it("fails closed when ingest key configuration is malformed", async () => {
    vi.stubEnv("ENGRAM_INGEST_KEYS_JSON", "{not-json");
    const response = await POST(traceRequest("channel-config-test", { item: trace("trace-config") }));

    expect(response.status).toBe(503);
  });

  it("does not accept tenant or project claims without authentication", async () => {
    const response = await GET(new Request(`${liveUrl("channel-claims-test")}&tenantId=tenant-a`));

    expect(response.status).toBe(403);
  });
});

function liveUrl(channel: string) {
  return `http://localhost/api/traces/live?channel=${channel}`;
}

function traceRequest(channel: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(liveUrl(channel), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

function trace(id: string) {
  return { object: "trace", id, workflow_name: "API recorder" };
}

function memorySpan(traceId: string) {
  return {
    object: "trace.span",
    id: `${traceId}-memory`,
    trace_id: traceId,
    span_data: {
      type: "function",
      name: "retrieve_memory",
      input: { query: "favorite color" },
      output: { ids: ["memory-indigo"] }
    }
  };
}

async function readInitialSnapshot(response: Response) {
  const reader = response.body?.getReader();
  expect(reader).toBeDefined();
  const decoder = new TextDecoder();
  const preamble = decoder.decode((await reader!.read()).value);
  const snapshot = decoder.decode((await reader!.read()).value);
  await reader!.cancel();
  return { preamble, snapshot };
}

function configureKeys(keys: Array<{
  token: string;
  keyId: string;
  tenantId: string;
  projectId: string;
}>) {
  vi.stubEnv("ENGRAM_INGEST_KEYS_JSON", JSON.stringify(keys.map(({ token, ...key }) => ({
    ...key,
    tokenSha256: hashTelemetryIngestToken(token)
  }))));
}
