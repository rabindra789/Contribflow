import { browser } from 'wxt/browser';
import { isCanonicalTargetId, type SavedIssue, type TrackedPullRequest } from '../domain/models';
import {
  parseIssueNote,
  parseSavedIssue,
  parseTrackedPullRequest,
} from '../domain/validation';
import type { StorageSnapshot } from '../storage/repository';
import { issueStorageKey, pullRequestStorageKey } from '../storage/keys';
import type { StorageWarning } from '../storage/warnings';
import {
  isCommandError,
  isCommandResult,
  type Command,
  type CommandError,
  type RefreshIssueData,
  type RefreshPullRequestData,
  type RemoveIssueData,
  type RemovePullRequestData,
  type SaveIssueData,
  type TrackPullRequestData,
} from './contracts';

export type BackgroundClientErrorReason =
  | 'messaging-unavailable'
  | 'invalid-response'
  | 'command-failed';

export class BackgroundClientError extends Error {
  readonly reason: BackgroundClientErrorReason;
  readonly commandError: CommandError | undefined;

  constructor(
    reason: BackgroundClientErrorReason,
    message: string,
    commandError?: CommandError,
  ) {
    super(message);
    this.name = 'BackgroundClientError';
    this.reason = reason;
    this.commandError = commandError;
  }
}

function invalidResponse(): BackgroundClientError {
  return new BackgroundClientError(
    'invalid-response',
    'The extension returned an unexpected response.',
  );
}

function parseRecord<T>(
  value: unknown,
  kind: 'issue' | 'pull_request',
  parse: (storageKey: string, record: unknown) => { ok: true; value: T } | { ok: false },
): T | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const id = (value as { id?: unknown }).id;
  if (typeof id !== 'string' || !isCanonicalTargetId(id)) {
    return null;
  }

  const storageKey =
    kind === 'issue' ? issueStorageKey(id) : pullRequestStorageKey(id);
  const parsed = parse(storageKey, value);
  return parsed.ok ? parsed.value : null;
}

function parseIssue(value: unknown): SavedIssue | null {
  return parseRecord(value, 'issue', parseSavedIssue);
}

function parsePullRequest(value: unknown): TrackedPullRequest | null {
  return parseRecord(value, 'pull_request', parseTrackedPullRequest);
}

function parseWarnings(value: unknown): StorageWarning[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const warnings: StorageWarning[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return null;
    }
    const record = item as Record<string, unknown>;
    if (
      record.kind === 'invalid-record' &&
      typeof record.storageKey === 'string' &&
      typeof record.reason === 'string'
    ) {
      warnings.push({
        kind: 'invalid-record',
        storageKey: record.storageKey,
        reason: record.reason,
      });
      continue;
    }
    if (record.kind === 'orphan-note' && isCanonicalTargetId(record.issueId)) {
      warnings.push({ kind: 'orphan-note', issueId: record.issueId });
      continue;
    }
    return null;
  }
  return warnings;
}

function parseSnapshot(value: unknown): StorageSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.issues) || !Array.isArray(record.pullRequests)) {
    return null;
  }

  const issues: SavedIssue[] = [];
  for (const item of record.issues) {
    const issue = parseIssue(item);
    if (issue === null) {
      return null;
    }
    issues.push(issue);
  }

  const pullRequests: TrackedPullRequest[] = [];
  for (const item of record.pullRequests) {
    const pullRequest = parsePullRequest(item);
    if (pullRequest === null) {
      return null;
    }
    pullRequests.push(pullRequest);
  }

  const issueIds = new Set(issues.map((issue) => issue.id));
  if (issueIds.size !== issues.length) {
    return null;
  }
  const pullRequestIds = new Set(pullRequests.map((pullRequest) => pullRequest.id));
  if (pullRequestIds.size !== pullRequests.length) {
    return null;
  }

  if (
    typeof record.notes !== 'object' ||
    record.notes === null ||
    Array.isArray(record.notes)
  ) {
    return null;
  }
  const notes: StorageSnapshot['notes'] = {};
  for (const [key, noteValue] of Object.entries(record.notes)) {
    const note = parseIssueNote(noteValue);
    if (!note.ok || note.value.issueId !== key || !issueIds.has(note.value.issueId)) {
      return null;
    }
    notes[note.value.issueId] = note.value;
  }

  const warnings = parseWarnings(record.warnings);
  if (warnings === null) {
    return null;
  }

  return { issues, pullRequests, notes, warnings };
}

