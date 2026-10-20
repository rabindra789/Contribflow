import { SCHEMA_VERSION } from '../domain/models';
import { parseSchemaVersion } from '../domain/validation';
import { META_KEY } from './keys';
import type { StoragePort } from './repository';

export interface StorageMigration {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(records: Readonly<Record<string, unknown>>): Record<string, unknown>;
}

export type MigrationError =
  | { kind: 'unavailable'; message: string }
  | { kind: 'corrupt-metadata'; message: string }
  | { kind: 'unsupported-schema'; found: number; supported: number }
  | { kind: 'migration-failed'; message: string };

export type MigrationResult =
  | { ok: true; migrated: boolean; fromVersion: number; toVersion: number }
  | { ok: false; error: MigrationError };

export interface RunMigrationsOptions {
  migrations: readonly StorageMigration[];
  supportedVersion?: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasContribflowKeys(records: Record<string, unknown>): boolean {
  return Object.keys(records).some((key) => key.startsWith('contribflow.'));
}

function registryError(
  migrations: readonly StorageMigration[],
  supportedVersion: number,
): string | null {
  const seenFromVersions = new Set<number>();

  for (const migration of migrations) {
    if (
      !Number.isSafeInteger(migration.fromVersion) ||
      !Number.isSafeInteger(migration.toVersion) ||
      migration.fromVersion < 1
    ) {
      return `Migration from ${migration.fromVersion} to ${migration.toVersion} has invalid version numbers.`;
    }
    if (migration.toVersion <= migration.fromVersion) {
      return `Migration from ${migration.fromVersion} must advance to a newer version.`;
    }
    if (migration.toVersion > supportedVersion) {
      return `Migration from ${migration.fromVersion} advances to ${migration.toVersion}, beyond the supported version ${supportedVersion}.`;
    }
    if (seenFromVersions.has(migration.fromVersion)) {
      return `Multiple migrations start at version ${migration.fromVersion}.`;
    }
    seenFromVersions.add(migration.fromVersion);
  }

  return null;
}

function failure(message: string): MigrationResult {
  return { ok: false, error: { kind: 'migration-failed', message } };
}

export async function runMigrations(
  port: StoragePort,
  { migrations, supportedVersion = SCHEMA_VERSION }: RunMigrationsOptions,
): Promise<MigrationResult> {
  const invalidRegistry = registryError(migrations, supportedVersion);
  if (invalidRegistry !== null) {
    return failure(invalidRegistry);
  }

  let records: Record<string, unknown>;
  try {
    records = await port.readAll();
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'unavailable',
        message: `Could not read stored data before migrating: ${messageOf(error)}`,
      },
    };
  }

  const rawMeta = records[META_KEY];
  if (rawMeta === undefined) {
    if (hasContribflowKeys(records)) {
      return {
        ok: false,
        error: {
          kind: 'corrupt-metadata',
          message: 'Storage contains ContribFlow data but no schema metadata.',
        },
      };
    }
    return {
      ok: true,
      migrated: false,
      fromVersion: supportedVersion,
      toVersion: supportedVersion,
    };
  }

  const version = parseSchemaVersion(rawMeta);
  if (!version.ok) {
    return {
      ok: false,
      error: {
        kind: 'corrupt-metadata',
        message: `Storage metadata is invalid: ${version.errors.join('; ')}`,
      },
    };
  }

  if (version.value > supportedVersion) {
    return {
      ok: false,
      error: {
        kind: 'unsupported-schema',
        found: version.value,
        supported: supportedVersion,
      },
    };
  }

  const fromVersion = version.value;
  if (fromVersion === supportedVersion) {
    return { ok: true, migrated: false, fromVersion, toVersion: supportedVersion };
  }

  const migrationsByFromVersion = new Map(
    migrations.map((migration) => [migration.fromVersion, migration]),
  );
  const working = structuredClone(records);
  const changedKeys = new Set<string>();
  let currentVersion = fromVersion;

  while (currentVersion < supportedVersion) {
    const migration = migrationsByFromVersion.get(currentVersion);
    if (migration === undefined) {
      return failure(
        `No migration registered from schema version ${currentVersion} to reach version ${supportedVersion}.`,
      );
    }

    let changes: unknown;
    try {
      changes = migration.migrate({ ...working });
    } catch (error) {
      return failure(
        `Migration from version ${migration.fromVersion} to ${migration.toVersion} failed: ${messageOf(error)}`,
      );
    }

    if (!isPlainRecord(changes)) {
      return failure(
        `Migration from version ${migration.fromVersion} to ${migration.toVersion} did not return a record of changes.`,
      );
    }

    Object.assign(working, changes);
    for (const key of Object.keys(changes)) {
      changedKeys.add(key);
    }

    currentVersion = migration.toVersion;
    working[META_KEY] = { schemaVersion: currentVersion };
    changedKeys.add(META_KEY);
  }

  const payload: Record<string, unknown> = {};
  for (const key of changedKeys) {
    payload[key] = working[key];
  }

  try {
    await port.set(payload);
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: 'unavailable',
        message: `Could not write migrated data: ${messageOf(error)}`,
      },
    };
  }

  return { ok: true, migrated: true, fromVersion, toVersion: supportedVersion };
}
