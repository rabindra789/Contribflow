import { describe, expect, it } from 'vitest';
import type { IssueNote, SavedIssue, TrackedPullRequest } from './models';
import {
  isCanonicalTimestamp,
  parseIssueNote,
  parseSavedIssue,
  parseSchemaVersion,
  parseStorageMeta,
  parseTrackedPullRequest,
} from './validation';

const issueKey = (id: string) => `contribflow.v1.issue.${id}`;
const pullRequestKey = (id: string) => `contribflow.v1.pr.${id}`;

const baseIssue: SavedIssue = {
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

const basePullRequest: TrackedPullRequest = {
  id: 'vercel/next.js#67890',
  owner: 'vercel',
  repo: 'next.js',
  number: 67890,
  url: 'https://github.com/vercel/next.js/pull/67890',
  title: 'Fix routing regression',
  state: 'draft',
  addedAt: '2026-10-19T10:00:00.000Z',
  lastSyncedAt: '2026-10-19T10:00:01.450Z',
  lastSyncError: null,
};

const baseNote: IssueNote = {
  issueId: baseIssue.id,
  body: 'Reproduce with strict mode enabled.\nCheck the related discussion in #12200.',
  createdAt: '2026-10-19T09:20:00.000Z',
  updatedAt: '2026-10-19T09:25:30.000Z',
};

function asRecord(value: object): Record<string, unknown> {
  return { ...value };
}

describe('parseSavedIssue', () => {
  it('accepts a valid issue, ignores unknown fields, and returns only typed fields', () => {
    const result = parseSavedIssue(issueKey(baseIssue.id), {
      ...baseIssue,
      unknownField: 'ignored',
    });

    expect(result).toEqual({ ok: true, value: baseIssue });
  });

  it('accepts an unfetched issue with unknown metadata', () => {
    const result = parseSavedIssue(issueKey(baseIssue.id), {
      ...baseIssue,
      title: null,
      state: 'unknown',
      lastSyncedAt: null,
      lastSyncError: 'Metadata unavailable',
    });

    expect(result.ok).toBe(true);
  });

  it.each([
    ['id', 'Microsoft/typescript#12345'],
    ['id', 'microsoft/typescript#54321'],
    ['id', 'microsoft/typescript'],
    ['owner', 'Microsoft-'],
    ['owner', '-Microsoft'],
    ['owner', 'a'.repeat(40)],
    ['repo', '..'],
    ['repo', 'a'.repeat(101)],
    ['number', 0],
    ['number', 1.5],
    ['number', 2147483648],
    ['url', 'http://github.com/Microsoft/TypeScript/issues/12345'],
    ['url', 'https://gitlab.com/Microsoft/TypeScript/issues/12345'],
    ['url', 'https://github.com/Microsoft/TypeScript/pull/12345'],
    ['url', 'https://github.com/Microsoft/TypeScript/issues/54321'],
    ['url', 'https://github.com/Microsoft/TypeScript/issues/12345/'],
    ['url', 'https://github.com/Microsoft/TypeScript/issues/12345?tab=readme'],
    ['url', 'https://github.com/microsoft/typescript/issues/12345'],
    ['title', ''],
    ['title', 'a'.repeat(513)],
    ['title', 'bad\u0000title'],
    ['title', 42],
    ['state', 'draft'],
    ['state', 'merged'],
    ['state', 'OPEN'],
    ['savedAt', '2026-10-19T09:15:00Z'],
    ['savedAt', '2026-10-19T09:15:00.000+00:00'],
    ['savedAt', '2026-02-30T00:00:00.000Z'],
    ['savedAt', '2026-02-29T00:00:00.000Z'],
    ['savedAt', 1234567890],
    ['lastSyncedAt', '2026-10-19T09:14:59.999Z'],
    ['lastSyncedAt', 'not-a-time'],
    ['lastSyncError', ''],
    ['lastSyncError', 'a'.repeat(301)],
    ['lastSyncError', 12],
  ] as const)('rejects %s = %s', (field, value) => {
    const candidate = { ...asRecord(baseIssue), [field]: value };
    const result = parseSavedIssue(issueKey(baseIssue.id), candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['title', 'metadata title'],
    ['lastSyncedAt', '2026-10-19T09:15:02.120Z'],
  ] as const)('rejects unknown state with non-null %s', (field, value) => {
    const result = parseSavedIssue(issueKey(baseIssue.id), {
      ...asRecord(baseIssue),
      state: 'unknown',
      title: null,
      lastSyncedAt: null,
      lastSyncError: 'Metadata unavailable',
      [field]: value,
    });

    expect(result.ok).toBe(false);
  });

  it('rejects unknown state without a sync error', () => {
    const result = parseSavedIssue(issueKey(baseIssue.id), {
      ...asRecord(baseIssue),
      state: 'unknown',
      title: null,
      lastSyncedAt: null,
      lastSyncError: null,
    });

    expect(result.ok).toBe(false);
  });

  it('rejects records whose storage key does not belong to the entry', () => {
    expect(parseSavedIssue('contribflow.v1.meta', baseIssue).ok).toBe(false);
    expect(parseSavedIssue(pullRequestKey(baseIssue.id), baseIssue).ok).toBe(false);
    expect(parseSavedIssue(issueKey('other/repo#1'), baseIssue).ok).toBe(false);
  });

  it.each([null, undefined, [], 'record', 42])('rejects non-object value %s without throwing', (value) => {
    expect(() => parseSavedIssue(issueKey(baseIssue.id), value)).not.toThrow();
    expect(parseSavedIssue(issueKey(baseIssue.id), value).ok).toBe(false);
  });
});

describe('parseTrackedPullRequest', () => {
  it('accepts a valid pull request', () => {
    expect(parseTrackedPullRequest(pullRequestKey(basePullRequest.id), basePullRequest)).toEqual({
      ok: true,
      value: basePullRequest,
    });
  });

  it.each(['open', 'draft', 'closed', 'merged'] as const)('accepts state %s', (state) => {
    const result = parseTrackedPullRequest(pullRequestKey(basePullRequest.id), {
      ...basePullRequest,
      state,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts an unfetched pull request with unknown metadata', () => {
    const result = parseTrackedPullRequest(pullRequestKey(basePullRequest.id), {
      ...basePullRequest,
      title: null,
      state: 'unknown',
      lastSyncedAt: null,
      lastSyncError: 'Metadata unavailable',
    });

    expect(result.ok).toBe(true);
  });

  it.each([
    ['state', 'pending'],
    ['state', 'OPEN'],
    ['title', ''],
    ['number', 0],
    ['url', 'https://github.com/vercel/next.js/issues/67890'],
    ['url', 'https://github.com/vercel/next.js/pull/67890/files'],
    ['addedAt', '2026-10-19T10:00:00Z'],
    ['lastSyncedAt', '2026-10-19T09:59:59.999Z'],
    ['lastSyncError', 'a'.repeat(301)],
  ] as const)('rejects %s = %s', (field, value) => {
    const result = parseTrackedPullRequest(pullRequestKey(basePullRequest.id), {
      ...basePullRequest,
      [field]: value,
    });

    expect(result.ok).toBe(false);
  });

  it('rejects an issue URL and an issue storage key', () => {
    expect(
      parseTrackedPullRequest(pullRequestKey(basePullRequest.id), {
        ...basePullRequest,
        url: 'https://github.com/vercel/next.js/issues/67890',
      }).ok,
    ).toBe(false);
    expect(parseTrackedPullRequest(issueKey(basePullRequest.id), basePullRequest).ok).toBe(false);
  });
});

describe('parseIssueNote', () => {
  it('accepts a valid note and ignores unknown fields', () => {
    expect(parseIssueNote({ ...baseNote, extra: true })).toEqual({ ok: true, value: baseNote });
  });

  it('accepts bodies at the 10,000 UTF-16 code unit limit', () => {
    const result = parseIssueNote({ ...baseNote, body: 'a'.repeat(10_000) });
    expect(result.ok).toBe(true);
  });

  it.each([
    ['issueId', 'Microsoft/typescript#12345'],
    ['issueId', 'microsoft/typescript'],
    ['body', '   \n\t '],
    ['body', ''],
    ['body', 'a'.repeat(10_001)],
    ['body', 42],
    ['createdAt', '2026-10-19T09:20:00Z'],
    ['updatedAt', '2026-10-19T09:19:59.999Z'],
    ['updatedAt', 'not-a-time'],
  ] as const)('rejects %s = %s', (field, value) => {
    const result = parseIssueNote({ ...baseNote, [field]: value });
    expect(result.ok).toBe(false);
  });

  it.each([null, undefined, [], 'note'])('rejects non-object value %s', (value) => {
    expect(parseIssueNote(value).ok).toBe(false);
  });
});

describe('schema metadata', () => {
  it('accepts schema version 1 and ignores extra fields', () => {
    expect(parseStorageMeta({ schemaVersion: 1, extra: true })).toEqual({
      ok: true,
      value: { schemaVersion: 1 },
    });
    expect(parseSchemaVersion({ schemaVersion: 7 })).toEqual({ ok: true, value: 7 });
  });

  it('rejects newer schema versions in the strict record parser', () => {
    expect(parseStorageMeta({ schemaVersion: 2 }).ok).toBe(false);
  });

  it.each([0, -1, 1.5, '1', null, {}, { schemaVersion: null }])(
    'rejects malformed metadata %s',
    (value) => {
      expect(parseStorageMeta(value).ok).toBe(false);
      expect(parseSchemaVersion(value).ok).toBe(false);
    },
  );
});

describe('canonical timestamps', () => {
  it.each([
    '2026-10-19T12:34:56.789Z',
    '2028-02-29T00:00:00.000Z',
    '1970-01-01T00:00:00.000Z',
  ])('accepts %s', (value) => {
    expect(isCanonicalTimestamp(value)).toBe(true);
  });

  it.each([
    '2026-10-19T12:34:56Z',
    '2026-10-19T12:34:56.789+00:00',
    '2026-10-19T12:34:56.789',
    '2026-02-30T00:00:00.000Z',
    '2026-13-01T00:00:00.000Z',
    'not-a-time',
    0,
    null,
  ])('rejects %s', (value) => {
    expect(isCanonicalTimestamp(value)).toBe(false);
  });
});
