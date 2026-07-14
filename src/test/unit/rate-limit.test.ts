import { afterEach, describe, expect, it, vi } from "vitest";
import { checkApiRateLimit, resetApiRateLimitsForTests } from "@/lib/api-rate-limit";
import { createFixedWindowRateLimiter } from "@/lib/rate-limit";

afterEach(() => {
  resetApiRateLimitsForTests();
  vi.unstubAllEnvs();
});

describe("fixed-window rate limiting", () => {
  it("allows up to the limit, rejects excess, and resets on the next window", () => {
    const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 1_000 });

    expect(limiter.check("client", 0)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.check("client", 10)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.check("client", 20)).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.check("client", 1_000)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("bounds tracked key cardinality", () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, maxKeys: 2, windowMs: 10_000 });
    limiter.check("one", 0);
    limiter.check("two", 0);
    limiter.check("three", 0);

    expect(limiter.size()).toBe(2);
    expect(limiter.check("one", 1).allowed).toBe(true);
  });

  it("returns a production 429 with retry metadata and isolates route scopes", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENGRAM_API_RATE_LIMIT_ENABLED", "true");
    const request = new Request("https://engram.example/api/chat", {
      headers: { "X-Forwarded-For": "203.0.113.8" }
    });

    expect(checkApiRateLimit(request, { scope: "test-chat", limit: 1 })).toBeUndefined();
    const rejected = checkApiRateLimit(request, { scope: "test-chat", limit: 1 });
    expect(rejected?.status).toBe(429);
    expect(rejected?.headers.get("retry-after")).toBe("60");
    expect((await rejected?.json())?.error).toContain("Too many requests");
    expect(checkApiRateLimit(request, { scope: "test-dream", limit: 1 })).toBeUndefined();
  });

  it("stays disabled in tests and can be explicitly disabled in production", () => {
    const request = new Request("https://engram.example/api/chat");
    expect(checkApiRateLimit(request, { scope: "disabled-test", limit: 1 })).toBeUndefined();

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENGRAM_API_RATE_LIMIT_ENABLED", "false");
    expect(checkApiRateLimit(request, { scope: "disabled-production", limit: 1 })).toBeUndefined();
  });
});
