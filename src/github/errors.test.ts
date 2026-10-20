import { describe, expect, it } from 'vitest';
import { GitHubClientError, isGitHubClientError } from './errors';

describe('GitHubClientError', () => {
  it('keeps typed fields serializable', () => {
    const error = new GitHubClientError('rate-limited', 'GitHub rate limit reached.', {
      status: 403,
      retryAfterSeconds: 60,
      rateLimitResetAt: '2026-10-20T12:01:00.000Z',
    });

    expect(error.name).toBe('GitHubClientError');
    expect(error.kind).toBe('rate-limited');
    expect(error.status).toBe(403);
    expect(error.retryAfterSeconds).toBe(60);
    expect(error.rateLimitResetAt).toBe('2026-10-20T12:01:00.000Z');
    expect(isGitHubClientError(error)).toBe(true);
  });

  it('does not recognize other error values', () => {
    expect(isGitHubClientError(new Error('nope'))).toBe(false);
    expect(isGitHubClientError(null)).toBe(false);
  });
});
