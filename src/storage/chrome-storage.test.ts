import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueNote, SavedIssue } from '../domain/models';
import { META_KEY, issueStorageKey, noteStorageKey } from './keys';
import { createChromeStorageRepository } from './chrome-storage';

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

const note: IssueNote = {
  issueId: issue.id,
  body: 'Reproduce with strict mode enabled.',
  createdAt: '2026-10-19T09:20:00.000Z',
  updatedAt: '2026-10-19T09:25:30.000Z',
};

describe('chrome storage adapter', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('persists repository writes through chrome.storage.local', async () => {
    const repository = createChromeStorageRepository();

    await repository.saveIssue(issue);

    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      [META_KEY]: { schemaVersion: 1 },
      [issueStorageKey(issue.id)]: issue,
    });
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
  });

  it('loads records written directly to chrome.storage.local', async () => {
    await fakeBrowser.storage.local.set({
      [META_KEY]: { schemaVersion: 1 },
      [issueStorageKey(issue.id)]: issue,
      [noteStorageKey(issue.id)]: note,
    });
    const repository = createChromeStorageRepository();

    const result = await repository.loadSnapshot();

    expect(result).toEqual({
      ok: true,
      snapshot: {
        issues: [issue],
        pullRequests: [],
        notes: { [issue.id]: note },
        warnings: [],
      },
    });
  });

  it('removes an issue and note through the repository', async () => {
    const repository = createChromeStorageRepository();
    await repository.saveIssue(issue);
    await repository.saveNote(note);

    await repository.removeIssue(issue.id);

    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      [META_KEY]: { schemaVersion: 1 },
    });
  });

  it('notifies only for relevant local storage changes', async () => {
    const repository = createChromeStorageRepository();
    const listener = vi.fn();
    const unsubscribe = repository.subscribe(listener);

    await repository.saveIssue(issue);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({
      changedKeys: [issueStorageKey(issue.id), META_KEY],
    });

    await fakeBrowser.storage.local.set({ 'unrelated-key': true });
    await fakeBrowser.storage.sync.set({ 'sync-key': true });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await repository.saveNote(note);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
