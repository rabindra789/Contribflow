import { describe, expect, it } from 'vitest';
import type { IssueNote, SavedIssue, TrackedPullRequest } from '../domain/models';
import type { StorageSnapshot } from '../storage/repository';
import {
  dashboardCounts,
  formatDashboardTimestamp,
  hasActiveFilters,
  stateFilterOptions,
  stateLabel,
} from './dashboard-view';

const issue: SavedIssue = {
  id: 'microsoft/typescript#12345',
  owner: 'Microsoft',
  repo: 'TypeScript',
  number: 12345,
  url: 'https://github.com/Microsoft/TypeScript/issues/12345',
  title: 'Improve inference',
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
  title: 'Fix inference',
  state: 'draft',
  addedAt: '2026-10-19T10:00:00.000Z',
  lastSyncedAt: '2026-10-19T10:00:01.000Z',
  lastSyncError: null,
};

const note: IssueNote = {
  issueId: issue.id,
  body: 'Private note',
  createdAt: '2026-10-19T09:20:00.000Z',
  updatedAt: '2026-10-19T09:25:00.000Z',
};

const snapshot: StorageSnapshot = {
  issues: [issue],
  pullRequests: [pullRequest],
  notes: { [issue.id]: note },
  warnings: [],
};

describe('dashboard view helpers', () => {
  it('labels every issue and pull request state', () => {
    expect(stateLabel('open')).toBe('Open');
    expect(stateLabel('closed')).toBe('Closed');
    expect(stateLabel('draft')).toBe('Draft');
    expect(stateLabel('merged')).toBe('Merged');
    expect(stateLabel('unknown')).toBe('Unknown');
  });

  it('formats timestamps as deterministic UTC values', () => {
    expect(formatDashboardTimestamp('2026-10-19T09:15:02.120Z')).toBe(
      '2026-10-19 09:15 UTC',
    );
    expect(formatDashboardTimestamp('invalid')).toBe('Unknown time');
  });

  it('counts saved records and notes', () => {
    expect(dashboardCounts(snapshot)).toEqual({
      issues: 1,
      pullRequests: 1,
      notes: 1,
    });
  });

  it('offers only relevant state filters for issues', () => {
    expect(stateFilterOptions('issue').map((option) => option.value)).toEqual([
      'all',
      'open',
      'closed',
      'unknown',
    ]);
  });

  it('offers pull request state filters including draft and merged', () => {
    expect(
      stateFilterOptions('pull_request').map((option) => option.value),
    ).toEqual(['all', 'open', 'draft', 'closed', 'merged', 'unknown']);
  });

  it('detects active filters', () => {
    expect(
      hasActiveFilters({ query: '  ', type: 'all', state: 'all' }),
    ).toBe(false);
    expect(
      hasActiveFilters({ query: 'typescript', type: 'all', state: 'all' }),
    ).toBe(true);
    expect(
      hasActiveFilters({ query: '', type: 'issue', state: 'all' }),
    ).toBe(true);
    expect(
      hasActiveFilters({ query: '', type: 'all', state: 'open' }),
    ).toBe(true);
  });
});
