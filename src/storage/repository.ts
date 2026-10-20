import {
  SCHEMA_VERSION,
  type IssueNote,
  type SavedIssue,
  type TrackedPullRequest,
} from '../domain/models';
import {
  parseIssueNote,
  parseSavedIssue,
  parseSchemaVersion,
  parseTrackedPullRequest,
} from '../domain/validation';
import {
  META_KEY,
  issueStorageKey,
  noteStorageKey,
  parseStorageKey,
  pullRequestStorageKey,
} from './keys';
import type { StorageWarning } from './warnings';

export interface StoragePort {
  readAll(): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  subscribe(listener: (changedKeys: string[]) => void): () => void;
}

export interface StorageChangeSummary {
  changedKeys: string[];
}

export interface StorageReader {
  loadSnapshot(): Promise<LoadSnapshotResult>;
  subscribe(listener: (change: StorageChangeSummary) => void): () => void;
}

export interface StorageRepository extends StorageReader {
  saveIssue(issue: SavedIssue): Promise<void>;
  savePullRequest(pullRequest: TrackedPullRequest): Promise<void>;
  saveNote(note: IssueNote): Promise<void>;
  removeIssue(issueId: string): Promise<void>;
  removePullRequest(pullRequestId: string): Promise<void>;
  removeNote(issueId: string): Promise<void>;
}

export interface StorageSnapshot {
  issues: SavedIssue[];
  pullRequests: TrackedPullRequest[];
  notes: Record<string, IssueNote>;
  warnings: StorageWarning[];
}

export type LoadSnapshotError =
  | { kind: 'unavailable'; message: string }
  | { kind: 'corrupt-metadata'; message: string }
  | { kind: 'unsupported-schema'; found: number; supported: number }
  | { kind: 'migration-failed'; message: string };

export type LoadSnapshotResult =
  | { ok: true; snapshot: StorageSnapshot }
  | { ok: false; error: LoadSnapshotError };

export type StorageErrorKind =
  | 'unavailable'
  | 'quota-exceeded'
  | 'invalid-record'
  | 'corrupt-record'
  | 'corrupt-metadata'
  | 'unsupported-schema'
  | 'schema-migration-required'
  | 'missing-issue';

export interface StorageErrorDetails {
  storageKey?: string;
  errors?: string[];
  found?: number;
  supported?: number;
}

export class StorageRepositoryError extends Error {
  readonly kind: StorageErrorKind;
  readonly storageKey: string | undefined;
  readonly errors: string[] | undefined;
  readonly found: number | undefined;
  readonly supported: number | undefined;

  constructor(kind: StorageErrorKind, message: string, details: StorageErrorDetails = {}) {
    super(message);
    this.name = 'StorageRepositoryError';
    this.kind = kind;
    this.storageKey = details.storageKey;
    this.errors = details.errors;
    this.found = details.found;
    this.supported = details.supported;
  }
}

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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasContribflowKeys(records: Record<string, unknown>): boolean {
  return Object.keys(records).some((key) => key.startsWith('contribflow.'));
}

function invalidRecordError(
  label: string,
  storageKey: string,
  result: { errors: string[] },
): StorageRepositoryError {
  return new StorageRepositoryError(
    'invalid-record',
    `${label} is invalid: ${result.errors.join('; ')}`,
    { storageKey, errors: result.errors },
  );
}

function corruptRecordError(
  label: string,
  storageKey: string,
  errors: string[],
): StorageRepositoryError {
  return new StorageRepositoryError(
    'corrupt-record',
    `${label} at ${storageKey} is invalid and was left untouched: ${errors.join('; ')}`,
    { storageKey, errors },
  );
}

function mapWriteError(action: string, error: unknown): StorageRepositoryError {
  const message = messageOf(error);
  if (/quota/i.test(message)) {
    return new StorageRepositoryError(
      'quota-exceeded',
      `${action} failed because the storage quota was exceeded: ${message}`,
    );
  }
  return new StorageRepositoryError('unavailable', `${action} failed: ${message}`);
}

function shallowEqual(left: object, right: object): boolean {
  const leftRecord: Record<string, unknown> = { ...left };
  const rightRecord: Record<string, unknown> = { ...right };
  const leftKeys = Object.keys(leftRecord);

  if (leftKeys.length !== Object.keys(rightRecord).length) {
    return false;
  }

  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      Object.is(leftRecord[key], rightRecord[key]),
  );
}

