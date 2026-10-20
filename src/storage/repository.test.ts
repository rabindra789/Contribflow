import { describe, expect, it, vi } from 'vitest';
import type { IssueNote, SavedIssue, TrackedPullRequest } from '../domain/models';
import { META_KEY, issueStorageKey, noteStorageKey, pullRequestStorageKey } from './keys';
import { createMemoryStorageHarness } from './memory-storage';
import {
  StorageRepositoryError,
  type StorageErrorKind,
  type StorageRepository,
  type StorageSnapshot,
} from './repository';

const issueA: SavedIssue = {
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

const issueB: SavedIssue = {
  id: 'octocat/hello-world#7',
  owner: 'octocat',
  repo: 'hello-world',
  number: 7,
  url: 'https://github.com/octocat/hello-world/issues/7',
  title: 'Docs typo',
  state: 'closed',
  savedAt: '2026-10-19T08:00:00.000Z',
  lastSyncedAt: '2026-10-19T08:00:01.000Z',
  lastSyncError: null,
};

const pullRequest: TrackedPullRequest = {
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

const note: IssueNote = {
  issueId: issueA.id,
  body: 'Reproduce with strict mode enabled.\nCheck the related discussion in #12200.',
  createdAt: '2026-10-19T09:20:00.000Z',
  updatedAt: '2026-10-19T09:25:30.000Z',
};

const meta = { schemaVersion: 1 };

async function load(repository: StorageRepository): Promise<StorageSnapshot> {
  const result = await repository.loadSnapshot();
  if (!result.ok) {
    throw new Error(`expected a snapshot, received ${result.error.kind}`);
  }
  return result.snapshot;
}

async function expectStorageError(
  action: Promise<unknown>,
  kind: StorageErrorKind,
): Promise<StorageRepositoryError> {
  try {
    await action;
  } catch (error) {
    if (!(error instanceof StorageRepositoryError)) {
      throw error;
    }
    expect(error.kind).toBe(kind);
    return error;
  }
  throw new Error(`expected a ${kind} error`);
}

describe('empty storage and round trips', () => {
  it('loads an empty dataset without writing metadata', async () => {
    const { port, repository } = createMemoryStorageHarness();

    expect(await load(repository)).toEqual({
      issues: [],
      pullRequests: [],
      notes: {},
      warnings: [],
    });
    expect(port.setCalls).toBe(0);
    expect(port.removeCalls).toBe(0);
  });

  it('saves issues, pull requests, and notes and loads them back', async () => {
    const { port, repository } = createMemoryStorageHarness();

    await repository.saveIssue(issueA);
    expect(port.get(META_KEY)).toEqual(meta);
    await repository.savePullRequest(pullRequest);
    await repository.saveNote(note);

    const snapshot = await load(repository);
    expect(snapshot.issues).toEqual([issueA]);
    expect(snapshot.pullRequests).toEqual([pullRequest]);
    expect(snapshot.notes).toEqual({ [issueA.id]: note });
    expect(snapshot.warnings).toEqual([]);
  });

  it('initializes the meta key in the same write as the first record', async () => {
    const { port, repository } = createMemoryStorageHarness();
    await repository.saveIssue(issueA);
    expect(port.setCalls).toBe(1);
    expect(port.keys()).toEqual(expect.arrayContaining([META_KEY, issueStorageKey(issueA.id)]));
  });
});

describe('duplicate saves and refreshes', () => {
  it('treats a duplicate issue save as a no-op and never touches the note', async () => {
    const { port, repository } = createMemoryStorageHarness();
    await repository.saveIssue(issueA);
    await repository.saveNote(note);
    const writesBefore = port.setCalls;

    await repository.saveIssue({
      ...issueA,
      title: 'A different title',
      lastSyncedAt: '2026-10-19T11:00:00.000Z',
    });

    expect(port.setCalls).toBe(writesBefore);
    const snapshot = await load(repository);
    expect(snapshot.issues).toEqual([issueA]);
    expect(snapshot.notes[issueA.id]).toEqual(note);
  });

  it('blocks a duplicate save over an invalid existing record instead of overwriting it', async () => {
    const key = issueStorageKey(issueA.id);
    const raw = { ...issueA, title: 42 };
    const { port, repository } = createMemoryStorageHarness({ [META_KEY]: meta, [key]: raw });

    await expectStorageError(repository.saveIssue(issueA), 'corrupt-record');
    expect(port.get(key)).toEqual(raw);
    expect(port.setCalls).toBe(0);
  });

  it('refreshes pull request metadata while preserving addedAt and skipping identical writes', async () => {
    const key = pullRequestStorageKey(pullRequest.id);
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [key]: pullRequest,
    });
    const refreshed = {
      ...pullRequest,
      title: 'Merged routing fix',
      state: 'merged' as const,
      addedAt: '2026-10-19T11:00:00.000Z',
      lastSyncedAt: '2026-10-19T11:00:02.000Z',
    };

    await repository.savePullRequest(refreshed);
    expect(port.get(key)).toEqual({
      ...pullRequest,
      title: 'Merged routing fix',
      state: 'merged',
      lastSyncedAt: '2026-10-19T11:00:02.000Z',
    });

    const writesAfterRefresh = port.setCalls;
    await repository.savePullRequest(refreshed);
    expect(port.setCalls).toBe(writesAfterRefresh);
  });

  it('rejects invalid input records before touching storage', async () => {
    const { port, repository } = createMemoryStorageHarness();

    await expectStorageError(
      repository.saveIssue({ ...issueA, state: 'merged' as never }),
      'invalid-record',
    );
    await expectStorageError(
      repository.savePullRequest({ ...pullRequest, url: 'not-a-url' }),
      'invalid-record',
    );
    await expectStorageError(repository.saveNote({ ...note, body: '   ' }), 'invalid-record');

    expect(port.setCalls).toBe(0);
    expect(port.readCalls).toBe(0);
  });
});

