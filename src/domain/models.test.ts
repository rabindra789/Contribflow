import { describe, expect, it } from 'vitest';
import {
  MAX_TARGET_NUMBER,
  canonicalIssueUrl,
  canonicalPullRequestUrl,
  canonicalTargetId,
  isCanonicalTargetId,
  isValidOwnerSyntax,
  isValidRepoSyntax,
  isValidTargetNumber,
} from './models';

describe('canonical target identities', () => {
  it('lowercases identity but preserves the display casing of URL builders', () => {
    expect(canonicalTargetId('Microsoft', 'TypeScript', 42)).toBe('microsoft/typescript#42');
    expect(canonicalIssueUrl('Microsoft', 'TypeScript', 42)).toBe(
      'https://github.com/Microsoft/TypeScript/issues/42',
    );
    expect(canonicalPullRequestUrl('Microsoft', 'TypeScript', 42)).toBe(
      'https://github.com/Microsoft/TypeScript/pull/42',
    );
  });
});

describe('owner syntax', () => {
  it.each(['a', 'octocat', 'my-org', 'a--b', 'a'.repeat(39)])('accepts %s', (owner) => {
    expect(isValidOwnerSyntax(owner)).toBe(true);
  });

  it.each(['', '-octocat', 'octocat-', 'a'.repeat(40), 'octo_cat', 'octo cat', 'octo/cat', 'ümlaut'])(
    'rejects %s',
    (owner) => {
      expect(isValidOwnerSyntax(owner)).toBe(false);
    },
  );

  it('rejects non-string input', () => {
    expect(isValidOwnerSyntax(null)).toBe(false);
    expect(isValidOwnerSyntax(42)).toBe(false);
  });
});

describe('repository name syntax', () => {
  it.each(['a', 'Hello-World', 'next.js', 'under_score', 'a'.repeat(100)])('accepts %s', (repo) => {
    expect(isValidRepoSyntax(repo)).toBe(true);
  });

  it.each(['', '.', '..', 'a'.repeat(101), 'hello world', 'hello/world', 'repo#tag'])(
    'rejects %s',
    (repo) => {
      expect(isValidRepoSyntax(repo)).toBe(false);
    },
  );
});

describe('target numbers', () => {
  it('accepts the documented inclusive range', () => {
    expect(isValidTargetNumber(1)).toBe(true);
    expect(isValidTargetNumber(MAX_TARGET_NUMBER)).toBe(true);
  });

  it.each([0, -1, 1.5, MAX_TARGET_NUMBER + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %s',
    (number) => {
      expect(isValidTargetNumber(number)).toBe(false);
    },
  );

  it('rejects string and null inputs', () => {
    expect(isValidTargetNumber('1')).toBe(false);
    expect(isValidTargetNumber(null)).toBe(false);
  });
});

describe('canonical target ids', () => {
  it.each(['octocat/hello-world#1', 'microsoft/typescript#2147483647', 'a/b.c_d-e#99'])(
    'accepts %s',
    (id) => {
      expect(isCanonicalTargetId(id)).toBe(true);
    },
  );

  it.each([
    'Octocat/hello-world#1',
    'octocat/Hello-World#1',
    'octocat/hello-world#0',
    'octocat/hello-world#01',
    'octocat/hello-world#2147483648',
    'octocat/hello-world',
    'octocat#1',
    'octocat/hello world#1',
    '-octocat/hello-world#1',
    'octocat/#1',
  ])('rejects %s', (id) => {
    expect(isCanonicalTargetId(id)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isCanonicalTargetId(null)).toBe(false);
    expect(isCanonicalTargetId({})).toBe(false);
  });
});
