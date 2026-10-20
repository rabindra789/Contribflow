import { describe, expect, it } from 'vitest';
import { parseRateLimitHeaders } from './rate-limit';

const NOW = Date.parse('2026-10-20T12:00:00.000Z');

describe('parseRateLimitHeaders', () => {
  it('returns nulls when headers are absent', () => {
    expect(parseRateLimitHeaders(new Headers(), NOW)).toEqual({
      remaining: null,
      retryAfterSeconds: null,
      resetAt: null,
    });
  });

  it('parses remaining and reset information', () => {
    const headers = new Headers({
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1792502400',
    });

    const info = parseRateLimitHeaders(headers, NOW);

    expect(info.remaining).toBe(0);
    expect(info.resetAt).toBe(new Date(1792502400 * 1000).toISOString());
    expect(info.retryAfterSeconds).toBe(Math.ceil((1792502400 * 1000 - NOW) / 1000));
  });

  it('prefers an explicit Retry-After over the reset header', () => {
    const headers = new Headers({
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1792502400',
      'retry-after': '90',
    });

    expect(parseRateLimitHeaders(headers, NOW)).toEqual({
      remaining: 0,
      retryAfterSeconds: 90,
      resetAt: new Date(1792502400 * 1000).toISOString(),
    });
  });

  it('parses an HTTP-date Retry-After value', () => {
    const headers = new Headers({
      'retry-after': 'Tue, 20 Oct 2026 12:01:00 GMT',
    });

    expect(parseRateLimitHeaders(headers, NOW).retryAfterSeconds).toBe(60);
  });

  it('never returns a negative retry delay for a past reset', () => {
    const pastEpoch = String(Math.floor(NOW / 1000) - 30);
    const headers = new Headers({ 'x-ratelimit-reset': pastEpoch });

    const info = parseRateLimitHeaders(headers, NOW);

    expect(info.resetAt).toBe(new Date(Number(pastEpoch) * 1000).toISOString());
    expect(info.retryAfterSeconds).toBe(0);
  });

  it('ignores malformed header values', () => {
    const headers = new Headers({
      'x-ratelimit-remaining': 'many',
      'x-ratelimit-reset': 'not-a-time',
      'retry-after': 'maybe later',
    });

    expect(parseRateLimitHeaders(headers, NOW)).toEqual({
      remaining: null,
      retryAfterSeconds: null,
      resetAt: null,
    });
  });

  it('ignores out-of-range reset timestamps without throwing', () => {
    const headers = new Headers({ 'x-ratelimit-reset': '99999999999999999999' });

    expect(parseRateLimitHeaders(headers, NOW)).toEqual({
      remaining: null,
      retryAfterSeconds: null,
      resetAt: null,
    });
  });
});
