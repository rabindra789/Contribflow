import {
  MAX_NOTE_BODY_LENGTH,
  MAX_SYNC_ERROR_LENGTH,
  MAX_TITLE_LENGTH,
  SCHEMA_VERSION,
  canonicalTargetId,
  isCanonicalTargetId,
  isValidOwnerSyntax,
  isValidRepoSyntax,
  isValidTargetNumber,
  type IsoTimestamp,
  type IssueNote,
  type IssueState,
  type PullRequestState,
  type SavedIssue,
  type StorageMeta,
  type TrackedPullRequest,
} from './models';
import { parseGitHubUrl } from './github-url';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function fail<T>(...errors: string[]): ValidationResult<T> {
  return { ok: false, errors };
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isCanonicalTimestamp(value: unknown): value is IsoTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) {
    return false;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function isIssueState(value: unknown): value is IssueState {
  return value === 'open' || value === 'closed' || value === 'unknown';
}

export function isPullRequestState(value: unknown): value is PullRequestState {
  return (
    value === 'open' ||
    value === 'draft' ||
    value === 'closed' ||
    value === 'merged' ||
    value === 'unknown'
  );
}

function hasDisallowedControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isAllowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if ((code < 0x20 && !isAllowedWhitespace) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function isValidTitle(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_TITLE_LENGTH &&
    !hasDisallowedControlChars(value)
  );
}

function isSyncError(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_SYNC_ERROR_LENGTH &&
    !hasDisallowedControlChars(value)
  );
}

export function isValidNoteBody(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_NOTE_BODY_LENGTH &&
    value.trim().length > 0
  );
}

function validateCommonTargetFields(
  value: Record<string, unknown>,
  storageKey: string,
  kind: 'issue' | 'pull_request',
): ValidationResult<{
  id: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
}> {
  if (typeof storageKey !== 'string') {
    return fail('storage key must be a string');
  }

  const id = value.id;
  if (typeof id !== 'string' || !isCanonicalTargetId(id)) {
    return fail('id must be a canonical, lowercase target id');
  }

  if (!storageKey.endsWith(`.${kind === 'issue' ? 'issue' : 'pr'}.${id}`)) {
    return fail(`storage key must end with the record id ${id}`);
  }

  const owner = value.owner;
  if (!isValidOwnerSyntax(owner)) {
    return fail('owner must be 1-39 characters, use [A-Za-z0-9-], and not start or end with a hyphen');
  }

  const repo = value.repo;
  if (!isValidRepoSyntax(repo)) {
    return fail('repo must be 1-100 characters, use [A-Za-z0-9._-], and not be "." or ".."');
  }

  const number = value.number;
  if (!isValidTargetNumber(number)) {
    return fail('number must be an integer in 1..2147483647');
  }

  if (id !== canonicalTargetId(owner, repo, number)) {
    return fail('id must match the lowercased owner, repo, and number');
  }

  const url = value.url;
  if (typeof url !== 'string') {
    return fail('url must be a string');
  }

  const parsedUrl = parseGitHubUrl(url);
  if (!parsedUrl.ok) {
    return fail(`url is not a supported GitHub URL: ${parsedUrl.message}`);
  }

  if (parsedUrl.target.kind !== kind) {
    return fail(
      kind === 'issue'
        ? 'url must point to an issue'
        : 'url must point to a pull request',
    );
  }

  if (parsedUrl.target.number !== number) {
    return fail('url number must match the record number');
  }

  if (parsedUrl.target.owner !== owner || parsedUrl.target.repo !== repo) {
    return fail('url owner and repo must match the record fields exactly');
  }

  if (parsedUrl.target.url !== url) {
    return fail('url must be canonical without query strings, fragments, or extra path segments');
  }

  return { ok: true, value: { id, owner, repo, number, url } };
}

export function parseSavedIssue(storageKey: string, value: unknown): ValidationResult<SavedIssue> {
  if (!isPlainRecord(value)) {
    return fail('saved issue must be an object');
  }

  const target = validateCommonTargetFields(value, storageKey, 'issue');
  if (!target.ok) {
    return target;
  }

  const title = value.title;
  if (title !== null && !isValidTitle(title)) {
    return fail(`title must be null or 1-${MAX_TITLE_LENGTH} characters without control characters`);
  }

  const state = value.state;
  if (!isIssueState(state)) {
    return fail('state must be "open", "closed", or "unknown"');
  }

  const savedAt = value.savedAt;
  if (!isCanonicalTimestamp(savedAt)) {
    return fail('savedAt must be a canonical ISO 8601 UTC timestamp with milliseconds');
  }

  const lastSyncedAt = value.lastSyncedAt;
  if (lastSyncedAt !== null) {
    if (!isCanonicalTimestamp(lastSyncedAt)) {
      return fail(
        'lastSyncedAt must be null or a canonical ISO 8601 UTC timestamp with milliseconds',
      );
    }
    if (Date.parse(lastSyncedAt) < Date.parse(savedAt)) {
      return fail('lastSyncedAt must not be earlier than savedAt');
    }
  }

  const lastSyncError = value.lastSyncError;
  if (
    lastSyncError !== null &&
    !isSyncError(lastSyncError)
  ) {
    return fail(
      `lastSyncError must be null or 1-${MAX_SYNC_ERROR_LENGTH} characters without control characters`,
    );
  }

  if (state === 'unknown') {
    if (title !== null) {
      return fail('title must be null while state is unknown');
    }
    if (lastSyncedAt !== null) {
      return fail('lastSyncedAt must be null while state is unknown');
    }
    if (lastSyncError === null) {
      return fail('lastSyncError must be set while state is unknown');
    }
  }

  return {
    ok: true,
    value: {
      ...target.value,
      title,
      state,
      savedAt,
      lastSyncedAt,
      lastSyncError,
    },
  };
}

