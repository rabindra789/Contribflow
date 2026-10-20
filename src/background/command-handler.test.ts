import { describe, expect, it, vi } from 'vitest';
import type {
  GitHubClient,
  GitHubIssueMetadata,
  GitHubPullRequestMetadata,
  GitHubTargetRef,
} from '../github/client';
import { GitHubClientError } from '../github/errors';
import type { IssueNote, SavedIssue, TrackedPullRequest } from '../domain/models';
import type {
  CommandError,
  CommandResponse,
  RefreshIssueData,
  RefreshPullRequestData,
  SaveIssueData,
  SaveNoteData,
  TrackPullRequestData,
} from '../messaging/contracts';
import {
  createMemoryStorageHarness,
  type MemoryStorageHarness,
} from '../storage/memory-storage';
import {
  StorageRepositoryError,
  type StorageRepository,
  type StorageSnapshot,
} from '../storage/repository';
import { createCommandHandler, type CommandHandler } from './command-handler';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const LATER = new Date('2026-10-20T12:10:00.000Z');
const ISSUE_URL = 'https://github.com/octocat/Hello-World/issues/42';
const ISSUE_ID = 'octocat/hello-world#42';
const PULL_REQUEST_URL = 'https://github.com/octocat/Hello-World/pull/7';
const PULL_REQUEST_ID = 'octocat/hello-world#7';

function savedIssue(overrides: Partial<SavedIssue> = {}): SavedIssue {
  return {
    id: ISSUE_ID,
    owner: 'octocat',
    repo: 'Hello-World',
    number: 42,
    url: ISSUE_URL,
    title: 'Old issue title',
    state: 'open',
    savedAt: '2026-10-19T10:00:00.000Z',
    lastSyncedAt: '2026-10-19T10:05:00.000Z',
    lastSyncError: null,
    ...overrides,
  };
}

function trackedPullRequest(
  overrides: Partial<TrackedPullRequest> = {},
): TrackedPullRequest {
  return {
    id: PULL_REQUEST_ID,
    owner: 'octocat',
    repo: 'Hello-World',
    number: 7,
    url: PULL_REQUEST_URL,
    title: 'Old pull request title',
    state: 'open',
    addedAt: '2026-10-19T10:00:00.000Z',
    lastSyncedAt: '2026-10-19T10:05:00.000Z',
    lastSyncError: null,
    ...overrides,
  };
}

function issueNote(overrides: Partial<IssueNote> = {}): IssueNote {
  return {
    issueId: ISSUE_ID,
    body: 'Existing note',
    createdAt: '2026-10-19T10:02:00.000Z',
    updatedAt: '2026-10-19T10:02:00.000Z',
    ...overrides,
  };
}

interface GitHubStub {
  client: GitHubClient;
  issueCalls: GitHubTargetRef[];
  pullRequestCalls: GitHubTargetRef[];
  setIssueHandler(
    handler: (target: GitHubTargetRef) => Promise<GitHubIssueMetadata>,
  ): void;
  setPullRequestHandler(
    handler: (target: GitHubTargetRef) => Promise<GitHubPullRequestMetadata>,
  ): void;
}

function createGitHubStub(): GitHubStub {
  const issueCalls: GitHubTargetRef[] = [];
  const pullRequestCalls: GitHubTargetRef[] = [];
  let issueHandler = async (target: GitHubTargetRef): Promise<GitHubIssueMetadata> => ({
    number: target.number,
    title: 'Updated issue title',
    state: 'closed',
  });
  let pullRequestHandler = async (
    target: GitHubTargetRef,
  ): Promise<GitHubPullRequestMetadata> => ({
    number: target.number,
    title: 'Updated pull request title',
    state: 'merged',
  });

  return {
    issueCalls,
    pullRequestCalls,
    setIssueHandler(handler) {
      issueHandler = handler;
    },
    setPullRequestHandler(handler) {
      pullRequestHandler = handler;
    },
    client: {
      async fetchIssue(target) {
        issueCalls.push(target);
        return issueHandler(target);
      },
      async fetchPullRequest(target) {
        pullRequestCalls.push(target);
        return pullRequestHandler(target);
      },
    },
  };
}

interface SetupResult {
  harness: MemoryStorageHarness;
  repository: StorageRepository;
  github: GitHubStub;
  handler: CommandHandler;
  clock: { current: Date };
}

