import { createHash } from "node:crypto";
import { createFixedWindowRateLimiter } from "@/lib/rate-limit";

type ApiRateLimitOptions = {
  limit: number;
  scope: string;
  windowMs?: number;
};

const limiters = new Map<string, ReturnType<typeof createFixedWindowRateLimiter>>();

export function checkApiRateLimit(
  request: Request,
  { limit, scope, windowMs = 60_000 }: ApiRateLimitOptions
): Response | undefined {
  if (!rateLimitingEnabled()) return undefined;

  const limiterKey = `${scope}:${limit}:${windowMs}`;
  const limiter = limiters.get(limiterKey) ?? createFixedWindowRateLimiter({
    limit,
    maxKeys: 10_000,
    windowMs
  });
  limiters.set(limiterKey, limiter);

  const result = limiter.check(clientKey(request));
  if (result.allowed) return undefined;

  return Response.json(
    { error: "Too many requests. Wait briefly before trying again." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1_000))
      }
    }
  );
}

export function resetApiRateLimitsForTests() {
  limiters.forEach((limiter) => limiter.clear());
  limiters.clear();
}

function rateLimitingEnabled() {
  return process.env.NODE_ENV === "production" && process.env.ENGRAM_API_RATE_LIMIT_ENABLED !== "false";
}

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? request.headers.get("x-real-ip")
    ?? "unidentified-client";
  const address = forwarded.split(",")[0]?.trim() || "unidentified-client";
  return createHash("sha256").update(address, "utf8").digest("hex");
}
