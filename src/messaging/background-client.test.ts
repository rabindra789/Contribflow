import { describe, expect, it, vi } from 'vitest';
import type {
  IssueNote,
  SavedIssue,
  TrackedPullRequest,
} from '../domain/models';
import type { StorageSnapshot } from '../storage/repository';
import {
  BackgroundClientError,
  createBackgroundClient,
  type BackgroundSendMessage,
} from './background-client';
import type { Command } from './contracts';

const issueUrl = 'https://github.com/Microsoft/TypeScript/issues/12345';
const pullRequestUrl = 'https://github.com/Microsoft/TypeScript/pull/54321';

const issue: SavedIssue = {
  id: 'microsoft/typescript#12345',
  owner: 'Microsoft',
  repo: 'TypeScript',
  number: 12345,
  url: issueUrl,
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
  url: pullRequestUrl,
  title: 'Fix callback inference',
  state: 'draft',
  addedAt: '2026-10-19T10:00:00.000Z',
  lastSyncedAt: '2026-10-19T10:00:01.000Z',
  lastSyncError: null,
};

const note: IssueNote = {
  issueId: issue.id,
  body: 'Reproduce with strict mode enabled.',
  createdAt: '2026-10-19T09:20:00.000Z',
  updatedAt: '2026-10-19T09:25:30.000Z',
};

const snapshot: StorageSnapshot = {
  issues: [issue],
  pullRequests: [pullRequest],
  notes: { [issue.id]: note },
  warnings: [],
};

function setup(response: unknown): {
  client: ReturnType<typeof createBackgroundClient>;
  sendMessage: ReturnType<typeof vi.fn<BackgroundSendMessage>>;
} {
  const sendMessage = vi.fn<BackgroundSendMessage>().mockResolvedValue(response);
  return {
    client: createBackgroundClient({ sendMessage }),
    sendMessage,
  };
}

async function captureError(promise: Promise<unknown>): Promise<BackgroundClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BackgroundClientError);
    return error as BackgroundClientError;
  }
  throw new Error('Expected the background request to reject.');
}