describe('issue updates', () => {
  it('updates an existing issue while preserving savedAt and its note', async () => {
    const key = issueStorageKey(issueA.id);
    const noteKey = noteStorageKey(issueA.id);
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [key]: issueA,
      [noteKey]: note,
    });
    const refreshed: SavedIssue = {
      ...issueA,
      title: 'Refreshed title',
      state: 'closed',
      savedAt: '2026-10-19T09:00:00.000Z',
      lastSyncedAt: '2026-10-19T10:00:00.000Z',
      lastSyncError: null,
    };

    await repository.updateIssue(refreshed);

    expect(port.get(key)).toEqual({ ...refreshed, savedAt: issueA.savedAt });
    expect(port.get(noteKey)).toEqual(note);
    expect(port.setCalls).toBe(1);
  });

  it('records a sync error without changing successful metadata', async () => {
    const key = issueStorageKey(issueA.id);
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [key]: issueA,
    });

    await repository.updateIssue({ ...issueA, lastSyncError: 'GitHub request timed out.' });

    expect(port.get(key)).toEqual({ ...issueA, lastSyncError: 'GitHub request timed out.' });
  });

  it('skips an identical issue update', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [issueStorageKey(issueA.id)]: issueA,
    });

    await repository.updateIssue(issueA);

    expect(port.setCalls).toBe(0);
  });

  it('requires the issue to already exist', async () => {
    const { port, repository } = createMemoryStorageHarness({ [META_KEY]: meta });

    await expectStorageError(repository.updateIssue(issueA), 'missing-issue');
    expect(port.setCalls).toBe(0);
  });

  it('blocks updates over an invalid existing record', async () => {
    const key = issueStorageKey(issueA.id);
    const raw = { ...issueA, title: 42 };
    const { port, repository } = createMemoryStorageHarness({ [META_KEY]: meta, [key]: raw });

    await expectStorageError(repository.updateIssue(issueA), 'corrupt-record');
    expect(port.get(key)).toEqual(raw);
    expect(port.setCalls).toBe(0);
  });

  it('rejects invalid update input before reading storage', async () => {
    const { port, repository } = createMemoryStorageHarness({ [META_KEY]: meta });

    await expectStorageError(
      repository.updateIssue({ ...issueA, url: pullRequest.url }),
      'invalid-record',
    );
    expect(port.readCalls).toBe(0);
    expect(port.setCalls).toBe(0);
  });
});