function parseSaveIssueData(value: unknown): SaveIssueData | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const issue = parseIssue(record.issue);
  if (
    issue === null ||
    typeof record.created !== 'boolean' ||
    (record.syncError !== null && !isCommandError(record.syncError))
  ) {
    return null;
  }
  return { issue, created: record.created, syncError: record.syncError };
}

function parseTrackPullRequestData(value: unknown): TrackPullRequestData | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const pullRequest = parsePullRequest(record.pullRequest);
  if (
    pullRequest === null ||
    typeof record.created !== 'boolean' ||
    (record.syncError !== null && !isCommandError(record.syncError))
  ) {
    return null;
  }
  return { pullRequest, created: record.created, syncError: record.syncError };
}

function parseRefreshIssueData(value: unknown): RefreshIssueData | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const issue = parseIssue((value as Record<string, unknown>).issue);
  return issue === null ? null : { issue };
}

function parseRefreshPullRequestData(value: unknown): RefreshPullRequestData | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const pullRequest = parsePullRequest(
    (value as Record<string, unknown>).pullRequest,
  );
  return pullRequest === null ? null : { pullRequest };
}

function parseRemovedId(
  value: unknown,
  field: 'issueId' | 'pullRequestId',
  expectedId: string,
): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const id = (value as Record<string, unknown>)[field];
  return isCanonicalTargetId(id) && id === expectedId ? id : null;
}

function parseRemoveIssueData(value: unknown, expectedId: string): RemoveIssueData | null {
  const issueId = parseRemovedId(value, 'issueId', expectedId);
  return issueId === null ? null : { issueId };
}

function parseRemovePullRequestData(
  value: unknown,
  expectedId: string,
): RemovePullRequestData | null {
  const pullRequestId = parseRemovedId(value, 'pullRequestId', expectedId);
  return pullRequestId === null ? null : { pullRequestId };
}

export type BackgroundSendMessage = (command: Command) => Promise<unknown>;

export interface BackgroundClientOptions {
  sendMessage?: BackgroundSendMessage;
}

export interface BackgroundClient {
  getSnapshot(): Promise<StorageSnapshot>;
  saveIssue(url: string): Promise<SaveIssueData>;
  refreshIssue(url: string): Promise<RefreshIssueData>;
  removeIssue(issueId: string): Promise<RemoveIssueData>;
  trackPullRequest(url: string): Promise<TrackPullRequestData>;
  refreshPullRequest(url: string): Promise<RefreshPullRequestData>;
  removePullRequest(pullRequestId: string): Promise<RemovePullRequestData>;
}

const defaultSendMessage: BackgroundSendMessage = (command) =>
  browser.runtime.sendMessage(command);

export function createBackgroundClient(
  options: BackgroundClientOptions = {},
): BackgroundClient {
  const sendMessage = options.sendMessage ?? defaultSendMessage;

  async function request<T>(
    command: Command,
    parse: (value: unknown) => T | null,
  ): Promise<T> {
    let response: unknown;
    try {
      response = await sendMessage(command);
    } catch {
      throw new BackgroundClientError(
        'messaging-unavailable',
        'Could not reach the extension background. Reload the extension and try again.',
      );
    }

    if (!isCommandResult(response)) {
      throw invalidResponse();
    }
    if (!response.ok) {
      throw new BackgroundClientError(
        'command-failed',
        response.error.message,
        response.error,
      );
    }

    const parsed = parse(response.data);
    if (parsed === null) {
      throw invalidResponse();
    }
    return parsed;
  }

  return {
    getSnapshot() {
      return request({ type: 'GET_SNAPSHOT' }, parseSnapshot);
    },

    saveIssue(url) {
      return request({ type: 'SAVE_ISSUE', url }, parseSaveIssueData);
    },

    refreshIssue(url) {
      return request({ type: 'REFRESH_ISSUE', url }, parseRefreshIssueData);
    },

    removeIssue(issueId) {
      return request({ type: 'REMOVE_ISSUE', issueId }, (value) =>
        parseRemoveIssueData(value, issueId),
      );
    },

    trackPullRequest(url) {
      return request({ type: 'TRACK_PULL_REQUEST', url }, parseTrackPullRequestData);
    },

    refreshPullRequest(url) {
      return request(
        { type: 'REFRESH_PULL_REQUEST', url },
        parseRefreshPullRequestData,
      );
    },

    removePullRequest(pullRequestId) {
      return request({ type: 'REMOVE_PULL_REQUEST', pullRequestId }, (value) =>
        parseRemovePullRequestData(value, pullRequestId),
      );
    },
  };
}
