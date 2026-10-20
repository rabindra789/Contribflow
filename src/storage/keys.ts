import { SCHEMA_VERSION } from '../domain/models';

export const STORAGE_NAMESPACE = 'contribflow';

const META_PATTERN = /^contribflow\.v(\d+)\.meta$/;
const DATA_PATTERN = /^contribflow\.v(\d+)\.(issue|pr|note)\.(.+)$/;

export type ParsedStorageKey =
  | { kind: 'meta'; schemaVersion: number }
  | { kind: 'issue'; schemaVersion: number; id: string }
  | { kind: 'pull-request'; schemaVersion: number; id: string }
  | { kind: 'note'; schemaVersion: number; issueId: string };

function isSchemaVersionText(value: string): boolean {
  const version = Number(value);
  return Number.isInteger(version) && version >= 1 && String(version) === value;
}

export function metaStorageKey(schemaVersion: number = SCHEMA_VERSION): string {
  return `${STORAGE_NAMESPACE}.v${schemaVersion}.meta`;
}

export function issueStorageKey(id: string, schemaVersion: number = SCHEMA_VERSION): string {
  return `${STORAGE_NAMESPACE}.v${schemaVersion}.issue.${id}`;
}

export function pullRequestStorageKey(
  id: string,
  schemaVersion: number = SCHEMA_VERSION,
): string {
  return `${STORAGE_NAMESPACE}.v${schemaVersion}.pr.${id}`;
}

export function noteStorageKey(issueId: string, schemaVersion: number = SCHEMA_VERSION): string {
  return `${STORAGE_NAMESPACE}.v${schemaVersion}.note.${issueId}`;
}

export const META_KEY = metaStorageKey();

export function parseStorageKey(key: unknown): ParsedStorageKey | null {
  if (typeof key !== 'string') {
    return null;
  }

  const metaMatch = META_PATTERN.exec(key);
  if (metaMatch !== null) {
    const versionText = metaMatch[1];
    if (versionText === undefined || !isSchemaVersionText(versionText)) {
      return null;
    }
    return { kind: 'meta', schemaVersion: Number(versionText) };
  }

  const dataMatch = DATA_PATTERN.exec(key);
  if (dataMatch === null) {
    return null;
  }

  const versionText = dataMatch[1];
  const kindText = dataMatch[2];
  const suffix = dataMatch[3];
  if (
    versionText === undefined ||
    kindText === undefined ||
    suffix === undefined ||
    !isSchemaVersionText(versionText)
  ) {
    return null;
  }

  const schemaVersion = Number(versionText);
  if (kindText === 'issue') {
    return { kind: 'issue', schemaVersion, id: suffix };
  }
  if (kindText === 'pr') {
    return { kind: 'pull-request', schemaVersion, id: suffix };
  }
  return { kind: 'note', schemaVersion, issueId: suffix };
}
