import { describe, expect, it } from "vitest";
import { guardLocalModeRequest, isLoopbackHostname } from "@/lib/ingest/local-boundary";

describe("local Studio request boundary", () => {
  const localEnvironment = { NODE_ENV: "test", ENGRAM_LOCAL_MODE: "true" } as NodeJS.ProcessEnv;

  it("recognizes only loopback hostnames", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
    expect(isLoopbackHostname("studio.example.com")).toBe(false);
  });

  it("allows loopback requests in local mode", () => {
    const request = new Request("http://127.0.0.1:3100/api/turns/v1", {
      headers: { host: "127.0.0.1:3100", origin: "http://localhost:3000" }
    });

    expect(guardLocalModeRequest(request, localEnvironment)).toBeUndefined();
  });

  it("rejects remote hosts and origins in local mode", async () => {
    const remoteHost = guardLocalModeRequest(new Request("http://127.0.0.1:3100/api/turns/v1", {
      headers: { host: "studio.example.com" }
    }), localEnvironment);
    const remoteOrigin = guardLocalModeRequest(new Request("http://127.0.0.1:3100/api/turns/v1", {
      headers: { host: "127.0.0.1:3100", origin: "https://example.com" }
    }), localEnvironment);

    expect(remoteHost?.status).toBe(403);
    expect(remoteOrigin?.status).toBe(403);
    await expect(remoteHost?.json()).resolves.toMatchObject({ error: expect.stringContaining("loopback") });
  });

  it("does not change explicitly non-local deployments", () => {
    const request = new Request("https://engram.example.com/api/turns/v1", {
      headers: { host: "engram.example.com" }
    });

    expect(guardLocalModeRequest(request, { NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
