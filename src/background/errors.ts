import { MAX_SYNC_ERROR_LENGTH } from '../domain/models';
import { GitHubClientError, isGitHubClientError } from '../github/errors';
import {
  createCommandError,
  type CommandError,
  type CommandErrorCode,
} from '../messaging/contracts';
import {
  StorageRepositoryError,
  type LoadSnapshotError,
  type StorageErrorKind,
} from '../storage/repository';

function stripDisallowedControlChars(value: string): string {
  let cleaned = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? '';
    const code = value.charCodeAt(index);
    const isAllowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if ((code < 0x20 && !isAllowedWhitespace) || code === 0x7f) {
      cleaned += ' ';
    } else {
      cleaned += char;
    }
  }
  return cleaned;
}

function compactDetails(status: number | undefined): { status?: number } {
  return status === undefined ? {} : { status };
}

function mapGitHubKind(kind: GitHubClientError['kind']): CommandErrorCode {
  switch (kind) {
    case 'invalid-input':
      return 'invalid-command';
    case 'not-found':
      return 'not-found';
    case 'rate-limited':
      return 'rate-limited';
    case 'network':
      return 'network';
    case 'timeout':
      return 'timeout';
    case 'http':
      return 'github-http-error';
    case 'invalid-response':
      return 'invalid-github-response';
    case 'wrong-target-kind':
      return 'wrong-target-kind';
  }
}

export function mapGitHubClientError(error: GitHubClientError): CommandError {
  const details: Omit<CommandError, 'code' | 'message'> = {
    ...compactDetails(error.status),
  };
  if (error.retryAfterSeconds !== undefined) {
    details.retryAfterSeconds = error.retryAfterSeconds;
  }
  if (error.rateLimitResetAt !== undefined) {
    details.rateLimitResetAt = error.rateLimitResetAt;
  }
  return createCommandError(mapGitHubKind(error.kind), error.message, details);
}

function schemaDetails(
  found: number | undefined,
  supported: number | undefined,
): Omit<CommandError, 'code' | 'message'> {
  const details: Omit<CommandError, 'code' | 'message'> = {};
  if (found !== undefined) {
    details.found = found;
  }
  if (supported !== undefined) {
    details.supported = supported;
  }
  return details;
}

function schemaMessage(found: number | undefined, supported: number | undefined): string {
  if (found !== undefined && supported !== undefined) {
    return `Stored data uses schema version ${found}, but this version supports ${supported}.`;
  }
  return 'Stored data requires a schema migration before it can be used.';
}

function mapStorageKind(kind: StorageErrorKind): CommandErrorCode {
  switch (kind) {
    case 'unavailable':
      return 'storage-unavailable';
    case 'quota-exceeded':
      return 'storage-quota-exceeded';
    case 'missing-issue':
      return 'storage-missing-issue';
    case 'unsupported-schema':
    case 'schema-migration-required':
      return 'storage-schema';
    case 'corrupt-record':
    case 'corrupt-metadata':
      return 'storage-corrupt';
    case 'invalid-record':
      return 'storage-error';
  }
}

export function mapStorageRepositoryError(error: StorageRepositoryError): CommandError {
  const code = mapStorageKind(error.kind);

  switch (code) {
    case 'storage-unavailable':
      return createCommandError(code, 'Extension storage is unavailable.');
    case 'storage-quota-exceeded':
      return createCommandError(code, 'Extension storage is full.');
    case 'storage-missing-issue':
      return createCommandError(code, 'The issue is no longer saved.');
    case 'storage-corrupt':
      return createCommandError(code, 'Stored data is invalid and was left untouched.');
    case 'storage-schema':
      return createCommandError(
        code,
        schemaMessage(error.found, error.supported),
        schemaDetails(error.found, error.supported),
      );
    default:
      return createCommandError(code, 'The saved data could not be updated.');
  }
}

export function mapLoadSnapshotError(error: LoadSnapshotError): CommandError {
  switch (error.kind) {
    case 'unavailable':
      return createCommandError('storage-unavailable', 'Extension storage is unavailable.');
    case 'corrupt-metadata':
      return createCommandError('storage-corrupt', 'Stored data is invalid and was left untouched.');
    case 'unsupported-schema':
      return createCommandError(
        'storage-schema',
        schemaMessage(error.found, error.supported),
        schemaDetails(error.found, error.supported),
      );
    case 'migration-failed':
      return createCommandError(
        'storage-schema',
        'Stored data requires a schema migration before it can be used.',
      );
  }
}

export function toCommandError(error: unknown): CommandError {
  if (isGitHubClientError(error)) {
    return mapGitHubClientError(error);
  }
  if (error instanceof StorageRepositoryError) {
    return mapStorageRepositoryError(error);
  }
  return createCommandError('internal', 'An unexpected error occurred.');
}

export function toSyncErrorMessage(error: CommandError): string {
  const cleaned = stripDisallowedControlChars(error.message).trim();
  if (cleaned.length === 0) {
    return 'GitHub metadata sync failed.';
  }
  if (cleaned.length <= MAX_SYNC_ERROR_LENGTH) {
    return cleaned;
  }
  return `${cleaned.slice(0, MAX_SYNC_ERROR_LENGTH - 1)}\u2026`;
}
