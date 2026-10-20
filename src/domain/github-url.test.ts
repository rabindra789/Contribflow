import { describe, expect, it } from 'vitest';
import { MAX_TARGET_NUMBER } from './models';
import { parseGitHubUrl, type GitHubUrlRejectionReason } from './github-url';

interface ValidCase {
  input: string;
  kind: 'issue' | 'pull_request';
  owner: string;
  repo: string;
  number: number;
  url: string;
  id: string;
}

const validCases: ValidCase[] = [
  {
    input: 'https://github.com/octocat/Hello-World/issues/1',
    kind: 'issue',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 1,
    url: 'https://github.com/octocat/Hello-World/issues/1',
    id: 'octocat/hello-world#1',
  },
  {
    input: 'https://github.com/vercel/next.js/pull/67890',
    kind: 'pull_request',
    owner: 'vercel',
    repo: 'next.js',
    number: 67890,
    url: 'https://github.com/vercel/next.js/pull/67890',
    id: 'vercel/next.js#67890',
  },
  {
    input: 'https://github.com/octocat/Hello-World/issues/42/',
    kind: 'issue',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 42,
    url: 'https://github.com/octocat/Hello-World/issues/42',
    id: 'octocat/hello-world#42',
  },
  {
    input: 'https://github.com/octocat/Hello-World/issues/42///',
    kind: 'issue',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 42,
    url: 'https://github.com/octocat/Hello-World/issues/42',
    id: 'octocat/hello-world#42',
  },
  {
    input: 'https://github.com/octocat/Hello-World/issues/42?tab=readme',
    kind: 'issue',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 42,
    url: 'https://github.com/octocat/Hello-World/issues/42',
    id: 'octocat/hello-world#42',
  },
  {
    input: 'https://github.com/octocat/Hello-World/issues/42#issuecomment-123',
    kind: 'issue',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 42,
    url: 'https://github.com/octocat/Hello-World/issues/42',
    id: 'octocat/hello-world#42',
  },
  {
    input: 'https://github.com/octocat/Hello-World/pull/42?w=1#discussion_r1',
    kind: 'pull_request',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 42,
    url: 'https://github.com/octocat/Hello-World/pull/42',
    id: 'octocat/hello-world#42',
  },
  {
    input: 'https://github.com/octocat/Hello-World/pull/42/files',
    kind: 'pull_request',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 42,
    url: 'https://github.com/octocat/Hello-World/pull/42',
    id: 'octocat/hello-world#42',
  },
  {
    input: 'https://github.com/octocat/Hello-World/pull/42/commits/abc123',
    kind: 'pull_request',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 42,
    url: 'https://github.com/octocat/Hello-World/pull/42',
    id: 'octocat/hello-world#42',
  },
  {
    input: 'https://github.com/octocat/Hello-World/issues/42/anything',
    kind: 'issue',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 42,
    url: 'https://github.com/octocat/Hello-World/issues/42',
    id: 'octocat/hello-world#42',
  },
  {
    input: '  https://github.com/octocat/Hello-World/issues/7  ',
    kind: 'issue',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 7,
    url: 'https://github.com/octocat/Hello-World/issues/7',
    id: 'octocat/hello-world#7',
  },
  {
    input: 'https://GitHub.COM/octocat/Hello-World/issues/7',
    kind: 'issue',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 7,
    url: 'https://github.com/octocat/Hello-World/issues/7',
    id: 'octocat/hello-world#7',
  },
  {
    input: 'https://github.com/Microsoft/TypeScript/issues/12345',
    kind: 'issue',
    owner: 'Microsoft',
    repo: 'TypeScript',
    number: 12345,
    url: 'https://github.com/Microsoft/TypeScript/issues/12345',
    id: 'microsoft/typescript#12345',
  },
  {
    input: 'https://github.com/owner/repo_with.dots/issues/9',
    kind: 'issue',
    owner: 'owner',
    repo: 'repo_with.dots',
    number: 9,
    url: 'https://github.com/owner/repo_with.dots/issues/9',
    id: 'owner/repo_with.dots#9',
  },
  {
    input: 'https://github.com/my-org/repo/issues/9',
    kind: 'issue',
    owner: 'my-org',
    repo: 'repo',
    number: 9,
    url: 'https://github.com/my-org/repo/issues/9',
    id: 'my-org/repo#9',
  },
  {
    input: `https://github.com/octocat/Hello-World/issues/${MAX_TARGET_NUMBER}`,
    kind: 'issue',
    owner: 'octocat',
    repo: 'Hello-World',
    number: MAX_TARGET_NUMBER,
    url: `https://github.com/octocat/Hello-World/issues/${MAX_TARGET_NUMBER}`,
    id: `octocat/hello-world#${MAX_TARGET_NUMBER}`,
  },
  {
    input: 'https://github.com/octocat/Hello-World/issues/9?',
    kind: 'issue',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 9,
    url: 'https://github.com/octocat/Hello-World/issues/9',
    id: 'octocat/hello-world#9',
  },
  {
    input: 'https://github.com/octocat/Hello-World/issues/9/?ref=search',
    kind: 'issue',
    owner: 'octocat',
    repo: 'Hello-World',
    number: 9,
    url: 'https://github.com/octocat/Hello-World/issues/9',
    id: 'octocat/hello-world#9',
  },
];