export function parseTrackedPullRequest(
  storageKey: string,
  value: unknown,
): ValidationResult<TrackedPullRequest> {
  if (!isPlainRecord(value)) {
    return fail('tracked pull request must be an object');
  }

  const target = validateCommonTargetFields(value, storageKey, 'pull_request');
  if (!target.ok) {
    return target;
  }

  const title = value.title;
  if (title !== null && !isValidTitle(title)) {
    return fail(`title must be null or 1-${MAX_TITLE_LENGTH} characters without control characters`);
  }

  const state = value.state;
  if (!isPullRequestState(state)) {
    return fail('state must be "open", "draft", "closed", "merged", or "unknown"');
  }

  const addedAt = value.addedAt;
  if (!isCanonicalTimestamp(addedAt)) {
    return fail('addedAt must be a canonical ISO 8601 UTC timestamp with milliseconds');
  }

  const lastSyncedAt = value.lastSyncedAt;
  if (lastSyncedAt !== null) {
    if (!isCanonicalTimestamp(lastSyncedAt)) {
      return fail(
        'lastSyncedAt must be null or a canonical ISO 8601 UTC timestamp with milliseconds',
      );
    }
    if (Date.parse(lastSyncedAt) < Date.parse(addedAt)) {
      return fail('lastSyncedAt must not be earlier than addedAt');
    }
  }

  const lastSyncError = value.lastSyncError;
  if (lastSyncError !== null && !isSyncError(lastSyncError)) {
    return fail(
      `lastSyncError must be null or 1-${MAX_SYNC_ERROR_LENGTH} characters without control characters`,
    );
  }

  if (state === 'unknown') {
    if (title !== null) {
      return fail('title must be null while state is unknown');
    }
    if (lastSyncedAt !== null) {
      return fail('lastSyncedAt must be null while state is unknown');
    }
    if (lastSyncError === null) {
      return fail('lastSyncError must be set while state is unknown');
    }
  }

  return {
    ok: true,
    value: {
      ...target.value,
      title,
      state,
      addedAt,
      lastSyncedAt,
      lastSyncError,
    },
  };
}

export function parseIssueNote(value: unknown): ValidationResult<IssueNote> {
  if (!isPlainRecord(value)) {
    return fail('issue note must be an object');
  }

  const issueId = value.issueId;
  if (typeof issueId !== 'string' || !isCanonicalTargetId(issueId)) {
    return fail('issueId must reference a canonical saved issue id');
  }

  const body = value.body;
  if (typeof body !== 'string' || !isValidNoteBody(body)) {
    return fail(`body must contain 1-${MAX_NOTE_BODY_LENGTH} UTF-16 code units after trimming`);
  }

  const createdAt = value.createdAt;
  if (!isCanonicalTimestamp(createdAt)) {
    return fail('createdAt must be a canonical ISO 8601 UTC timestamp with milliseconds');
  }

  const updatedAt = value.updatedAt;
  if (!isCanonicalTimestamp(updatedAt)) {
    return fail('updatedAt must be a canonical ISO 8601 UTC timestamp with milliseconds');
  }

  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    return fail('updatedAt must not be earlier than createdAt');
  }

  return { ok: true, value: { issueId, body, createdAt, updatedAt } };
}

export function parseSchemaVersion(value: unknown): ValidationResult<number> {
  if (!isPlainRecord(value)) {
    return fail('storage metadata must be an object');
  }

  const version = value.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return fail('schemaVersion must be a positive integer');
  }

  return { ok: true, value: version };
}

export function parseStorageMeta(value: unknown): ValidationResult<StorageMeta> {
  const version = parseSchemaVersion(value);
  if (!version.ok) {
    return version;
  }

  if (version.value !== SCHEMA_VERSION) {
    return fail(`unsupported schemaVersion ${version.value}; supported version is ${SCHEMA_VERSION}`);
  }

  return { ok: true, value: { schemaVersion: SCHEMA_VERSION } };
}