describe('notes', () => {
  it('upserts a note, preserves createdAt, and skips unchanged writes', async () => {
    const key = noteStorageKey(issueA.id);
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [issueStorageKey(issueA.id)]: issueA,
    });

    await repository.saveNote(note);
    expect(port.get(key)).toEqual(note);

    const updated = {
      ...note,
      body: 'Updated reproduction steps.',
      createdAt: '2026-10-19T10:00:00.000Z',
      updatedAt: '2026-10-19T10:05:00.000Z',
    };
    await repository.saveNote(updated);
    expect(port.get(key)).toEqual({ ...updated, createdAt: note.createdAt });

    const writesAfterUpdate = port.setCalls;
    await repository.saveNote({ ...updated, createdAt: note.createdAt });
    expect(port.setCalls).toBe(writesAfterUpdate);
  });

  it('rejects a note update whose updatedAt predates the stored createdAt', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [issueStorageKey(issueA.id)]: issueA,
      [noteStorageKey(issueA.id)]: note,
    });
    const writesBefore = port.setCalls;

    await expectStorageError(
      repository.saveNote({
        ...note,
        body: 'New body',
        createdAt: '2026-10-19T09:00:00.000Z',
        updatedAt: '2026-10-19T09:10:00.000Z',
      }),
      'invalid-record',
    );

    expect(port.setCalls).toBe(writesBefore);
    expect(port.get(noteStorageKey(issueA.id))).toEqual(note);
  });

  it('requires a saved issue before writing a note', async () => {
    const { port, repository } = createMemoryStorageHarness();
    await expectStorageError(repository.saveNote(note), 'missing-issue');
    expect(port.setCalls).toBe(0);
    expect(port.has(META_KEY)).toBe(false);
  });

  it('blocks note writes over an invalid existing note', async () => {
    const noteKey = noteStorageKey(issueA.id);
    const raw = { ...note, body: '' };
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [issueStorageKey(issueA.id)]: issueA,
      [noteKey]: raw,
    });

    await expectStorageError(repository.saveNote(note), 'corrupt-record');
    expect(port.get(noteKey)).toEqual(raw);
    expect(port.setCalls).toBe(0);
  });

  it('removes only the note when delete-note is requested', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [issueStorageKey(issueA.id)]: issueA,
      [noteStorageKey(issueA.id)]: note,
    });

    await repository.removeNote(issueA.id);
    expect(port.has(noteStorageKey(issueA.id))).toBe(false);
    expect(port.has(issueStorageKey(issueA.id))).toBe(true);
    expect(port.removeCalls).toBe(1);

    const writesBefore = port.removeCalls;
    await repository.removeNote(issueA.id);
    expect(port.removeCalls).toBe(writesBefore);
  });
});

describe('removal', () => {
  it('removes an issue and its note in a single storage call', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [issueStorageKey(issueA.id)]: issueA,
      [noteStorageKey(issueA.id)]: note,
    });

    await repository.removeIssue(issueA.id);

    expect(port.removeCalls).toBe(1);
    expect(port.has(issueStorageKey(issueA.id))).toBe(false);
    expect(port.has(noteStorageKey(issueA.id))).toBe(false);
  });

  it('removes an orphan note when its issue is removed', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [noteStorageKey(issueA.id)]: note,
    });

    await repository.removeIssue(issueA.id);

    expect(port.has(noteStorageKey(issueA.id))).toBe(false);
    expect(port.removeCalls).toBe(1);
  });

  it('is a no-op when nothing exists to remove', async () => {
    const { port, repository } = createMemoryStorageHarness();

    await repository.removeIssue(issueA.id);
    await repository.removePullRequest(pullRequest.id);
    await repository.removeNote(issueA.id);

    expect(port.removeCalls).toBe(0);
  });

  it('removes a tracked pull request without touching issues or notes', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [issueStorageKey(issueA.id)]: issueA,
      [noteStorageKey(issueA.id)]: note,
      [pullRequestStorageKey(pullRequest.id)]: pullRequest,
    });

    await repository.removePullRequest(pullRequest.id);

    expect(port.has(pullRequestStorageKey(pullRequest.id))).toBe(false);
    expect(port.has(issueStorageKey(issueA.id))).toBe(true);
    expect(port.has(noteStorageKey(issueA.id))).toBe(true);
  });

  it('preserves unrelated keys and other entities', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [issueStorageKey(issueA.id)]: issueA,
      [noteStorageKey(issueA.id)]: note,
      [pullRequestStorageKey(pullRequest.id)]: pullRequest,
      'unrelated-key': { keep: true },
      'other.extension.key': 'keep',
    });

    await repository.removeIssue(issueA.id);
    await repository.saveIssue(issueB);

    expect(port.has(pullRequestStorageKey(pullRequest.id))).toBe(true);
    expect(port.get('unrelated-key')).toEqual({ keep: true });
    expect(port.get('other.extension.key')).toBe('keep');
    expect(port.has(issueStorageKey(issueB.id))).toBe(true);
  });
});

