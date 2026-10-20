import { describe, expect, it } from 'vitest';
import type { GitHubTarget, SavedIssue, TrackedPullRequest } from '../domain/models';
import type { StorageSnapshot } from '../storage/repository';
import { resolveTarget } from './popup-target';

const issue: SavedIssue = {
  id: 'microsoft/typescript#12345',
  owner: 'Microsoft',
  repo: 'TypeScript',
  number: 12345,
  url: 'https://github.com/Microsoft/TypeScript/issues/12345',
  title: 'Improve inference for generic callbacks',
  state: 'open',
  savedAt: '2026-10-19T09:15:00.000Z',
  lastSyncedAt: '2026-10-19T09:15:02.120Z',
  lastSyncError: null,
};

const pullRequest: TrackedPullRequest = {
  id: 'microsoft/typescript#54321',
  owner: 'Microsoft',
  repo: 'TypeScript',
  number: 54321,
  url: 'https://github.com/Microsoft/TypeScript/pull/54321',
  title: 'Fix callback inference',
  state: 'draft',
  addedAt: '2026-10-19T10:00:00.000Z',
  lastSyncedAt: '2026-10-19T10:00:01.000Z',
  lastSyncError: null,
};

const snapshot: StorageSnapshot = {
  issues: [issue],
  pullRequests: [pullRequest],
  notes: {},
  warnings: [],
};

function target(kind: GitHubTarget['kind'], id: string): GitHubTarget {
  return {
    kind,
    owner: 'Microsoft',
    repo: 'TypeScript',
    number: kind === 'issue' ? 12345 : 54321,
    url:
      kind === 'issue'
        ? 'https://github.com/Microsoft/TypeScript/issues/12345'
        : 'https://github.com/Microsoft/TypeScript/pull/54321',
    id,
  };
}

describe('resolveTarget', () => {
  it('resolves a saved issue by canonical id', () => {
    expect(resolveTarget(target('issue', issue.id), snapshot)).toEqual({
      kind: 'issue',
      saved: true,
      issue,
    });
  });

  it('reports an unsaved issue', () => {
    expect(resolveTarget(target('issue', 'octocat/hello-world#42'), snapshot)).toEqual({
      kind: 'issue',
      saved: false,
    });
  });

  it('resolves a tracked pull request by canonical id', () => {
    expect(resolveTarget(target('pull_request', pullRequest.id), snapshot)).toEqual({
      kind: 'pull_request',
      saved: true,
      pullRequest,
    });
  });

  it('reports an untracked pull request', () => {
    expect(resolveTarget(target('pull_request', 'octocat/hello-world#42'), snapshot)).toEqual({
      kind: 'pull_request',
      saved: false,
    });
  });

  it('does not resolve a pull request id against saved issues', () => {
    expect(
      resolveTarget(target('pull_request', issue.id), {
        ...snapshot,
        pullRequests: [],
      }),
    ).toEqual({ kind: 'pull_request', saved: false });
  });

  it('does not resolve an issue id against tracked pull requests', () => {
    expect(
      resolveTarget(target('issue', pullRequest.id), {
        ...snapshot,
        issues: [],
      }),
    ).toEqual({ kind: 'issue', saved: false });
  });

  it('does not mutate the snapshot', () => {
    const before = structuredClone(snapshot);

    resolveTarget(target('issue', issue.id), snapshot);
    resolveTarget(target('pull_request', pullRequest.id), snapshot);

    expect(snapshot).toEqual(before);
  });
});
