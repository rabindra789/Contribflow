export interface RateLimitInfo {
  remaining: number | null;
  retryAfterSeconds: number | null;
  resetAt: string | null;
}

export interface HeaderLike {
  get(name: string): string | null;
}

const MAX_DATE_MS = 8_640_000_000_000_000;

function parseNonNegativeInteger(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseResetAt(value: string | null, nowMs: number): {
  resetAt: string | null;
  secondsUntilReset: number | null;
} {
  const epochSeconds = parseNonNegativeInteger(value);
  if (epochSeconds === null) {
    return { resetAt: null, secondsUntilReset: null };
  }

  const resetMs = epochSeconds * 1000;
  if (!Number.isFinite(resetMs) || Math.abs(resetMs) > MAX_DATE_MS) {
    return { resetAt: null, secondsUntilReset: null };
  }

  const resetDate = new Date(resetMs);
  if (Number.isNaN(resetDate.getTime())) {
    return { resetAt: null, secondsUntilReset: null };
  }

  return {
    resetAt: resetDate.toISOString(),
    secondsUntilReset: Math.max(0, Math.ceil((resetMs - nowMs) / 1000)),
  };
}

function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) {
    return null;
  }

  const seconds = parseNonNegativeInteger(value);
  if (seconds !== null) {
    return seconds;
  }

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) {
    return null;
  }

  return Math.max(0, Math.ceil((retryAt - nowMs) / 1000));
}

/**
 * Reads rate-limit headers defensively. GitHub does not guarantee that any of
 * these headers are present, so every field is nullable.
 */
export function parseRateLimitHeaders(headers: HeaderLike, nowMs: number): RateLimitInfo {
  const remaining = parseNonNegativeInteger(headers.get('x-ratelimit-remaining'));
  const reset = parseResetAt(headers.get('x-ratelimit-reset'), nowMs);
  const explicitRetryAfter = parseRetryAfter(headers.get('retry-after'), nowMs);

  return {
    remaining,
    retryAfterSeconds: explicitRetryAfter ?? reset.secondsUntilReset,
    resetAt: reset.resetAt,
  };
}