describe('malformed records and metadata', () => {
  it('skips malformed records without deleting them and reports warnings', async () => {
    const invalidIssueKey = issueStorageKey(issueB.id);
    const orphanNoteKey = noteStorageKey(issueB.id);
    const unknownKey = 'contribflow.v1.bogus.value';
    const futureKey = `contribflow.v2.issue.${issueA.id}`;
    const invalidIssue = { ...issueB, title: 42 };
    const orphanNote = { ...note, issueId: issueB.id };

    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [issueStorageKey(issueA.id)]: issueA,
      [noteStorageKey(issueA.id)]: note,
      [invalidIssueKey]: invalidIssue,
      [orphanNoteKey]: orphanNote,
      [unknownKey]: { value: true },
      [futureKey]: issueA,
      'unrelated-key': 'ignored',
    });

    const snapshot = await load(repository);

    expect(snapshot.issues).toEqual([issueA]);
    expect(snapshot.notes).toEqual({ [issueA.id]: note });
    expect(snapshot.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'invalid-record', storageKey: invalidIssueKey }),
        expect.objectContaining({ kind: 'orphan-note', issueId: issueB.id }),
        expect.objectContaining({ kind: 'invalid-record', storageKey: unknownKey }),
        expect.objectContaining({ kind: 'invalid-record', storageKey: futureKey }),
      ]),
    );
    expect(snapshot.warnings).toHaveLength(4);
    expect(port.setCalls).toBe(0);
    expect(port.removeCalls).toBe(0);
    expect(port.has(invalidIssueKey)).toBe(true);
    expect(port.has(orphanNoteKey)).toBe(true);
    expect(port.has(unknownKey)).toBe(true);
    expect(port.has(futureKey)).toBe(true);
  });

  it('fails with corrupt-metadata when data exists without metadata and blocks writes', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [issueStorageKey(issueA.id)]: issueA,
    });

    const result = await repository.loadSnapshot();
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: 'corrupt-metadata' }),
    });
    await expectStorageError(repository.saveIssue(issueB), 'corrupt-metadata');
    await expectStorageError(repository.removeIssue(issueA.id), 'corrupt-metadata');
    expect(port.setCalls).toBe(0);
    expect(port.removeCalls).toBe(0);
  });

  it('fails with corrupt-metadata for malformed metadata', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: { schemaVersion: '1' },
      [issueStorageKey(issueA.id)]: issueA,
    });

    const result = await repository.loadSnapshot();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('corrupt-metadata');
    }
    await expectStorageError(repository.saveIssue(issueB), 'corrupt-metadata');
    expect(port.setCalls).toBe(0);
  });

  it('blocks reads and writes for a newer schema without overwriting it', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: { schemaVersion: 2 },
      [issueStorageKey(issueA.id)]: issueA,
    });

    const result = await repository.loadSnapshot();
    expect(result).toEqual({
      ok: false,
      error: { kind: 'unsupported-schema', found: 2, supported: 1 },
    });

    await expectStorageError(repository.saveIssue(issueB), 'unsupported-schema');
    await expectStorageError(repository.removeIssue(issueA.id), 'unsupported-schema');
    expect(port.get(META_KEY)).toEqual({ schemaVersion: 2 });
    expect(port.has(issueStorageKey(issueA.id))).toBe(true);
    expect(port.setCalls).toBe(0);
    expect(port.removeCalls).toBe(0);
  });

  it('does not migrate or write during an ordinary snapshot read', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [issueStorageKey(issueA.id)]: issueA,
    });

    await load(repository);
    expect(port.setCalls).toBe(0);
  });
});

