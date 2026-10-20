export type StorageWarning =
  | { kind: 'invalid-record'; storageKey: string; reason: string }
  | { kind: 'orphan-note'; issueId: string };