async function setup(
  seed: {
    issues?: SavedIssue[];
    pullRequests?: TrackedPullRequest[];
    notes?: IssueNote[];
  } = {},
): Promise<SetupResult> {
  const harness = createMemoryStorageHarness();
  for (const issue of seed.issues ?? []) {
    await harness.repository.saveIssue(issue);
  }
  for (const pullRequest of seed.pullRequests ?? []) {
    await harness.repository.savePullRequest(pullRequest);
  }
  for (const note of seed.notes ?? []) {
    await harness.repository.saveNote(note);
  }

  const github = createGitHubStub();
  const clock = { current: NOW };
  const handler = createCommandHandler({
    repository: harness.repository,
    github: github.client,
    now: () => clock.current,
  });

  return {
    harness,
    repository: harness.repository,
    github,
    handler,
    clock,
  };
}

async function loadSnapshot(repository: StorageRepository): Promise<StorageSnapshot> {
  const result = await repository.loadSnapshot();
  if (!result.ok) {
    throw new Error(`snapshot failed: ${result.error.kind}`);
  }
  return result.snapshot;
}

function expectSuccess<T>(result: CommandResponse): T {
  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }
  return result.data as T;
}

function expectFailure(result: CommandResponse): CommandError {
  if (result.ok) {
    throw new Error('expected a command failure');
  }
  return result.error;
}

describe('get snapshot', () => {
  it('returns saved issues, pull requests, notes, and warnings', async () => {
    const issue = savedIssue();
    const pullRequest = trackedPullRequest();
    const note = issueNote();
    const { handler } = await setup({
      issues: [issue],
      pullRequests: [pullRequest],
      notes: [note],
    });

    const result = await handler.handle({ type: 'GET_SNAPSHOT' });
    const snapshot = expectSuccess<StorageSnapshot>(result);

    expect(snapshot.issues).toEqual([issue]);
    expect(snapshot.pullRequests).toEqual([pullRequest]);
    expect(snapshot.notes).toEqual({ [ISSUE_ID]: note });
    expect(snapshot.warnings).toEqual([]);
  });

  it('returns a structured storage error when the snapshot cannot load', async () => {
    const { handler, repository } = await setup();
    vi.spyOn(repository, 'loadSnapshot').mockResolvedValueOnce({
      ok: false,
      error: { kind: 'unavailable', message: 'raw storage detail' },
    });

    const error = expectFailure(await handler.handle({ type: 'GET_SNAPSHOT' }));

    expect(error).toEqual({
      code: 'storage-unavailable',
      message: 'Extension storage is unavailable.',
    });
  });

  it('maps unexpected load exceptions to internal errors without leaking messages', async () => {
    const { handler, repository } = await setup();
    vi.spyOn(repository, 'loadSnapshot').mockRejectedValueOnce(
      new Error('secret detail'),
    );

    const error = expectFailure(await handler.handle({ type: 'GET_SNAPSHOT' }));

    expect(error).toEqual({
      code: 'internal',
      message: 'An unexpected error occurred.',
    });
  });
});

describe('invalid commands', () => {
  it('rejects malformed messages without touching storage or GitHub', async () => {
    const { handler, repository, github } = await setup();

    const error = expectFailure(await handler.handle({ type: 'SAVE_ISSUE' }));

    expect(error.code).toBe('invalid-command');
    expect(github.issueCalls).toHaveLength(0);
    expect((await loadSnapshot(repository)).issues).toHaveLength(0);
  });
});