describe('background client', () => {
  it('loads and validates a snapshot', async () => {
    const { client, sendMessage } = setup({ ok: true, data: snapshot });

    await expect(client.getSnapshot()).resolves.toEqual(snapshot);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_SNAPSHOT' });
  });

  it('rejects malformed envelopes and snapshot payloads', async () => {
    const cases: unknown[] = [
      null,
      { ok: false, error: { code: 'internal', message: '' } },
      { ok: true, data: null },
      { ok: true, data: { ...snapshot, issues: [{}] } },
      { ok: true, data: { ...snapshot, pullRequests: [{ ...pullRequest, url: issueUrl }] } },
      { ok: true, data: { ...snapshot, notes: { 'other/repo#1': note } } },
      { ok: true, data: { ...snapshot, warnings: [{ kind: 'unknown-warning' }] } },
      { ok: true, data: { ...snapshot, issues: [issue, issue] } },
    ];

    for (const response of cases) {
      const { client } = setup(response);
      const error = await captureError(client.getSnapshot());
      expect(error.reason).toBe('invalid-response');
    }
  });

  it('accepts the empty snapshot and storage warnings', async () => {
    const response = {
      ok: true,
      data: {
        issues: [],
        pullRequests: [],
        notes: {},
        warnings: [
          {
            kind: 'invalid-record',
            storageKey: 'contribflow.v1.issue.bad',
            reason: 'invalid record',
          },
          { kind: 'orphan-note', issueId: 'octocat/hello-world#1' },
        ],
      },
    };
    const { client } = setup(response);

    await expect(client.getSnapshot()).resolves.toEqual(response.data);
  });

  it('throws the background command error without exposing the envelope', async () => {
    const { client } = setup({
      ok: false,
      error: {
        code: 'rate-limited',
        message: 'GitHub rate limit reached. Try again later.',
        status: 429,
        retryAfterSeconds: 30,
      },
    });

    const error = await captureError(client.saveIssue(issueUrl));

    expect(error.reason).toBe('command-failed');
    expect(error.message).toBe('GitHub rate limit reached. Try again later.');
    expect(error.commandError).toEqual({
      code: 'rate-limited',
      message: 'GitHub rate limit reached. Try again later.',
      status: 429,
      retryAfterSeconds: 30,
    });
  });

  it('replaces sendMessage rejections with a safe messaging error', async () => {
    const sendMessage = vi
      .fn<BackgroundSendMessage>()
      .mockRejectedValue(new Error('Receiving end does not exist for secret-token'));
    const client = createBackgroundClient({ sendMessage });

    const error = await captureError(client.getSnapshot());

    expect(error.reason).toBe('messaging-unavailable');
    expect(error.message).not.toContain('secret-token');
    expect(error.commandError).toBeUndefined();
  });

  it('saves an issue and preserves the sync warning for failed metadata', async () => {
    const syncError = {
      code: 'network' as const,
      message: 'Could not reach GitHub.',
    };
    const savedIssue: SavedIssue = {
      ...issue,
      title: null,
      state: 'unknown',
      lastSyncedAt: null,
      lastSyncError: syncError.message,
    };
    const { client, sendMessage } = setup({
      ok: true,
      data: { issue: savedIssue, created: true, syncError },
    });

    await expect(client.saveIssue(issueUrl)).resolves.toEqual({
      issue: savedIssue,
      created: true,
      syncError,
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_ISSUE', url: issueUrl });
  });

  it('rejects malformed save payloads', async () => {
    const cases: unknown[] = [
      { created: true, syncError: null },
      { issue: null, created: true, syncError: null },
      { issue, created: 'yes', syncError: null },
      { issue, created: true, syncError: { code: 'network' } },
    ];

    for (const data of cases) {
      const { client } = setup({ ok: true, data });
      const error = await captureError(client.saveIssue(issueUrl));
      expect(error.reason).toBe('invalid-response');
    }
  });

  it('tracks and refreshes pull requests through the typed commands', async () => {
    const track = setup({
      ok: true,
      data: { pullRequest, created: false, syncError: null },
    });
    await expect(track.client.trackPullRequest(pullRequestUrl)).resolves.toEqual({
      pullRequest,
      created: false,
      syncError: null,
    });
    expect(track.sendMessage).toHaveBeenCalledWith({
      type: 'TRACK_PULL_REQUEST',
      url: pullRequestUrl,
    });

    const refresh = setup({ ok: true, data: { pullRequest } });
    await expect(refresh.client.refreshPullRequest(pullRequestUrl)).resolves.toEqual({
      pullRequest,
    });
    expect(refresh.sendMessage).toHaveBeenCalledWith({
      type: 'REFRESH_PULL_REQUEST',
      url: pullRequestUrl,
    });
  });

  it('refreshes an issue through the typed command', async () => {
    const { client, sendMessage } = setup({ ok: true, data: { issue } });

    await expect(client.refreshIssue(issueUrl)).resolves.toEqual({ issue });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'REFRESH_ISSUE',
      url: issueUrl,
    });
  });

  it('removes the exact requested issue and pull request ids', async () => {
    const removedIssue = setup({ ok: true, data: { issueId: issue.id } });
    await expect(removedIssue.client.removeIssue(issue.id)).resolves.toEqual({
      issueId: issue.id,
    });
    expect(removedIssue.sendMessage).toHaveBeenCalledWith({
      type: 'REMOVE_ISSUE',
      issueId: issue.id,
    });

    const removedPullRequest = setup({
      ok: true,
      data: { pullRequestId: pullRequest.id },
    });
    await expect(
      removedPullRequest.client.removePullRequest(pullRequest.id),
    ).resolves.toEqual({ pullRequestId: pullRequest.id });
    expect(removedPullRequest.sendMessage).toHaveBeenCalledWith({
      type: 'REMOVE_PULL_REQUEST',
      pullRequestId: pullRequest.id,
    });
  });

  it('rejects removal responses for a different id', async () => {
    const { client } = setup({
      ok: true,
      data: { issueId: 'octocat/hello-world#1' },
    });

    const error = await captureError(client.removeIssue(issue.id));
    expect(error.reason).toBe('invalid-response');
  });

  it('does not log command content or responses', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = setup({ ok: true, data: snapshot });

    await client.getSnapshot();

    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });
});

describe('background client command serialization', () => {
  it('sends only serializable command payloads', async () => {
    const commands: Command[] = [];
    const sendMessage: BackgroundSendMessage = (command) => {
      commands.push(command);
      return Promise.resolve({ ok: true, data: { issueId: issue.id } });
    };
    const client = createBackgroundClient({ sendMessage });

    await client.removeIssue(issue.id);

    expect(JSON.parse(JSON.stringify(commands))).toEqual(commands);
  });
});