export function createStorageRepository(port: StoragePort): StorageRepository {
  const queue = createSerialQueue();

  async function readRecords(): Promise<Record<string, unknown>> {
    try {
      return await port.readAll();
    } catch (error) {
      throw new StorageRepositoryError(
        'unavailable',
        `Could not read stored data: ${messageOf(error)}`,
      );
    }
  }

  function ensureWritable(records: Record<string, unknown>): boolean {
    const meta = records[META_KEY];
    if (meta === undefined) {
      if (hasContribflowKeys(records)) {
        throw new StorageRepositoryError(
          'corrupt-metadata',
          'Storage contains ContribFlow data but no schema metadata.',
        );
      }
      return false;
    }

    const version = parseSchemaVersion(meta);
    if (!version.ok) {
      throw new StorageRepositoryError(
        'corrupt-metadata',
        `Storage metadata is invalid: ${version.errors.join('; ')}`,
      );
    }

    if (version.value > SCHEMA_VERSION) {
      throw new StorageRepositoryError(
        'unsupported-schema',
        `Storage schema version ${version.value} is newer than the supported version ${SCHEMA_VERSION}.`,
        { found: version.value, supported: SCHEMA_VERSION },
      );
    }

    if (version.value < SCHEMA_VERSION) {
      throw new StorageRepositoryError(
        'schema-migration-required',
        `Storage schema version ${version.value} must be migrated to version ${SCHEMA_VERSION} before writing.`,
        { found: version.value, supported: SCHEMA_VERSION },
      );
    }

    return true;
  }

  async function writeItems(
    items: Record<string, unknown>,
    metaExists: boolean,
  ): Promise<void> {
    const payload = metaExists
      ? items
      : { ...items, [META_KEY]: { schemaVersion: SCHEMA_VERSION } };

    try {
      await port.set(payload);
    } catch (error) {
      throw mapWriteError('Writing data', error);
    }
  }

  async function removeKeys(keys: string[], action: string): Promise<void> {
    try {
      await port.remove(keys);
    } catch (error) {
      throw mapWriteError(action, error);
    }
  }

  return {
    async loadSnapshot(): Promise<LoadSnapshotResult> {
      let records: Record<string, unknown>;
      try {
        records = await port.readAll();
      } catch (error) {
        return {
          ok: false,
          error: {
            kind: 'unavailable',
            message: `Could not read stored data: ${messageOf(error)}`,
          },
        };
      }

      const meta = records[META_KEY];
      if (meta === undefined) {
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
          snapshot: { issues: [], pullRequests: [], notes: {}, warnings: [] },
        };
      }

      const version = parseSchemaVersion(meta);
      if (!version.ok) {
        return {
          ok: false,
          error: {
            kind: 'corrupt-metadata',
            message: `Storage metadata is invalid: ${version.errors.join('; ')}`,
          },
        };
      }

      if (version.value > SCHEMA_VERSION) {
        return {
          ok: false,
          error: {
            kind: 'unsupported-schema',
            found: version.value,
            supported: SCHEMA_VERSION,
          },
        };
      }

      if (version.value < SCHEMA_VERSION) {
        return {
          ok: false,
          error: {
            kind: 'migration-failed',
            message: `Storage schema version ${version.value} must be migrated to version ${SCHEMA_VERSION} before reading.`,
          },
        };
      }

      const issues: SavedIssue[] = [];
      const pullRequests: TrackedPullRequest[] = [];
      const noteCandidates: IssueNote[] = [];
      const warnings: StorageWarning[] = [];

      for (const [key, raw] of Object.entries(records)) {
        const parsedKey = parseStorageKey(key);
        if (parsedKey === null) {
          if (key.startsWith('contribflow.')) {
            warnings.push({
              kind: 'invalid-record',
              storageKey: key,
              reason: 'unrecognized ContribFlow storage key',
            });
          }
          continue;
        }

        if (parsedKey.schemaVersion !== SCHEMA_VERSION) {
          warnings.push({
            kind: 'invalid-record',
            storageKey: key,
            reason: `key uses schema version ${parsedKey.schemaVersion}, expected ${SCHEMA_VERSION}`,
          });
          continue;
        }

        if (parsedKey.kind === 'meta') {
          continue;
        }

        if (parsedKey.kind === 'issue') {
          const result = parseSavedIssue(key, raw);
          if (!result.ok) {
            warnings.push({
              kind: 'invalid-record',
              storageKey: key,
              reason: result.errors.join('; '),
            });
            continue;
          }
          if (result.value.id !== parsedKey.id) {
            warnings.push({
              kind: 'invalid-record',
              storageKey: key,
              reason: `record id ${result.value.id} does not match the storage key`,
            });
            continue;
          }
          issues.push(result.value);
          continue;
        }

        if (parsedKey.kind === 'pull-request') {
          const result = parseTrackedPullRequest(key, raw);
          if (!result.ok) {
            warnings.push({
              kind: 'invalid-record',
              storageKey: key,
              reason: result.errors.join('; '),
            });
            continue;
          }
          if (result.value.id !== parsedKey.id) {
            warnings.push({
              kind: 'invalid-record',
              storageKey: key,
              reason: `record id ${result.value.id} does not match the storage key`,
            });
            continue;
          }
          pullRequests.push(result.value);
          continue;
        }

        const result = parseIssueNote(raw);
        if (!result.ok) {
          warnings.push({
            kind: 'invalid-record',
            storageKey: key,
            reason: result.errors.join('; '),
          });
          continue;
        }
        if (result.value.issueId !== parsedKey.issueId || noteStorageKey(result.value.issueId) !== key) {
          warnings.push({
            kind: 'invalid-record',
            storageKey: key,
            reason: `note issueId ${result.value.issueId} does not match the storage key`,
          });
          continue;
        }
        noteCandidates.push(result.value);
      }

      const issueIds = new Set(issues.map((issue) => issue.id));
      const notes: Record<string, IssueNote> = {};
      for (const note of noteCandidates) {
        if (!issueIds.has(note.issueId)) {
          warnings.push({ kind: 'orphan-note', issueId: note.issueId });
          continue;
        }
        notes[note.issueId] = note;
      }

      return { ok: true, snapshot: { issues, pullRequests, notes, warnings } };
    },

    subscribe(listener: (change: StorageChangeSummary) => void): () => void {
      return port.subscribe((changedKeys) => {
        const relevant = changedKeys.filter((key) => parseStorageKey(key) !== null);
        if (relevant.length > 0) {
          listener({ changedKeys: relevant });
        }
      });
    },

    async saveIssue(issue: SavedIssue): Promise<void> {
      const key = issueStorageKey(issue.id);
      const parsed = parseSavedIssue(key, issue);
      if (!parsed.ok) {
        throw invalidRecordError('Issue', key, parsed);
      }

      return queue.run(async () => {
        const records = await readRecords();
        const metaExists = ensureWritable(records);
        const existingRaw = records[key];

        if (existingRaw !== undefined) {
          const existing = parseSavedIssue(key, existingRaw);
          if (!existing.ok) {
            throw corruptRecordError('Existing issue', key, existing.errors);
          }
          return;
        }

        await writeItems({ [key]: parsed.value }, metaExists);
      });
    },

    async savePullRequest(pullRequest: TrackedPullRequest): Promise<void> {
      const key = pullRequestStorageKey(pullRequest.id);
      const parsed = parseTrackedPullRequest(key, pullRequest);
      if (!parsed.ok) {
        throw invalidRecordError('Pull request', key, parsed);
      }

      return queue.run(async () => {
        const records = await readRecords();
        const metaExists = ensureWritable(records);
        const existingRaw = records[key];
        let next = parsed.value;

        if (existingRaw !== undefined) {
          const existing = parseTrackedPullRequest(key, existingRaw);
          if (!existing.ok) {
            throw corruptRecordError('Existing pull request', key, existing.errors);
          }
          next = { ...parsed.value, addedAt: existing.value.addedAt };
          if (shallowEqual(existing.value, next)) {
            return;
          }
        }

        await writeItems({ [key]: next }, metaExists);
      });
    },

    async saveNote(note: IssueNote): Promise<void> {
      const parsed = parseIssueNote(note);
      if (!parsed.ok) {
        throw new StorageRepositoryError(
          'invalid-record',
          `Note is invalid: ${parsed.errors.join('; ')}`,
          { errors: parsed.errors },
        );
      }

      return queue.run(async () => {
        const records = await readRecords();
        const metaExists = ensureWritable(records);
        const issueKey = issueStorageKey(parsed.value.issueId);
        const issueRaw = records[issueKey];

        if (issueRaw === undefined) {
          throw new StorageRepositoryError(
            'missing-issue',
            `Cannot save a note: issue ${parsed.value.issueId} is not saved.`,
          );
        }

        const issue = parseSavedIssue(issueKey, issueRaw);
        if (!issue.ok) {
          throw corruptRecordError('Saved issue', issueKey, issue.errors);
        }

        const key = noteStorageKey(parsed.value.issueId);
        const existingRaw = records[key];
        let next = parsed.value;

        if (existingRaw !== undefined) {
          const existing = parseIssueNote(existingRaw);
          if (!existing.ok) {
            throw corruptRecordError('Existing note', key, existing.errors);
          }
          next = { ...parsed.value, createdAt: existing.value.createdAt };
          const revalidated = parseIssueNote(next);
          if (!revalidated.ok) {
            throw invalidRecordError('Note update', key, revalidated);
          }
          next = revalidated.value;
          if (shallowEqual(existing.value, next)) {
            return;
          }
        }

        await writeItems({ [key]: next }, metaExists);
      });
    },

    async removeIssue(issueId: string): Promise<void> {
      return queue.run(async () => {
        const records = await readRecords();
        ensureWritable(records);
        const keys = [issueStorageKey(issueId), noteStorageKey(issueId)];

        if (!keys.some((key) => records[key] !== undefined)) {
          return;
        }

        await removeKeys(keys, 'Removing issue');
      });
    },

    async removePullRequest(pullRequestId: string): Promise<void> {
      return queue.run(async () => {
        const records = await readRecords();
        ensureWritable(records);
        const key = pullRequestStorageKey(pullRequestId);

        if (records[key] === undefined) {
          return;
        }

        await removeKeys([key], 'Removing pull request');
      });
    },

    async removeNote(issueId: string): Promise<void> {
      return queue.run(async () => {
        const records = await readRecords();
        ensureWritable(records);
        const key = noteStorageKey(issueId);

        if (records[key] === undefined) {
          return;
        }

        await removeKeys([key], 'Removing note');
      });
    },
  };
}