describe('parseGitHubUrl valid URLs', () => {
  it.each(validCases)('parses $input', ({ input, ...expected }) => {
    const result = parseGitHubUrl(input);
    expect(result).toEqual({ ok: true, target: expected });
  });

  it('keeps the resource identity stable across query strings, fragments, and subpaths', () => {
    const plain = parseGitHubUrl('https://github.com/octocat/Hello-World/pull/42');
    const decorated = parseGitHubUrl(
      'https://github.com/octocat/Hello-World/pull/42/files?diff=split#diff-abc',
    );

    expect(plain.ok).toBe(true);
    expect(decorated.ok).toBe(true);
    if (plain.ok && decorated.ok) {
      expect(decorated.target).toEqual(plain.target);
    }
  });

  it('treats an issue URL and a pull request URL with the same number as different targets', () => {
    const issue = parseGitHubUrl('https://github.com/octocat/Hello-World/issues/42');
    const pullRequest = parseGitHubUrl('https://github.com/octocat/Hello-World/pull/42');

    expect(issue.ok && pullRequest.ok).toBe(true);
    if (issue.ok && pullRequest.ok) {
      expect(issue.target.id).toBe(pullRequest.target.id);
      expect(issue.target.kind).toBe('issue');
      expect(pullRequest.target.kind).toBe('pull_request');
      expect(issue.target.url).not.toBe(pullRequest.target.url);
    }
  });
});

interface InvalidCase {
  input: string;
  reason?: GitHubUrlRejectionReason;
}

