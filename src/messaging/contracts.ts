import { parseGitHubUrl } from '../domain/github-url';
import {
  MAX_NOTE_BODY_LENGTH,
  isCanonicalTargetId,
  type IsoTimestamp,
  type IssueNote,
  type SavedIssue,
  type TrackedPullRequest,
} from '../domain/models';
import {
  isCanonicalTimestamp,
  isPlainRecord,
  isValidNoteBody,
} from '../domain/validation';
import type { StorageSnapshot } from '../storage/repository';

export const COMMAND_TYPES = [
  'GET_SNAPSHOT',
  'SAVE_ISSUE',
  'REFRESH_ISSUE',
  'REMOVE_ISSUE',
  'SAVE_NOTE',
  'DELETE_NOTE',
  'TRACK_PULL_REQUEST',
  'REFRESH_PULL_REQUEST',
  'REMOVE_PULL_REQUEST',
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

export type CommandErrorCode =
  | 'invalid-command'
  | 'invalid-github-url'
  | 'wrong-target-kind'
  | 'not-found'
  | 'rate-limited'
  | 'network'
  | 'timeout'
  | 'github-http-error'
  | 'invalid-github-response'
  | 'not-saved'
  | 'storage-unavailable'
  | 'storage-quota-exceeded'
  | 'storage-corrupt'
  | 'storage-schema'
  | 'storage-missing-issue'
  | 'storage-error'
  | 'note-conflict'
  | 'internal';

export interface CommandError {
  code: CommandErrorCode;
  message: string;
  status?: number;
  retryAfterSeconds?: number;
  rateLimitResetAt?: string;
  found?: number;
  supported?: number;
}

export type CommandResult<T> = { ok: true; data: T } | { ok: false; error: CommandError };

export interface GetSnapshotCommand {
  type: 'GET_SNAPSHOT';
}

export interface SaveIssueCommand {
  type: 'SAVE_ISSUE';
  url: string;
}

export interface RefreshIssueCommand {
  type: 'REFRESH_ISSUE';
  url: string;
}

export interface RemoveIssueCommand {
  type: 'REMOVE_ISSUE';
  issueId: string;
}

export interface SaveNoteCommand {
  type: 'SAVE_NOTE';
  issueId: string;
  body: string;
  expectedUpdatedAt: IsoTimestamp | null;
}

export interface DeleteNoteCommand {
  type: 'DELETE_NOTE';
  issueId: string;
  expectedUpdatedAt: IsoTimestamp | null;
}

export interface TrackPullRequestCommand {
  type: 'TRACK_PULL_REQUEST';
  url: string;
}

export interface RefreshPullRequestCommand {
  type: 'REFRESH_PULL_REQUEST';
  url: string;
}

export interface RemovePullRequestCommand {
  type: 'REMOVE_PULL_REQUEST';
  pullRequestId: string;
}

export type Command =
  | GetSnapshotCommand
  | SaveIssueCommand
  | RefreshIssueCommand
  | RemoveIssueCommand
  | SaveNoteCommand
  | DeleteNoteCommand
  | TrackPullRequestCommand
  | RefreshPullRequestCommand
  | RemovePullRequestCommand;

export interface SaveIssueData {
  issue: SavedIssue;
  created: boolean;
  syncError: CommandError | null;
}

export interface RefreshIssueData {
  issue: SavedIssue;
}

export interface RemoveIssueData {
  issueId: string;
}

export interface SaveNoteData {
  note: IssueNote;
}

export interface DeleteNoteData {
  issueId: string;
}

export interface TrackPullRequestData {
  pullRequest: TrackedPullRequest;
  created: boolean;
  syncError: CommandError | null;
}

export interface RefreshPullRequestData {
  pullRequest: TrackedPullRequest;
}

export interface RemovePullRequestData {
  pullRequestId: string;
}

export type CommandResponse =
  | CommandResult<StorageSnapshot>
  | CommandResult<SaveIssueData>
  | CommandResult<RefreshIssueData>
  | CommandResult<RemoveIssueData>
  | CommandResult<SaveNoteData>
  | CommandResult<DeleteNoteData>
  | CommandResult<TrackPullRequestData>
  | CommandResult<RefreshPullRequestData>
  | CommandResult<RemovePullRequestData>;

export type CommandParseResult =
  | { ok: true; command: Command }
  | { ok: false; error: CommandError };

export function createCommandError(
  code: CommandErrorCode,
  message: string,
  details: Omit<CommandError, 'code' | 'message'> = {},
): CommandError {
  return { code, message, ...details };
}

export function commandSuccess<T>(data: T): CommandResult<T> {
  return { ok: true, data };
}

export function commandFailure(error: CommandError): { ok: false; error: CommandError } {
  return { ok: false, error };
}

function invalidCommand(message: string): CommandParseResult {
  return {
    ok: false,
    error: createCommandError('invalid-command', message),
  };
}

function isPlainMessageRecord(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseUrlCommand(
  value: Record<string, unknown>,
  type: 'SAVE_ISSUE' | 'REFRESH_ISSUE' | 'TRACK_PULL_REQUEST' | 'REFRESH_PULL_REQUEST',
): CommandParseResult {
  const url = value.url;
  if (typeof url !== 'string') {
    return invalidCommand('The url field must be a string.');
  }

  const parsed = parseGitHubUrl(url);
  if (!parsed.ok) {
    return {
      ok: false,
      error: createCommandError(
        'invalid-github-url',
        `The URL is not a supported GitHub target: ${parsed.message}.`,
      ),
    };
  }

  const expectsPullRequest = type === 'TRACK_PULL_REQUEST' || type === 'REFRESH_PULL_REQUEST';
  if (expectsPullRequest && parsed.target.kind !== 'pull_request') {
    return {
      ok: false,
      error: createCommandError(
        'wrong-target-kind',
        'This command requires a GitHub pull request URL.',
      ),
    };
  }
  if (!expectsPullRequest && parsed.target.kind !== 'issue') {
    return {
      ok: false,
      error: createCommandError('wrong-target-kind', 'This command requires a GitHub issue URL.'),
    };
  }

  switch (type) {
    case 'SAVE_ISSUE':
      return { ok: true, command: { type, url } };
    case 'REFRESH_ISSUE':
      return { ok: true, command: { type, url } };
    case 'TRACK_PULL_REQUEST':
      return { ok: true, command: { type, url } };
    case 'REFRESH_PULL_REQUEST':
      return { ok: true, command: { type, url } };
  }
}

function parseIdentifier(
  value: Record<string, unknown>,
  field: 'issueId' | 'pullRequestId',
): { ok: true; id: string } | { ok: false; error: CommandError } {
  const id = value[field];
  if (typeof id !== 'string' || !isCanonicalTargetId(id)) {
    return {
      ok: false,
      error: createCommandError(
        'invalid-command',
        `The ${field} field must be a canonical GitHub target id.`,
      ),
    };
  }
  return { ok: true, id };
}

function parseExpectedUpdatedAt(
  value: Record<string, unknown>,
): { ok: true; expectedUpdatedAt: IsoTimestamp | null } | { ok: false; error: CommandError } {
  if (!Object.prototype.hasOwnProperty.call(value, 'expectedUpdatedAt')) {
    return {
      ok: false,
      error: createCommandError(
        'invalid-command',
        'The expectedUpdatedAt field is required.',
      ),
    };
  }
  const expectedUpdatedAt = value.expectedUpdatedAt;
  if (expectedUpdatedAt !== null && !isCanonicalTimestamp(expectedUpdatedAt)) {
    return {
      ok: false,
      error: createCommandError(
        'invalid-command',
        'The expectedUpdatedAt field must be null or a canonical timestamp.',
      ),
    };
  }
  return { ok: true, expectedUpdatedAt };
}

/**
 * Validates an untrusted runtime message before it reaches repository or
 * network code. Extra fields are rejected to keep the wire contract explicit.
 */
export function parseCommandMessage(input: unknown): CommandParseResult {
  if (!isPlainMessageRecord(input)) {
    return invalidCommand('Messages must be plain objects.');
  }

  const type = input.type;
  if (typeof type !== 'string' || !(COMMAND_TYPES as readonly string[]).includes(type)) {
    return invalidCommand('Unknown command type.');
  }

  switch (type) {
    case 'GET_SNAPSHOT': {
      if (!hasOnlyKeys(input, ['type'])) {
        return invalidCommand('GET_SNAPSHOT does not accept additional fields.');
      }
      return { ok: true, command: { type } };
    }

    case 'SAVE_ISSUE':
    case 'REFRESH_ISSUE':
    case 'TRACK_PULL_REQUEST':
    case 'REFRESH_PULL_REQUEST': {
      if (!hasOnlyKeys(input, ['type', 'url'])) {
        return invalidCommand(`${type} only accepts type and url fields.`);
      }
      return parseUrlCommand(input, type);
    }

    case 'REMOVE_ISSUE': {
      if (!hasOnlyKeys(input, ['type', 'issueId'])) {
        return invalidCommand('REMOVE_ISSUE only accepts type and issueId fields.');
      }
      const parsed = parseIdentifier(input, 'issueId');
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      return { ok: true, command: { type: 'REMOVE_ISSUE', issueId: parsed.id } };
    }

    case 'DELETE_NOTE': {
      if (!hasOnlyKeys(input, ['type', 'issueId', 'expectedUpdatedAt'])) {
        return invalidCommand(
          'DELETE_NOTE only accepts type, issueId, and expectedUpdatedAt fields.',
        );
      }
      const parsed = parseIdentifier(input, 'issueId');
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      const expected = parseExpectedUpdatedAt(input);
      if (!expected.ok) {
        return { ok: false, error: expected.error };
      }
      return {
        ok: true,
        command: {
          type: 'DELETE_NOTE',
          issueId: parsed.id,
          expectedUpdatedAt: expected.expectedUpdatedAt,
        },
      };
    }

    case 'SAVE_NOTE': {
      if (
        !hasOnlyKeys(input, [
          'type',
          'issueId',
          'body',
          'expectedUpdatedAt',
        ])
      ) {
        return invalidCommand(
          'SAVE_NOTE only accepts type, issueId, body, and expectedUpdatedAt fields.',
        );
      }
      const parsed = parseIdentifier(input, 'issueId');
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      const body = input.body;
      if (typeof body !== 'string' || !isValidNoteBody(body)) {
        return invalidCommand(
          `The body field must contain 1-${MAX_NOTE_BODY_LENGTH} UTF-16 code units after trimming.`,
        );
      }
      const expected = parseExpectedUpdatedAt(input);
      if (!expected.ok) {
        return { ok: false, error: expected.error };
      }
      return {
        ok: true,
        command: {
          type: 'SAVE_NOTE',
          issueId: parsed.id,
          body,
          expectedUpdatedAt: expected.expectedUpdatedAt,
        },
      };
    }

    case 'REMOVE_PULL_REQUEST': {
      if (!hasOnlyKeys(input, ['type', 'pullRequestId'])) {
        return invalidCommand('REMOVE_PULL_REQUEST only accepts type and pullRequestId fields.');
      }
      const parsed = parseIdentifier(input, 'pullRequestId');
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      return { ok: true, command: { type, pullRequestId: parsed.id } };
    }
  }

  return invalidCommand('Unknown command type.');
}

const COMMAND_ERROR_CODES: readonly CommandErrorCode[] = [
  'invalid-command',
  'invalid-github-url',
  'wrong-target-kind',
  'not-found',
  'rate-limited',
  'network',
  'timeout',
  'github-http-error',
  'invalid-github-response',
  'not-saved',
  'storage-unavailable',
  'storage-quota-exceeded',
  'storage-corrupt',
  'storage-schema',
  'storage-missing-issue',
  'storage-error',
  'note-conflict',
  'internal',
];

export function isCommandError(value: unknown): value is CommandError {
  if (!isPlainMessageRecord(value)) {
    return false;
  }
  if (
    typeof value.code !== 'string' ||
    !(COMMAND_ERROR_CODES as readonly string[]).includes(value.code)
  ) {
    return false;
  }
  if (typeof value.message !== 'string' || value.message.length === 0) {
    return false;
  }

  const optionalNumbers = [
    value.status,
    value.retryAfterSeconds,
    value.found,
    value.supported,
  ];
  if (optionalNumbers.some((field) => field !== undefined && typeof field !== 'number')) {
    return false;
  }
  if (value.rateLimitResetAt !== undefined && typeof value.rateLimitResetAt !== 'string') {
    return false;
  }

  return true;
}

export function isCommandResult(value: unknown): value is CommandResult<unknown> {
  if (!isPlainMessageRecord(value)) {
    return false;
  }
  if (value.ok === true) {
    return 'data' in value;
  }
  if (value.ok === false) {
    return isCommandError(value.error);
  }
  return false;
}