describe('storage failures', () => {
  it('reports quota errors and recovers on the next write', async () => {
    const { port, repository } = createMemoryStorageHarness();
    port.failSet = new Error('QUOTA_BYTES quota exceeded');

    const error = await expectStorageError(repository.saveIssue(issueA), 'quota-exceeded');
    expect(error.message).toContain('quota');
    expect(port.get(issueStorageKey(issueA.id))).toBeUndefined();

    port.failSet = null;
    await repository.saveIssue(issueA);
    expect(port.get(issueStorageKey(issueA.id))).toEqual(issueA);
  });

  it('maps other write failures to unavailable', async () => {
    const { port, repository } = createMemoryStorageHarness();
    port.failSet = new Error('disk write failed');

    await expectStorageError(repository.saveIssue(issueA), 'unavailable');
  });

  it('surfaces read failures without throwing from loadSnapshot', async () => {
    const { port, repository } = createMemoryStorageHarness();
    port.failRead = new Error('storage unavailable');

    const result = await repository.loadSnapshot();
    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: expect.stringContaining('storage unavailable') },
    });
    await expectStorageError(repository.saveIssue(issueA), 'unavailable');
    expect(port.setCalls).toBe(0);
  });

  it('surfaces remove failures and preserves the data', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [issueStorageKey(issueA.id)]: issueA,
      [noteStorageKey(issueA.id)]: note,
    });
    port.failRemove = new Error('remove failed');

    await expectStorageError(repository.removeIssue(issueA.id), 'unavailable');
    expect(port.has(issueStorageKey(issueA.id))).toBe(true);
    expect(port.has(noteStorageKey(issueA.id))).toBe(true);
  });
});

describe('concurrency', () => {
  it('serializes writes so read-modify-write commands cannot interleave', async () => {
    const { port, repository } = createMemoryStorageHarness();
    port.beforeSet = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    };

    await Promise.all([
      repository.saveIssue(issueA),
      repository.savePullRequest(pullRequest),
      repository.saveNote(note),
    ]);

    expect(port.maxActiveWrites).toBe(1);
    const snapshot = await load(repository);
    expect(snapshot.issues).toEqual([issueA]);
    expect(snapshot.pullRequests).toEqual([pullRequest]);
    expect(snapshot.notes[issueA.id]).toEqual(note);
  });

  it('serializes note creation before a queued removal', async () => {
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [issueStorageKey(issueA.id)]: issueA,
    });

    await Promise.all([repository.saveNote(note), repository.removeIssue(issueA.id)]);

    const snapshot = await load(repository);
    expect(snapshot.issues).toEqual([]);
    expect(snapshot.notes).toEqual({});
    expect(snapshot.warnings).toEqual([]);
    expect(port.removeCalls).toBe(1);
  });

  it('applies concurrent pull request refreshes in enqueue order', async () => {
    const key = pullRequestStorageKey(pullRequest.id);
    const { port, repository } = createMemoryStorageHarness({
      [META_KEY]: meta,
      [key]: pullRequest,
    });

    await Promise.all([
      repository.savePullRequest({
        ...pullRequest,
        state: 'open',
        lastSyncedAt: '2026-10-19T11:00:00.000Z',
      }),
      repository.savePullRequest({
        ...pullRequest,
        state: 'closed',
        lastSyncedAt: '2026-10-19T11:00:01.000Z',
      }),
    ]);

    expect(port.get(key)).toEqual(
      expect.objectContaining({ state: 'closed', lastSyncedAt: '2026-10-19T11:00:01.000Z' }),
    );
    expect(port.maxActiveWrites).toBe(1);
  });
});

describe('change subscription', () => {
  it('reports only ContribFlow keys and can be unsubscribed', () => {
    const { port, repository } = createMemoryStorageHarness();
    const listener = vi.fn();
    const unsubscribe = repository.subscribe(listener);

    port.emitChange(['unrelated-key', issueStorageKey(issueA.id), META_KEY]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      changedKeys: [issueStorageKey(issueA.id), META_KEY],
    });

    port.emitChange(['unrelated-key']);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    port.emitChange([issueStorageKey(issueA.id)]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
