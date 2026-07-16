import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, isTrustedLoopbackRequest } from "@/app/api/local/traces/route";

const readTurns = vi.fn(async () => []);
const readTelemetry = vi.fn(async () => ({ events: [] }));

vi.mock("@/lib/ingest/runtime", () => ({
  getAgentTurnStore: () => ({ read: readTurns }),
  getMemoryTelemetryStore: () => ({ read: readTelemetry })
}));

const originalLocalMode = process.env.ENGRAM_LOCAL_MODE;
const originalKeys = process.env.ENGRAM_INGEST_KEYS_JSON;

beforeEach(() => {
  process.env.ENGRAM_LOCAL_MODE = "true";
  process.env.ENGRAM_INGEST_KEYS_JSON = JSON.stringify([{
    keyId: "local-test",
    tenantId: "local",
    projectId: "test-project",
    tokenSha256: "a".repeat(64)
  }]);
  readTurns.mockClear();
  readTelemetry.mockClear();
});

afterEach(() => {
  restoreEnvironment("ENGRAM_LOCAL_MODE", originalLocalMode);
  restoreEnvironment("ENGRAM_INGEST_KEYS_JSON", originalKeys);
});

describe("GET /api/local/traces", () => {
  it("stays unavailable when local mode is disabled", async () => {
    process.env.ENGRAM_LOCAL_MODE = "false";

    const response = await GET(localRequest());

    expect(response.status).toBe(404);
    expect(readTurns).not.toHaveBeenCalled();
  });

  it.each([
    ["public host", { host: "engramviz.com" }],
    ["forwarded host list", { host: "localhost:3100, engramviz.com" }],
    ["non-loopback origin", { host: "localhost:3100", origin: "https://engramviz.com" }],
    ["different loopback port", { host: "localhost:3100", origin: "http://localhost:4100" }],
    ["malformed origin path", { host: "localhost:3100", origin: "http://localhost:3100/not-an-origin" }],
    ["opaque origin", { host: "localhost:3100", origin: "null" }]
  ])("rejects a %s", async (_label, headers) => {
    const response = await GET(localRequest(headers));

    expect(response.status).toBe(403);
    expect(readTurns).not.toHaveBeenCalled();
  });

  it.each([
    ["CLI request without Origin", { host: "127.0.0.1:3100" }],
    ["localhost browser request", { host: "localhost:3100", origin: "http://localhost:3100" }],
    ["IPv6 browser request", { host: "[::1]:3100", origin: "http://[::1]:3100" }]
  ])("allows a %s", async (_label, headers) => {
    const response = await GET(localRequest(headers));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ projectId: "test-project", traces: [] });
    expect(readTurns).toHaveBeenCalledOnce();
  });
});

describe("isTrustedLoopbackRequest", () => {
  it("requires an explicit Host header", () => {
    expect(isTrustedLoopbackRequest(new Request("http://localhost/api/local/traces"))).toBe(false);
  });
});

function localRequest(headers: Record<string, string> = { host: "localhost:3100" }) {
  return new Request("http://localhost:3100/api/local/traces", { headers });
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
