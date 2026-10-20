import { describe, expect, it } from 'vitest';
import type { SavedIssue } from '../domain/models';
import { META_KEY, issueStorageKey } from './keys';
import { MemoryStoragePort } from './memory-storage';
import { runMigrations, type StorageMigration } from './migrations';

const issueId = 'acme/widgets#12';
const issueKey = issueStorageKey(issueId);

const legacyIssue: SavedIssue = {
  id: issueId,
  owner: 'acme',
  repo: 'widgets',
  number: 12,
  url: 'https://github.com/acme/widgets/issues/12',
  title: 'Legacy title',
  state: 'open',
  savedAt: '2026-10-19T09:15:00.000Z',
  lastSyncedAt: null,
  lastSyncError: null,
};

const v1Fixture: Record<string, unknown> = {
  [META_KEY]: { schemaVersion: 1 },
  [issueKey]: legacyIssue,
  'unrelated-key': { keep: true },
};

const retitle =
  (title: string): StorageMigration['migrate'] =>
  (records) => {
    const raw = records[issueKey];
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('fixture record is missing');
    }
    return { [issueKey]: { ...raw, title } };
  };

describe('migration runner', () => {
  it('reports an empty store as current without writing', async () => {
    const port = new MemoryStoragePort();

    const result = await runMigrations(port, { migrations: [] });

    expect(result).toEqual({ ok: true, migrated: false, fromVersion: 1, toVersion: 1 });
    expect(port.setCalls).toBe(0);
  });

  it('does not write when the store is already at the supported version', async () => {
    const port = new MemoryStoragePort(v1Fixture);

    const result = await runMigrations(port, { migrations: [] });

    expect(result).toEqual({ ok: true, migrated: false, fromVersion: 1, toVersion: 1 });
    expect(port.setCalls).toBe(0);
    expect(port.get(issueKey)).toEqual(legacyIssue);
  });

  it('migrates a stored fixture, updates metadata, and preserves unrelated data', async () => {
    const port = new MemoryStoragePort(v1Fixture);
    const migrations: StorageMigration[] = [
      { fromVersion: 1, toVersion: 2, migrate: retitle('Migrated title') },
    ];

    const result = await runMigrations(port, { migrations, supportedVersion: 2 });

    expect(result).toEqual({ ok: true, migrated: true, fromVersion: 1, toVersion: 2 });
    expect(port.get(META_KEY)).toEqual({ schemaVersion: 2 });
    expect(port.get(issueKey)).toEqual({ ...legacyIssue, title: 'Migrated title' });
    expect(port.get('unrelated-key')).toEqual({ keep: true });
    expect(port.setCalls).toBe(1);
  });

  it('applies a migration chain in order with a single write', async () => {
    const port = new MemoryStoragePort(v1Fixture);
    const applied: string[] = [];
    const migrations: StorageMigration[] = [
      {
        fromVersion: 1,
        toVersion: 2,
        migrate: (records) => {
          applied.push('1->2');
          return retitle('Version two')(records);
        },
      },
      {
        fromVersion: 2,
        toVersion: 3,
        migrate: (records) => {
          applied.push('2->3');
          return retitle('Version three')(records);
        },
      },
    ];

    const result = await runMigrations(port, { migrations, supportedVersion: 3 });

    expect(result).toEqual({ ok: true, migrated: true, fromVersion: 1, toVersion: 3 });
    expect(applied).toEqual(['1->2', '2->3']);
    expect(port.get(META_KEY)).toEqual({ schemaVersion: 3 });
    expect(port.get(issueKey)).toEqual({ ...legacyIssue, title: 'Version three' });
    expect(port.setCalls).toBe(1);
  });

  it('is idempotent once the metadata version has advanced', async () => {
    const port = new MemoryStoragePort(v1Fixture);
    const migrations: StorageMigration[] = [
      { fromVersion: 1, toVersion: 2, migrate: retitle('Migrated title') },
    ];

    await runMigrations(port, { migrations, supportedVersion: 2 });
    const writesAfterFirstRun = port.setCalls;

    const result = await runMigrations(port, { migrations, supportedVersion: 2 });

    expect(result).toEqual({ ok: true, migrated: false, fromVersion: 2, toVersion: 2 });
    expect(port.setCalls).toBe(writesAfterFirstRun);
    expect(port.get(issueKey)).toEqual({ ...legacyIssue, title: 'Migrated title' });
  });

  it('fails without writing when a migration step is missing', async () => {
    const port = new MemoryStoragePort(v1Fixture);
    const migrations: StorageMigration[] = [
      { fromVersion: 1, toVersion: 2, migrate: retitle('Migrated title') },
    ];

    const result = await runMigrations(port, { migrations, supportedVersion: 3 });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'migration-failed',
        message: expect.stringContaining('No migration registered from schema version 2'),
      },
    });
    expect(port.setCalls).toBe(0);
    expect(port.get(META_KEY)).toEqual({ schemaVersion: 1 });
    expect(port.get(issueKey)).toEqual(legacyIssue);
  });

  it('leaves all original data untouched when a later migration throws', async () => {
    const port = new MemoryStoragePort(v1Fixture);
    const migrations: StorageMigration[] = [
      { fromVersion: 1, toVersion: 2, migrate: retitle('Version two') },
      {
        fromVersion: 2,
        toVersion: 3,
        migrate: (records) => {
          const raw = records[issueKey];
          if (typeof raw === 'object' && raw !== null) {
            Object.assign(raw, { title: 'Mutated before failure' });
          }
          throw new Error('boom');
        },
      },
    ];

    const result = await runMigrations(port, { migrations, supportedVersion: 3 });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'migration-failed',
        message: expect.stringContaining('boom'),
      },
    });
    expect(port.setCalls).toBe(0);
    expect(port.get(META_KEY)).toEqual({ schemaVersion: 1 });
    expect(port.get(issueKey)).toEqual(legacyIssue);
    expect(port.get('unrelated-key')).toEqual({ keep: true });
  });

  it('rejects migrations that do not return a changes record', async () => {
    const port = new MemoryStoragePort(v1Fixture);
    const migrations: StorageMigration[] = [
      {
        fromVersion: 1,
        toVersion: 2,
        migrate: () => null as unknown as Record<string, unknown>,
      },
    ];

    const result = await runMigrations(port, { migrations, supportedVersion: 2 });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'migration-failed', message: expect.stringContaining('did not return') },
    });
    expect(port.setCalls).toBe(0);
    expect(port.get(issueKey)).toEqual(legacyIssue);
  });

  it('rejects an invalid migration registry before reading storage', async () => {
    const port = new MemoryStoragePort(v1Fixture);
    const migrations: StorageMigration[] = [
      { fromVersion: 2, toVersion: 2, migrate: retitle('Invalid') },
    ];

    const result = await runMigrations(port, { migrations, supportedVersion: 3 });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'migration-failed', message: expect.stringContaining('must advance') },
    });
    expect(port.readCalls).toBe(0);
    expect(port.setCalls).toBe(0);
  });

  it('rejects duplicate migration start versions', async () => {
    const port = new MemoryStoragePort(v1Fixture);
    const migrations: StorageMigration[] = [
      { fromVersion: 1, toVersion: 2, migrate: retitle('First') },
      { fromVersion: 1, toVersion: 3, migrate: retitle('Second') },
    ];

    const result = await runMigrations(port, { migrations, supportedVersion: 3 });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'migration-failed', message: expect.stringContaining('Multiple migrations') },
    });
    expect(port.setCalls).toBe(0);
  });

  it('refuses to migrate beyond the supported version', async () => {
    const port = new MemoryStoragePort(v1Fixture);
    const migrations: StorageMigration[] = [
      { fromVersion: 1, toVersion: 4, migrate: retitle('Too far') },
    ];

    const result = await runMigrations(port, { migrations, supportedVersion: 3 });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'migration-failed', message: expect.stringContaining('beyond') },
    });
    expect(port.setCalls).toBe(0);
  });

  it('refuses newer schemas without rewriting them', async () => {
    const port = new MemoryStoragePort({
      [META_KEY]: { schemaVersion: 4 },
      [issueKey]: legacyIssue,
    });

    const result = await runMigrations(port, { migrations: [], supportedVersion: 3 });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unsupported-schema', found: 4, supported: 3 },
    });
    expect(port.get(META_KEY)).toEqual({ schemaVersion: 4 });
    expect(port.setCalls).toBe(0);
  });

  it('reports corrupt metadata without rewriting data', async () => {
    const port = new MemoryStoragePort({
      [META_KEY]: { schemaVersion: '1' },
      [issueKey]: legacyIssue,
    });

    const result = await runMigrations(port, { migrations: [], supportedVersion: 2 });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'corrupt-metadata', message: expect.stringContaining('metadata is invalid') },
    });
    expect(port.setCalls).toBe(0);
    expect(port.get(issueKey)).toEqual(legacyIssue);
  });

  it('reports data without metadata as corrupt instead of guessing a version', async () => {
    const port = new MemoryStoragePort({ [issueKey]: legacyIssue });

    const result = await runMigrations(port, { migrations: [], supportedVersion: 2 });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'corrupt-metadata', message: expect.stringContaining('no schema metadata') },
    });
    expect(port.setCalls).toBe(0);
  });

  it('reports read failures without writing', async () => {
    const port = new MemoryStoragePort(v1Fixture);
    port.failRead = new Error('storage unavailable');

    const result = await runMigrations(port, {
      migrations: [{ fromVersion: 1, toVersion: 2, migrate: retitle('Migrated') }],
      supportedVersion: 2,
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: expect.stringContaining('storage unavailable') },
    });
    expect(port.setCalls).toBe(0);
  });

  it('reports write failures and keeps the original version', async () => {
    const port = new MemoryStoragePort(v1Fixture);
    port.failSet = new Error('QUOTA_BYTES quota exceeded');

    const result = await runMigrations(port, {
      migrations: [{ fromVersion: 1, toVersion: 2, migrate: retitle('Migrated') }],
      supportedVersion: 2,
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'unavailable', message: expect.stringContaining('QUOTA_BYTES') },
    });
    expect(port.get(META_KEY)).toEqual({ schemaVersion: 1 });
    expect(port.get(issueKey)).toEqual(legacyIssue);
  });
});