describe('saving issues', () => {
  it('saves a placeholder and stores fetched metadata', async () => {
    const { handler, repository, github, clock } = await setup();

    const data = expectSuccess<SaveIssueData>(
      await handler.handle({ type: 'SAVE_ISSUE', url: ISSUE_URL }),
    );

    expect(data.created).toBe(true);
    expect(data.syncError).toBeNull();
    expect(data.issue).toMatchObject({
      id: ISSUE_ID,
      owner: 'octocat',
      repo: 'Hello-World',
      number: 42,
      url: ISSUE_URL,
      title: 'Updated issue title',
      state: 'closed',
      savedAt: clock.current.toISOString(),
      lastSyncedAt: clock.current.toISOString(),
      lastSyncError: null,
    });
    expect(github.issueCalls).toEqual([
      { owner: 'octocat', repo: 'Hello-World', number: 42 },
    ]);

    const snapshot = await loadSnapshot(repository);
    expect(snapshot.issues).toEqual([data.issue]);
  });

  it('keeps the saved placeholder when metadata fetch fails', async () => {
    const { handler, repository, github } = await setup();
    github.setIssueHandler(async () => {
      throw new GitHubClientError('network', 'Could not reach GitHub.');
    });

    const data = expectSuccess<SaveIssueData>(
      await handler.handle({ type: 'SAVE_ISSUE', url: ISSUE_URL }),
    );

    expect(data.created).toBe(true);
    expect(data.syncError).toEqual({ code: 'network', message: 'Could not reach GitHub.' });
    expect(data.issue).toMatchObject({
      title: null,
      state: 'unknown',
      lastSyncedAt: null,
      lastSyncError: 'Could not reach GitHub.',
    });
    expect((await loadSnapshot(repository)).issues).toEqual([data.issue]);
  });

  it('does not retain an issue when GitHub reports a pull request target', async () => {
    const { handler, repository, github } = await setup();
    github.setIssueHandler(async () => {
      throw new GitHubClientError(
        'wrong-target-kind',
        'The GitHub URL points to a pull request, not an issue.',
      );
    });

    const error = expectFailure(
      await handler.handle({ type: 'SAVE_ISSUE', url: ISSUE_URL }),
    );

    expect(error.code).toBe('wrong-target-kind');
    expect(github.issueCalls).toHaveLength(1);
    expect((await loadSnapshot(repository)).issues).toHaveLength(0);
  });

  it('truncates stored sync errors to the persistence limit', async () => {
    const { handler, repository, github } = await setup();
    github.setIssueHandler(async () => {
      throw new GitHubClientError('network', 'x'.repeat(400));
    });

    const data = expectSuccess<SaveIssueData>(
      await handler.handle({ type: 'SAVE_ISSUE', url: ISSUE_URL }),
    );

    expect(data.issue.lastSyncError).toHaveLength(300);
    expect(data.issue.lastSyncError?.endsWith('\u2026')).toBe(true);
    expect((await loadSnapshot(repository)).issues[0]?.lastSyncError).toBe(
      data.issue.lastSyncError,
    );
  });

  it('returns a storage failure without fetching when the placeholder cannot be saved', async () => {
    const { handler, repository, github } = await setup();
    vi.spyOn(repository, 'saveIssue').mockRejectedValueOnce(
      new StorageRepositoryError('unavailable', 'raw'),
    );

    const error = expectFailure(
      await handler.handle({ type: 'SAVE_ISSUE', url: ISSUE_URL }),
    );

    expect(error.code).toBe('storage-unavailable');
    expect(github.issueCalls).toHaveLength(0);
    expect((await loadSnapshot(repository)).issues).toHaveLength(0);
  });

  it('treats duplicate saves as idempotent without a network request', async () => {
    const issue = savedIssue();
    const { handler, github, repository } = await setup({ issues: [issue] });

    const data = expectSuccess<SaveIssueData>(
      await handler.handle({ type: 'SAVE_ISSUE', url: ISSUE_URL }),
    );

    expect(data).toEqual({ issue, created: false, syncError: null });
    expect(github.issueCalls).toHaveLength(0);
    expect((await loadSnapshot(repository)).issues).toEqual([issue]);
  });
});

