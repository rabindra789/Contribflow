import { describe, expect, it } from 'vitest';
import { derivePullRequestState } from './pull-request-state';

describe('derivePullRequestState', () => {
  it.each([
    ['open', false, null, 'open'],
    ['open', true, null, 'draft'],
    ['closed', false, null, 'closed'],
    ['closed', true, null, 'closed'],
    ['closed', false, '2026-10-19T10:00:00.000Z', 'merged'],
    ['open', true, '2026-10-19T10:00:00.000Z', 'merged'],
  ] as const)('state=%s draft=%s mergedAt=%s -> %s', (state, draft, mergedAt, expected) => {
    expect(derivePullRequestState(state, draft, mergedAt)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it('ignores draft for a closed pull request', () => {
    expect(derivePullRequestState('closed', undefined, null)).toEqual({
      ok: true,
      value: 'closed',
    });
  });

  it.each([
    ['unknown', false, null],
    ['merged', false, null],
    [undefined, false, null],
    ['open', 'true', null],
    ['open', undefined, null],
    ['open', false, undefined],
    ['open', false, ''],
    ['open', false, 42],
  ] as const)('rejects invalid input %s / %s / %s', (state, draft, mergedAt) => {
    const result = derivePullRequestState(state, draft, mergedAt);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('never throws for unexpected values', () => {
    expect(() => derivePullRequestState({}, [], {})).not.toThrow();
    expect(derivePullRequestState({}, [], {}).ok).toBe(false);
  });
});
