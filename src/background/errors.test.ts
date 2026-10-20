import { describe, expect, it } from 'vitest';
import { MAX_SYNC_ERROR_LENGTH } from '../domain/models';
import { GitHubClientError } from '../github/errors';
import { createCommandError } from '../messaging/contracts';
import { StorageRepositoryError } from '../storage/repository';
import {
  mapGitHubClientError,
  mapLoadSnapshotError,
  mapStorageRepositoryError,
  toCommandError,
  toSyncErrorMessage,
} from './errors';

describe('GitHub error mapping', () => {
  it.each([
    ['invalid-input', 'invalid-command'],
    ['not-found', 'not-found'],
    ['rate-limited', 'rate-limited'],
    ['network', 'network'],
    ['timeout', 'timeout'],
    ['http', 'github-http-error'],
    ['invalid-response', 'invalid-github-response'],
    ['wrong-target-kind', 'wrong-target-kind'],
  ] as const)('maps %s to %s', (kind, code) => {
    const mapped = mapGitHubClientError(new GitHubClientError(kind, 'Safe message.'));
    expect(mapped).toEqual({ code, message: 'Safe message.' });
  });

  it('preserves status and rate-limit details', () => {
    const mapped = mapGitHubClientError(
      new GitHubClientError('rate-limited', 'Slow down.', {
        status: 429,
        retryAfterSeconds: 30,
        rateLimitResetAt: '2026-10-20T12:01:00.000Z',
      }),
    );

    expect(mapped).toEqual({
      code: 'rate-limited',
      message: 'Slow down.',
      status: 429,
      retryAfterSeconds: 30,
      rateLimitResetAt: '2026-10-20T12:01:00.000Z',
    });
  });
});

describe('storage error mapping', () => {
  it.each([
    ['unavailable', 'storage-unavailable'],
    ['quota-exceeded', 'storage-quota-exceeded'],
    ['invalid-record', 'storage-error'],
    ['corrupt-record', 'storage-corrupt'],
    ['corrupt-metadata', 'storage-corrupt'],
    ['unsupported-schema', 'storage-schema'],
    ['schema-migration-required', 'storage-schema'],
    ['missing-issue', 'storage-missing-issue'],
  ] as const)('maps %s to %s', (kind, code) => {
    const mapped = mapStorageRepositoryError(new StorageRepositoryError(kind, 'Raw detail'));
    expect(mapped.code).toBe(code);
    expect(mapped.message.length).toBeGreaterThan(0);
    expect(mapped.message).not.toContain('Raw detail');
  });

  it('preserves schema versions without exposing raw details', () => {
    const mapped = mapStorageRepositoryError(
      new StorageRepositoryError('unsupported-schema', 'details', {
        found: 2,
        supported: 1,
      }),
    );

    expect(mapped).toEqual({
      code: 'storage-schema',
      message: 'Stored data uses schema version 2, but this version supports 1.',
      found: 2,
      supported: 1,
    });
  });

  it.each([
    [{ kind: 'unavailable', message: 'x' } as const, 'storage-unavailable'],
    [{ kind: 'corrupt-metadata', message: 'x' } as const, 'storage-corrupt'],
    [
      { kind: 'unsupported-schema', found: 4, supported: 1 } as const,
      'storage-schema',
    ],
    [{ kind: 'migration-failed', message: 'x' } as const, 'storage-schema'],
  ])('maps snapshot load error $kind to $expected', (error, expected) => {
    expect(mapLoadSnapshotError(error).code).toBe(expected);
  });
});

describe('unexpected error mapping', () => {
  it('maps GitHub errors through the typed mapper', () => {
    const mapped = toCommandError(new GitHubClientError('timeout', 'Timed out.'));
    expect(mapped.code).toBe('timeout');
  });

  it('maps storage errors through the typed mapper', () => {
    const mapped = toCommandError(new StorageRepositoryError('missing-issue', 'raw'));
    expect(mapped.code).toBe('storage-missing-issue');
  });

  it('does not leak unexpected error messages', () => {
    const mapped = toCommandError(new Error('token=secret at C:\\private\\path'));
    expect(mapped).toEqual({
      code: 'internal',
      message: 'An unexpected error occurred.',
    });
  });
});

describe('sync error text', () => {
  it('keeps safe messages under the storage limit', () => {
    expect(toSyncErrorMessage(createCommandError('network', 'Could not reach GitHub.'))).toBe(
      'Could not reach GitHub.',
    );
  });

  it('replaces disallowed control characters and trims', () => {
    expect(
      toSyncErrorMessage(createCommandError('network', '\u0000  Error\u007f\t\nnext  ')),
    ).toBe('Error \t\nnext');
  });

  it('uses a fallback for blank messages', () => {
    expect(toSyncErrorMessage(createCommandError('network', ' \u0000 '))).toBe(
      'GitHub metadata sync failed.',
    );
  });

  it('truncates long messages to the stored limit', () => {
    const message = toSyncErrorMessage(createCommandError('network', 'x'.repeat(400)));
    expect(message).toHaveLength(MAX_SYNC_ERROR_LENGTH);
    expect(message.endsWith('\u2026')).toBe(true);
  });
});
