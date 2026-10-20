import { describe, expect, it } from 'vitest';
import {
  META_KEY,
  issueStorageKey,
  metaStorageKey,
  noteStorageKey,
  parseStorageKey,
  pullRequestStorageKey,
} from './keys';

const id = 'microsoft/typescript#12345';
const otherId = 'vercel/next.js#67890';

describe('storage keys', () => {
  it('uses the documented v1 key format', () => {
    expect(META_KEY).toBe('contribflow.v1.meta');
    expect(issueStorageKey(id)).toBe('contribflow.v1.issue.microsoft/typescript#12345');
    expect(pullRequestStorageKey(id)).toBe('contribflow.v1.pr.microsoft/typescript#12345');
    expect(noteStorageKey(id)).toBe('contribflow.v1.note.microsoft/typescript#12345');
  });

  it('is deterministic and collision-free across entity kinds', () => {
    const keys = [
      issueStorageKey(id),
      pullRequestStorageKey(id),
      noteStorageKey(id),
      issueStorageKey(otherId),
    ];

    expect(new Set(keys).size).toBe(keys.length);
    expect(issueStorageKey(id)).toBe(issueStorageKey(id));
  });

  it('supports explicit schema versions for future migrations', () => {
    expect(metaStorageKey(2)).toBe('contribflow.v2.meta');
    expect(issueStorageKey(id, 2)).toBe('contribflow.v2.issue.microsoft/typescript#12345');
    expect(pullRequestStorageKey(id, 3)).toBe('contribflow.v3.pr.microsoft/typescript#12345');
    expect(noteStorageKey(id, 4)).toBe('contribflow.v4.note.microsoft/typescript#12345');
  });

  it('round-trips every key kind', () => {
    expect(parseStorageKey(META_KEY)).toEqual({ kind: 'meta', schemaVersion: 1 });
    expect(parseStorageKey(issueStorageKey(id))).toEqual({
      kind: 'issue',
      schemaVersion: 1,
      id,
    });
    expect(parseStorageKey(pullRequestStorageKey(id))).toEqual({
      kind: 'pull-request',
      schemaVersion: 1,
      id,
    });
    expect(parseStorageKey(noteStorageKey(id))).toEqual({
      kind: 'note',
      schemaVersion: 1,
      issueId: id,
    });
  });

  it('round-trips future versions and ids containing dots and slashes', () => {
    const version = 7;
    const repoId = 'owner/repo.with.dots#1';
    expect(parseStorageKey(metaStorageKey(version))).toEqual({
      kind: 'meta',
      schemaVersion: version,
    });
    expect(parseStorageKey(issueStorageKey(repoId, version))).toEqual({
      kind: 'issue',
      schemaVersion: version,
      id: repoId,
    });
    expect(parseStorageKey(noteStorageKey(repoId, version))).toEqual({
      kind: 'note',
      schemaVersion: version,
      issueId: repoId,
    });
  });

  it.each([
    '',
    'contribflow',
    'contribflow.v1',
    'contribflow.v1.meta.extra',
    'contribflow.v1.issue.',
    'contribflow.v1.unknown.value',
    'contribflow.v01.issue.microsoft/typescript#1',
    'contribflow.v0.meta',
    'contribflow.v-1.meta',
    'contribflow.v1.issue',
    'other.v1.issue.microsoft/typescript#1',
  ])('rejects unrecognized key %s', (key) => {
    expect(parseStorageKey(key)).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(parseStorageKey(null)).toBeNull();
    expect(parseStorageKey(42)).toBeNull();
  });
});
