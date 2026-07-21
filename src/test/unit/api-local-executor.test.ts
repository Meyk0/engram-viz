import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStaleLocationPolicyReplay } from "@/lib/reliability/stale-location";

const configured = vi.fn(() => true);
const readManifest = vi.fn(async () => ({
  format: "engram.memory-executor" as const,
  version: 1 as const,
  id: "fixture-agent",
  name: "Fixture agent",
  executorVersion: "1.0.0",
  framework: { id: "langgraph", version: "1.4.8" },
  capabilities: createStaleLocationPolicyReplay().capabilities,
  sideEffects: { defaultMode: "blocked" as const, supportedModes: ["blocked" as const] }
}));
const runReplay = vi.fn(async () => createStaleLocationPolicyReplay());

vi.mock("@/lib/executor/local-client", () => ({
  localExecutorConfigured: configured,
  readLocalExecutorManifest: readManifest,
  runLocalExecutorReplay: runReplay
}));

const originalMode = process.env.ENGRAM_LOCAL_MODE;

beforeEach(() => {
  process.env.ENGRAM_LOCAL_MODE = "true";
  configured.mockReturnValue(true);
  readManifest.mockClear();
  runReplay.mockClear();
});

afterEach(() => {
  if (originalMode === undefined) delete process.env.ENGRAM_LOCAL_MODE;
  else process.env.ENGRAM_LOCAL_MODE = originalMode;
});

describe("local replay executor routes", () => {
  it("reports the attached LangGraph executor without exposing its token", async () => {
    const { GET } = await import("@/app/api/local/executor/route");
    const response = await GET(localRequest("/api/local/executor"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      available: true,
      manifest: { id: "fixture-agent", framework: { id: "langgraph" } }
    });
    expect(readManifest).toHaveBeenCalledOnce();
  });

  it("returns a clean unavailable state when Studio has no executor", async () => {
    configured.mockReturnValue(false);
    const { GET } = await import("@/app/api/local/executor/route");
    const response = await GET(localRequest("/api/local/executor"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: false });
  });

  it("proxies a validated blocked replay only from the local Studio origin", async () => {
    const fixture = createStaleLocationPolicyReplay();
    const envelope = {
      format: "engram.memory-executor-replay",
      version: 1,
      request: {
        baseline: fixture.source,
        intervention: fixture.intervention,
        answerAssertion: fixture.verification.assertion
      },
      sideEffectMode: "blocked"
    };
    const { POST } = await import("@/app/api/local/executor/replay/route");
    const response = await POST(localRequest("/api/local/executor/replay", {
      method: "POST",
      body: JSON.stringify(envelope),
      headers: { "Content-Type": "application/json" }
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ format: "engram.memory-policy-replay" });
    expect(runReplay).toHaveBeenCalledWith(expect.objectContaining({ sideEffectMode: "blocked" }));

    const rejected = await POST(new Request("http://engramviz.com/api/local/executor/replay", {
      method: "POST",
      body: JSON.stringify(envelope),
      headers: { host: "engramviz.com", "Content-Type": "application/json" }
    }));
    expect(rejected.status).toBe(403);
  });
});

function localRequest(pathname: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("host", "localhost:3100");
  headers.set("origin", "http://localhost:3100");
  return new Request(`http://localhost:3100${pathname}`, { ...init, headers });
}
