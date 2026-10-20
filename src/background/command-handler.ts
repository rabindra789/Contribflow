import { parseGitHubUrl } from '../domain/github-url';
import type {
  GitHubTarget,
  IssueNote,
  SavedIssue,
  TargetKind,
  TrackedPullRequest,
} from '../domain/models';
import type {
  GitHubClient,
  GitHubIssueMetadata,
  GitHubPullRequestMetadata,
} from '../github/client';
import {
  commandFailure,
  commandSuccess,
  createCommandError,
  parseCommandMessage,
  type Command,
  type CommandError,
  type CommandResponse,
  type CommandResult,
  type DeleteNoteData,
  type RefreshIssueData,
  type RefreshPullRequestData,
  type RemoveIssueData,
  type RemovePullRequestData,
  type SaveIssueData,
  type SaveNoteData,
  type TrackPullRequestData,
} from '../messaging/contracts';
import type { StorageRepository, StorageSnapshot } from '../storage/repository';
import { mapLoadSnapshotError, toCommandError, toSyncErrorMessage } from './errors';

const PENDING_SYNC_ERROR = 'Metadata has not been fetched yet.';

interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
}

function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

class CommandFailureSignal extends Error {
  readonly commandError: CommandError;

  constructor(error: CommandError) {
    super(error.message);
    this.name = 'CommandFailureSignal';
    this.commandError = error;
  }
}

export interface CommandHandlerOptions {
  repository: StorageRepository;
  github: GitHubClient;
  now?: () => Date;
}

export interface CommandHandler {
  handle(message: unknown): Promise<CommandResponse>;
}

function targetRef(target: GitHubTarget): { owner: string; repo: string; number: number } {
  return { owner: target.owner, repo: target.repo, number: target.number };
}

function notSavedError(kind: TargetKind): CommandError {
  return createCommandError(
    'not-saved',
    kind === 'issue' ? 'The issue is not saved.' : 'The pull request is not tracked.',
  );
}

function missingIssueError(): CommandError {
  return createCommandError('storage-missing-issue', 'The issue is no longer saved.');
}