const invalidCases: InvalidCase[] = [
  { input: '', reason: 'invalid-url' },
  { input: '   ', reason: 'invalid-url' },
  { input: 'not a url', reason: 'invalid-url' },
  { input: 'github.com/octocat/Hello-World/issues/1', reason: 'invalid-url' },
  { input: 'http://github.com/octocat/Hello-World/issues/1', reason: 'unsupported-scheme' },
  { input: 'ftp://github.com/octocat/Hello-World/issues/1', reason: 'unsupported-scheme' },
  { input: 'https://gitlab.com/octocat/Hello-World/issues/1', reason: 'unsupported-host' },
  { input: 'https://www.github.com/octocat/Hello-World/issues/1', reason: 'unsupported-host' },
  { input: 'https://api.github.com/repos/octocat/Hello-World/issues/1', reason: 'unsupported-host' },
  { input: 'https://github.com.evil.com/octocat/Hello-World/issues/1', reason: 'unsupported-host' },
  { input: 'https://gist.github.com/octocat/abc123', reason: 'unsupported-host' },
  { input: 'https://user@github.com/octocat/Hello-World/issues/1', reason: 'credentials-not-allowed' },
  {
    input: 'https://user:pass@github.com/octocat/Hello-World/issues/1',
    reason: 'credentials-not-allowed',
  },
  { input: 'https://github.com:8443/octocat/Hello-World/issues/1', reason: 'port-not-allowed' },
  { input: 'https://github.com/', reason: 'invalid-path' },
  { input: 'https://github.com/octocat', reason: 'invalid-path' },
  { input: 'https://github.com/octocat/Hello-World', reason: 'invalid-path' },
  { input: 'https://github.com/octocat/Hello-World/issues', reason: 'invalid-path' },
  { input: 'https://github.com/octocat/Hello-World/issues/', reason: 'invalid-path' },
  { input: 'https://github.com//Hello-World/issues/1', reason: 'invalid-path' },
  { input: 'https://github.com/octocat//issues/1', reason: 'invalid-path' },
  { input: 'https://github.com/octocat/Hello-World/issues/1//files', reason: 'invalid-path' },
  { input: 'https://github.com/octocat/Hello-World/pulls/1', reason: 'unsupported-target-kind' },
  { input: 'https://github.com/octocat/Hello-World/tree/main', reason: 'unsupported-target-kind' },
  { input: 'https://github.com/octocat/Hello-World/Issues/1', reason: 'unsupported-target-kind' },
  { input: 'https://github.com/octocat/Hello-World/issues/new', reason: 'reserved-path' },
  { input: 'https://github.com/octocat/Hello-World/pull/new', reason: 'reserved-path' },
  { input: 'https://github.com/octocat/Hello-World/issues/0', reason: 'invalid-number' },
  { input: 'https://github.com/octocat/Hello-World/issues/007', reason: 'invalid-number' },
  { input: 'https://github.com/octocat/Hello-World/issues/2147483648', reason: 'invalid-number' },
  {
    input: 'https://github.com/octocat/Hello-World/issues/99999999999999999999',
    reason: 'invalid-number',
  },
  { input: 'https://github.com/octocat/Hello-World/issues/1.5', reason: 'invalid-number' },
  { input: 'https://github.com/octocat/Hello-World/issues/1e3', reason: 'invalid-number' },
  { input: 'https://github.com/octocat/Hello-World/issues/0x10', reason: 'invalid-number' },
  { input: 'https://github.com/octocat/Hello-World/issues/-1', reason: 'invalid-number' },
  { input: 'https://github.com/octocat/Hello-World/issues/abc', reason: 'invalid-number' },
  { input: 'https://github.com/octocat/Hello-World/issues/123abc', reason: 'invalid-number' },
  { input: 'https://github.com/octocat/Hello-World/issues/%31', reason: 'invalid-number' },
  { input: 'https://github.com/octocat/Hello-World/issues/%20123', reason: 'invalid-number' },
  { input: 'https://github.com/octocat/Hello-World/issues/%EF%BC%91', reason: 'invalid-number' },
  {
    input: `https://github.com/${'a'.repeat(40)}/Hello-World/issues/1`,
    reason: 'invalid-owner',
  },
  { input: 'https://github.com/-octocat/Hello-World/issues/1', reason: 'invalid-owner' },
  { input: 'https://github.com/octocat-/Hello-World/issues/1', reason: 'invalid-owner' },
  { input: 'https://github.com/octo_cat/Hello-World/issues/1', reason: 'invalid-owner' },
  { input: 'https://github.com/%6Fctocat/Hello-World/issues/1', reason: 'invalid-owner' },
  {
    input: `https://github.com/octocat/${'a'.repeat(101)}/issues/1`,
    reason: 'invalid-repo',
  },
  { input: 'https://github.com/octocat/hello%20world/issues/1', reason: 'invalid-repo' },
  { input: 'https://github.com/octocat/repo%2Fname/issues/1', reason: 'invalid-repo' },
  // URL normalization turns dot-segment repositories into a different path.
  { input: 'https://github.com/octocat/../issues/1' },
  { input: 'https://github.com/octocat/./issues/1' },
];

describe('parseGitHubUrl invalid URLs', () => {
  it.each(invalidCases)('rejects $input', ({ input, reason }) => {
    const result = parseGitHubUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok && reason !== undefined) {
      expect(result.reason).toBe(reason);
    }
  });

  it('rejects non-string input without throwing', () => {
    expect(parseGitHubUrl(null).ok).toBe(false);
    expect(parseGitHubUrl(undefined).ok).toBe(false);
    expect(parseGitHubUrl(42).ok).toBe(false);
    expect(parseGitHubUrl({}).ok).toBe(false);
  });
});
