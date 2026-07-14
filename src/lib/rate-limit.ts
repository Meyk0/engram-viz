export type RateLimitState = {
  count: number;
  resetAt: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export type FixedWindowRateLimiter = {
  check: (key: string, now?: number) => RateLimitDecision;
  clear: () => void;
  size: () => number;
};

export function isRateLimited(state: RateLimitState, now: number, limit: number) {
  if (now >= state.resetAt) return false;
  return state.count >= limit;
}

export function createFixedWindowRateLimiter(options: {
  limit: number;
  maxKeys?: number;
  windowMs: number;
}): FixedWindowRateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? 10_000;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Rate limit must be a positive integer.");
  if (!Number.isFinite(windowMs) || windowMs < 1) throw new RangeError("Rate-limit window must be positive.");
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new RangeError("Rate-limit key capacity must be positive.");

  const states = new Map<string, RateLimitState>();

  return {
    check(key, now = Date.now()) {
      cleanupExpired(states, now);
      const existing = states.get(key);
      if (!existing || now >= existing.resetAt) {
        ensureCapacity(states, maxKeys);
        const state = { count: 1, resetAt: now + windowMs };
        states.set(key, state);
        return decision(state, now, limit, true);
      }

      if (isRateLimited(existing, now, limit)) {
        return decision(existing, now, limit, false);
      }

      existing.count += 1;
      states.delete(key);
      states.set(key, existing);
      return decision(existing, now, limit, true);
    },
    clear() {
      states.clear();
    },
    size() {
      return states.size;
    }
  };
}

function decision(state: RateLimitState, now: number, limit: number, allowed: boolean): RateLimitDecision {
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - state.count),
    resetAt: state.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - now) / 1_000))
  };
}

function cleanupExpired(states: Map<string, RateLimitState>, now: number) {
  for (const [key, state] of states) {
    if (now >= state.resetAt) states.delete(key);
  }
}

function ensureCapacity(states: Map<string, RateLimitState>, maxKeys: number) {
  while (states.size >= maxKeys) {
    const oldest = states.keys().next().value as string | undefined;
    if (!oldest) return;
    states.delete(oldest);
  }
}