export function createCommandHandler(options: CommandHandlerOptions): CommandHandler {
  const { repository, github } = options;
  const now = options.now ?? (() => new Date());
  const queue = createSerialQueue();
  const inFlightRefreshes = new Map<string, Promise<CommandResponse>>();

  function toTimestamp(): string {
    return now().toISOString();
  }

  function requireTarget(url: string, expectedKind: TargetKind): GitHubTarget {
    const parsed = parseGitHubUrl(url);
    if (!parsed.ok) {
      throw new CommandFailureSignal(
        createCommandError(
          'invalid-github-url',
          'The URL is not a supported GitHub issue or pull request URL.',
        ),
      );
    }
    if (parsed.target.kind !== expectedKind) {
      throw new CommandFailureSignal(
        createCommandError(
          'wrong-target-kind',
          expectedKind === 'issue'
            ? 'This command requires a GitHub issue URL.'
            : 'This command requires a GitHub pull request URL.',
        ),
      );
    }
    return parsed.target;
  }

  async function requireSnapshot(): Promise<StorageSnapshot> {
    const result = await repository.loadSnapshot();
    if (!result.ok) {
      throw new CommandFailureSignal(mapLoadSnapshotError(result.error));
    }
    return result.snapshot;
  }

  function findIssue(snapshot: StorageSnapshot, id: string): SavedIssue | null {
    return snapshot.issues.find((issue) => issue.id === id) ?? null;
  }

  function findPullRequest(
    snapshot: StorageSnapshot,
    id: string,
  ): TrackedPullRequest | null {
    return snapshot.pullRequests.find((pullRequest) => pullRequest.id === id) ?? null;
  }

  async function persistIssueSyncError(
    issue: SavedIssue,
    error: CommandError,
  ): Promise<SavedIssue> {
    const failed: SavedIssue = {
      ...issue,
      lastSyncError: toSyncErrorMessage(error),
    };
    await repository.updateIssue(failed);
    return failed;
  }

  async function persistPullRequestSyncError(
    pullRequest: TrackedPullRequest,
    error: CommandError,
  ): Promise<TrackedPullRequest> {
    const failed: TrackedPullRequest = {
      ...pullRequest,
      lastSyncError: toSyncErrorMessage(error),
    };
    await repository.savePullRequest(failed);
    return failed;
  }

  async function saveIssue(
    command: Extract<Command, { type: 'SAVE_ISSUE' }>,
    timestamp: string,
  ): Promise<CommandResult<SaveIssueData>> {
    const target = requireTarget(command.url, 'issue');
    const snapshot = await requireSnapshot();
    const existing = findIssue(snapshot, target.id);
    if (existing !== null) {
      return commandSuccess({ issue: existing, created: false, syncError: null });
    }

    const base: SavedIssue = {
      id: target.id,
      owner: target.owner,
      repo: target.repo,
      number: target.number,
      url: target.url,
      title: null,
      state: 'unknown',
      savedAt: timestamp,
      lastSyncedAt: null,
      lastSyncError: PENDING_SYNC_ERROR,
    };
    await repository.saveIssue(base);

    let metadata: GitHubIssueMetadata;
    try {
      metadata = await github.fetchIssue(targetRef(target));
    } catch (error) {
      const syncError = toCommandError(error);
      if (syncError.code === 'wrong-target-kind') {
        await repository.removeIssue(base.id);
        return commandFailure(syncError);
      }
      const failed = await persistIssueSyncError(base, syncError);
      return commandSuccess({ issue: failed, created: true, syncError });
    }

    const synced: SavedIssue = {
      ...base,
      title: metadata.title,
      state: metadata.state,
      lastSyncedAt: timestamp,
      lastSyncError: null,
    };
    await repository.updateIssue(synced);
    return commandSuccess({ issue: synced, created: true, syncError: null });
  }

  async function refreshIssue(
    command: Extract<Command, { type: 'REFRESH_ISSUE' }>,
    timestamp: string,
  ): Promise<CommandResult<RefreshIssueData>> {
    const target = requireTarget(command.url, 'issue');
    const snapshot = await requireSnapshot();
    const existing = findIssue(snapshot, target.id);
    if (existing === null) {
      throw new CommandFailureSignal(notSavedError('issue'));
    }

    let metadata: GitHubIssueMetadata;
    try {
      metadata = await github.fetchIssue(targetRef(target));
    } catch (error) {
      const syncError = toCommandError(error);
      await persistIssueSyncError(existing, syncError);
      throw new CommandFailureSignal(syncError);
    }

    const updated: SavedIssue = {
      ...existing,
      title: metadata.title,
      state: metadata.state,
      lastSyncedAt: timestamp,
      lastSyncError: null,
    };
    await repository.updateIssue(updated);
    return commandSuccess({ issue: updated });
  }

  async function trackPullRequest(
    command: Extract<Command, { type: 'TRACK_PULL_REQUEST' }>,
    timestamp: string,
  ): Promise<CommandResult<TrackPullRequestData>> {
    const target = requireTarget(command.url, 'pull_request');
    const snapshot = await requireSnapshot();
    const existing = findPullRequest(snapshot, target.id);
    if (existing !== null) {
      return commandSuccess({
        pullRequest: existing,
        created: false,
        syncError: null,
      });
    }

    const base: TrackedPullRequest = {
      id: target.id,
      owner: target.owner,
      repo: target.repo,
      number: target.number,
      url: target.url,
      title: null,
      state: 'unknown',
      addedAt: timestamp,
      lastSyncedAt: null,
      lastSyncError: PENDING_SYNC_ERROR,
    };
    await repository.savePullRequest(base);

    let metadata: GitHubPullRequestMetadata;
    try {
      metadata = await github.fetchPullRequest(targetRef(target));
    } catch (error) {
      const syncError = toCommandError(error);
      const failed = await persistPullRequestSyncError(base, syncError);
      return commandSuccess({ pullRequest: failed, created: true, syncError });
    }

    const synced: TrackedPullRequest = {
      ...base,
      title: metadata.title,
      state: metadata.state,
      lastSyncedAt: timestamp,
      lastSyncError: null,
    };
    await repository.savePullRequest(synced);
    return commandSuccess({ pullRequest: synced, created: true, syncError: null });
  }

  async function refreshPullRequest(
    command: Extract<Command, { type: 'REFRESH_PULL_REQUEST' }>,
    timestamp: string,
  ): Promise<CommandResult<RefreshPullRequestData>> {
    const target = requireTarget(command.url, 'pull_request');
    const snapshot = await requireSnapshot();
    const existing = findPullRequest(snapshot, target.id);
    if (existing === null) {
      throw new CommandFailureSignal(notSavedError('pull_request'));
    }

    let metadata: GitHubPullRequestMetadata;
    try {
      metadata = await github.fetchPullRequest(targetRef(target));
    } catch (error) {
      const syncError = toCommandError(error);
      await persistPullRequestSyncError(existing, syncError);
      throw new CommandFailureSignal(syncError);
    }

    const updated: TrackedPullRequest = {
      ...existing,
      title: metadata.title,
      state: metadata.state,
      lastSyncedAt: timestamp,
      lastSyncError: null,
    };
    await repository.savePullRequest(updated);
    return commandSuccess({ pullRequest: updated });
  }

  async function saveNote(
    command: Extract<Command, { type: 'SAVE_NOTE' }>,
    timestamp: string,
  ): Promise<CommandResult<SaveNoteData>> {
    const snapshot = await requireSnapshot();
    if (findIssue(snapshot, command.issueId) === null) {
      throw new CommandFailureSignal(missingIssueError());
    }

    const existing = snapshot.notes[command.issueId];
    const createdAt = existing?.createdAt ?? timestamp;
    const updatedAt = createdAt > timestamp ? createdAt : timestamp;
    const note: IssueNote = {
      issueId: command.issueId,
      body: command.body,
      createdAt,
      updatedAt,
    };
    await repository.saveNote(note);
    return commandSuccess({ note });
  }

  async function dispatch(command: Command, timestamp: string): Promise<CommandResponse> {
    switch (command.type) {
      case 'GET_SNAPSHOT': {
        const snapshot = await requireSnapshot();
        return commandSuccess(snapshot);
      }

      case 'SAVE_ISSUE':
        return saveIssue(command, timestamp);

      case 'REFRESH_ISSUE':
        return refreshIssue(command, timestamp);

      case 'REMOVE_ISSUE': {
        await repository.removeIssue(command.issueId);
        const data: RemoveIssueData = { issueId: command.issueId };
        return commandSuccess(data);
      }

      case 'SAVE_NOTE':
        return saveNote(command, timestamp);

      case 'DELETE_NOTE': {
        await repository.removeNote(command.issueId);
        const data: DeleteNoteData = { issueId: command.issueId };
        return commandSuccess(data);
      }

      case 'TRACK_PULL_REQUEST':
        return trackPullRequest(command, timestamp);

      case 'REFRESH_PULL_REQUEST':
        return refreshPullRequest(command, timestamp);

      case 'REMOVE_PULL_REQUEST': {
        await repository.removePullRequest(command.pullRequestId);
        const data: RemovePullRequestData = { pullRequestId: command.pullRequestId };
        return commandSuccess(data);
      }
    }
  }

  function refreshKey(command: Command): string | null {
    if (command.type !== 'REFRESH_ISSUE' && command.type !== 'REFRESH_PULL_REQUEST') {
      return null;
    }
    const parsed = parseGitHubUrl(command.url);
    return parsed.ok ? `${command.type}:${parsed.target.id}` : null;
  }

  function run(command: Command): Promise<CommandResponse> {
    return queue.run(async () => {
      try {
        return await dispatch(command, toTimestamp());
      } catch (error) {
        if (error instanceof CommandFailureSignal) {
          return commandFailure(error.commandError);
        }
        return commandFailure(toCommandError(error));
      }
    });
  }

  return {
    async handle(message: unknown): Promise<CommandResponse> {
      const parsed = parseCommandMessage(message);
      if (!parsed.ok) {
        return commandFailure(parsed.error);
      }

      const key = refreshKey(parsed.command);
      if (key === null) {
        return run(parsed.command);
      }

      const existing = inFlightRefreshes.get(key);
      if (existing !== undefined) {
        return existing;
      }

      const task = run(parsed.command);
      inFlightRefreshes.set(key, task);
      void task.then(
        () => {
          inFlightRefreshes.delete(key);
        },
        () => {
          inFlightRefreshes.delete(key);
        },
      );
      return task;
    },
  };
}
