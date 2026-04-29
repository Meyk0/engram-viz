export type RateLimitState = {
  count: number;
  resetAt: number;
};

export function isRateLimited(state: RateLimitState, now: number, limit: number) {
  if (now >= state.resetAt) return false;
  return state.count >= limit;
}