describe('refreshing issues', () => {
  it('updates metadata while preserving savedAt', async () => {
    const issue = savedIssue();
    const { handler, repository, github, clock } = await setup({ issues: [issue] });

    const data = expectSuccess<RefreshIssueData>(
      await handler.handle({ type: 'REFRESH_ISSUE', url: ISSUE_URL }),
    );

    expect(data.issue).toMatchObject({
      title: 'Updated issue title',
      state: 'closed',
      savedAt: issue.savedAt,
      lastSyncedAt: clock.current.toISOString(),
      lastSyncError: null,
    });
    expect(github.issueCalls).toHaveLength(1);
    expect((await loadSnapshot(repository)).issues).toEqual([data.issue]);
  });

  it('rejects refreshing an issue that is not saved', async () => {
    const { handler, github, repository } = await setup();

    const error = expectFailure(
      await handler.handle({ type: 'REFRESH_ISSUE', url: ISSUE_URL }),
    );

    expect(error.code).toBe('not-saved');
    expect(github.issueCalls).toHaveLength(0);
    expect((await loadSnapshot(repository)).issues).toHaveLength(0);
  });

  it('preserves existing metadata and records a failed refresh', async () => {
    const issue = savedIssue();
    const { handler, repository, github } = await setup({ issues: [issue] });
    github.setIssueHandler(async () => {
      throw new GitHubClientError('not-found', 'Not found or not public.');
    });

    const error = expectFailure(
      await handler.handle({ type: 'REFRESH_ISSUE', url: ISSUE_URL }),
    );

    expect(error.code).toBe('not-found');
    const stored = (await loadSnapshot(repository)).issues[0];
    expect(stored).toMatchObject({
      title: issue.title,
      state: issue.state,
      savedAt: issue.savedAt,
      lastSyncedAt: issue.lastSyncedAt,
      lastSyncError: 'Not found or not public.',
    });
  });

  it('preserves rate-limit details in the command error', async () => {
    const { handler, github, repository } = await setup({ issues: [savedIssue()] });
    github.setIssueHandler(async () => {
      throw new GitHubClientError('rate-limited', 'GitHub rate limit reached.', {
        status: 429,
        retryAfterSeconds: 30,
        rateLimitResetAt: '2026-10-20T12:00:30.000Z',
      });
    });

    const error = expectFailure(
      await handler.handle({ type: 'REFRESH_ISSUE', url: ISSUE_URL }),
    );

    expect(error).toEqual({
      code: 'rate-limited',
      message: 'GitHub rate limit reached.',
      status: 429,
      retryAfterSeconds: 30,
      rateLimitResetAt: '2026-10-20T12:00:30.000Z',
    });
    expect((await loadSnapshot(repository)).issues[0]?.lastSyncError).toBe(
      'GitHub rate limit reached.',
    );
  });
});

describe('tracking pull requests', () => {
  it('tracks and stores fetched metadata', async () => {
    const { handler, repository, github, clock } = await setup();

    const data = expectSuccess<TrackPullRequestData>(
      await handler.handle({ type: 'TRACK_PULL_REQUEST', url: PULL_REQUEST_URL }),
    );

    expect(data.created).toBe(true);
    expect(data.syncError).toBeNull();
    expect(data.pullRequest).toMatchObject({
      id: PULL_REQUEST_ID,
      title: 'Updated pull request title',
      state: 'merged',
      addedAt: clock.current.toISOString(),
      lastSyncedAt: clock.current.toISOString(),
      lastSyncError: null,
    });
    expect(github.pullRequestCalls).toEqual([
      { owner: 'octocat', repo: 'Hello-World', number: 7 },
    ]);
    expect((await loadSnapshot(repository)).pullRequests).toEqual([data.pullRequest]);
  });

  it('keeps the placeholder when pull request metadata fetch fails', async () => {
    const { handler, repository, github } = await setup();
    github.setPullRequestHandler(async () => {
      throw new GitHubClientError('timeout', 'The GitHub request timed out.');
    });

    const data = expectSuccess<TrackPullRequestData>(
      await handler.handle({ type: 'TRACK_PULL_REQUEST', url: PULL_REQUEST_URL }),
    );

    expect(data.syncError?.code).toBe('timeout');
    expect(data.pullRequest).toMatchObject({
      title: null,
      state: 'unknown',
      lastSyncedAt: null,
      lastSyncError: 'The GitHub request timed out.',
    });
    expect((await loadSnapshot(repository)).pullRequests).toEqual([
      data.pullRequest,
    ]);
  });

  it('treats duplicate tracking as idempotent without a network request', async () => {
    const pullRequest = trackedPullRequest();
    const { handler, github } = await setup({ pullRequests: [pullRequest] });

    const data = expectSuccess<TrackPullRequestData>(
      await handler.handle({ type: 'TRACK_PULL_REQUEST', url: PULL_REQUEST_URL }),
    );

    expect(data).toEqual({ pullRequest, created: false, syncError: null });
    expect(github.pullRequestCalls).toHaveLength(0);
  });

  it('refreshes tracked pull requests and preserves addedAt', async () => {
    const pullRequest = trackedPullRequest();
    const { handler, clock } = await setup({ pullRequests: [pullRequest] });

    const data = expectSuccess<RefreshPullRequestData>(
      await handler.handle({ type: 'REFRESH_PULL_REQUEST', url: PULL_REQUEST_URL }),
    );

    expect(data.pullRequest).toMatchObject({
      title: 'Updated pull request title',
      state: 'merged',
      addedAt: pullRequest.addedAt,
      lastSyncedAt: clock.current.toISOString(),
      lastSyncError: null,
    });
  });

  it('rejects refreshing a pull request that is not tracked', async () => {
    const { handler, github } = await setup();

    const error = expectFailure(
      await handler.handle({ type: 'REFRESH_PULL_REQUEST', url: PULL_REQUEST_URL }),
    );

    expect(error.code).toBe('not-saved');
    expect(github.pullRequestCalls).toHaveLength(0);
  });
});

describe('notes', () => {
  it('creates and updates a note while preserving createdAt', async () => {
    const { handler, repository, clock } = await setup({ issues: [savedIssue()] });

    const created = expectSuccess<SaveNoteData>(
      await handler.handle({
        type: 'SAVE_NOTE',
        issueId: ISSUE_ID,
        body: 'First note',
        expectedUpdatedAt: null,
      }),
    );

    expect(created.note).toEqual({
      issueId: ISSUE_ID,
      body: 'First note',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect((await loadSnapshot(repository)).notes[ISSUE_ID]).toEqual(created.note);

    clock.current = LATER;
    const updated = expectSuccess<SaveNoteData>(
      await handler.handle({
        type: 'SAVE_NOTE',
        issueId: ISSUE_ID,
        body: 'Second note',
        expectedUpdatedAt: NOW.toISOString(),
      }),
    );

    expect(updated.note).toEqual({
      issueId: ISSUE_ID,
      body: 'Second note',
      createdAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
    expect((await loadSnapshot(repository)).notes[ISSUE_ID]).toEqual(updated.note);
  });

  it('rejects notes for issues that are not saved', async () => {
    const { handler, repository } = await setup();

    const error = expectFailure(
      await handler.handle({
        type: 'SAVE_NOTE',
        issueId: ISSUE_ID,
        body: 'Note',
        expectedUpdatedAt: null,
      }),
    );

    expect(error.code).toBe('storage-missing-issue');
    expect((await loadSnapshot(repository)).notes).toEqual({});
  });

  it('rejects note writes based on a stale snapshot', async () => {
    const existing = issueNote();
    const { handler, repository } = await setup({
      issues: [savedIssue()],
      notes: [existing],
    });

    const updateError = expectFailure(
      await handler.handle({
        type: 'SAVE_NOTE',
        issueId: ISSUE_ID,
        body: 'Stale overwrite',
        expectedUpdatedAt: '2026-10-19T10:01:00.000Z',
      }),
    );
    expect(updateError.code).toBe('note-conflict');
    expect((await loadSnapshot(repository)).notes[ISSUE_ID]).toEqual(existing);

    const createError = expectFailure(
      await handler.handle({
        type: 'SAVE_NOTE',
        issueId: ISSUE_ID,
        body: 'Duplicate note',
        expectedUpdatedAt: null,
      }),
    );
    expect(createError.code).toBe('note-conflict');
    expect((await loadSnapshot(repository)).notes[ISSUE_ID]).toEqual(existing);
  });

  it('advances the note revision when saves share a timestamp', async () => {
    const { handler, repository } = await setup({ issues: [savedIssue()] });

    const created = expectSuccess<SaveNoteData>(
      await handler.handle({
        type: 'SAVE_NOTE',
        issueId: ISSUE_ID,
        body: 'First note',
        expectedUpdatedAt: null,
      }),
    );
    const updated = expectSuccess<SaveNoteData>(
      await handler.handle({
        type: 'SAVE_NOTE',
        issueId: ISSUE_ID,
        body: 'Second note',
        expectedUpdatedAt: created.note.updatedAt,
      }),
    );

    expect(updated.note.createdAt).toBe(created.note.createdAt);
    expect(updated.note.updatedAt).toBe('2026-10-20T12:00:00.001Z');
    expect((await loadSnapshot(repository)).notes[ISSUE_ID]).toEqual(
      updated.note,
    );
  });

  it('deletes notes idempotently and rejects stale deletions', async () => {
    const existing = issueNote();
    const { handler, repository } = await setup({
      issues: [savedIssue()],
      notes: [existing],
    });

    const stale = expectFailure(
      await handler.handle({
        type: 'DELETE_NOTE',
        issueId: ISSUE_ID,
        expectedUpdatedAt: '2026-10-19T10:01:00.000Z',
      }),
    );
    expect(stale.code).toBe('note-conflict');
    expect((await loadSnapshot(repository)).notes[ISSUE_ID]).toEqual(existing);

    expectSuccess(
      await handler.handle({
        type: 'DELETE_NOTE',
        issueId: ISSUE_ID,
        expectedUpdatedAt: existing.updatedAt,
      }),
    );
    expect((await loadSnapshot(repository)).notes).toEqual({});

    expectSuccess(
      await handler.handle({
        type: 'DELETE_NOTE',
        issueId: ISSUE_ID,
        expectedUpdatedAt: existing.updatedAt,
      }),
    );
  });
});

describe('removal', () => {
  it('removes an issue and its note together', async () => {
    const { handler, repository } = await setup({
      issues: [savedIssue()],
      notes: [issueNote()],
    });

    const result = await handler.handle({ type: 'REMOVE_ISSUE', issueId: ISSUE_ID });
    expectSuccess(result);

    const snapshot = await loadSnapshot(repository);
    expect(snapshot.issues).toEqual([]);
    expect(snapshot.notes).toEqual({});
  });

  it('removes a tracked pull request', async () => {
    const { handler, repository } = await setup({
      pullRequests: [trackedPullRequest()],
    });

    const result = await handler.handle({
      type: 'REMOVE_PULL_REQUEST',
      pullRequestId: PULL_REQUEST_ID,
    });
    expectSuccess(result);

    expect((await loadSnapshot(repository)).pullRequests).toEqual([]);
  });
});

describe('refresh coalescing', () => {
  it('shares one GitHub request for concurrent refreshes of the same target', async () => {
    const issue = savedIssue();
    const { handler, github } = await setup({ issues: [issue] });

    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseFetch: (metadata: GitHubIssueMetadata) => void = () => undefined;
    const pending = new Promise<GitHubIssueMetadata>((resolve) => {
      releaseFetch = resolve;
    });
    github.setIssueHandler(async () => {
      signalStarted();
      return pending;
    });

    const first = handler.handle({ type: 'REFRESH_ISSUE', url: ISSUE_URL });
    await started;
    const second = handler.handle({ type: 'REFRESH_ISSUE', url: ISSUE_URL });

    releaseFetch({ number: 42, title: 'Updated issue title', state: 'open' });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(github.issueCalls).toHaveLength(1);
    expect(firstResult).toEqual(secondResult);
    expect(firstResult).toMatchObject({ ok: true });
  });
});

describe('command serialization', () => {
  it('runs commands in order when a GitHub request is in flight', async () => {
    const issue = savedIssue();
    const { handler, repository, github } = await setup({ issues: [issue] });

    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseFetch: (metadata: GitHubIssueMetadata) => void = () => undefined;
    const pending = new Promise<GitHubIssueMetadata>((resolve) => {
      releaseFetch = resolve;
    });
    github.setIssueHandler(async () => {
      signalStarted();
      return pending;
    });

    const events: string[] = [];
    const originalRemove = repository.removeIssue.bind(repository);
    vi.spyOn(repository, 'removeIssue').mockImplementation(async (id) => {
      events.push('remove');
      return originalRemove(id);
    });

    const refresh = handler.handle({ type: 'REFRESH_ISSUE', url: ISSUE_URL });
    await started;

    const remove = handler.handle({ type: 'REMOVE_ISSUE', issueId: ISSUE_ID });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([]);

    const order: string[] = [];
    void refresh.then(() => order.push('refresh'));
    void remove.then(() => order.push('remove'));

    releaseFetch({ number: 42, title: 'Updated issue title', state: 'open' });
    await refresh;
    await remove;
    await Promise.resolve();

    expect(events).toEqual(['remove']);
    expect(order).toEqual(['refresh', 'remove']);
  });
});
