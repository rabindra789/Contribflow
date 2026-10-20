# Initial Data Models

Status: proposed for MVP schema version 1. These definitions are the contract for storage, messaging, and tests.

## Conventions

- Timestamps are canonical ISO 8601 UTC strings produced by `Date.prototype.toISOString()` (for example `2026-10-19T12:34:56.789Z`).
- A canonical target id is `<owner>/<repo>#<number>`, with owner and repo lowercased for identity and the number as a positive integer. Issue and pull request ids share this format but live in different storage namespaces.
- Display casing for `owner` and `repo` is preserved from the saved URL. Identity comparisons use the lowercase id only.
- Canonical URLs use `https://github.com/<owner>/<repo>/issues/<number>` and `https://github.com/<owner>/<repo>/pull/<number>`.
- `number` is an integer in the range `1..2147483647`.
- Unknown extra fields are ignored on read; records are rewritten from the typed fields.
- Every value read from storage or received from the GitHub API is `unknown` until validated.

## Core types

```ts
// src/domain/models.ts
export type IsoTimestamp = string;
export type IssueState = 'open' | 'closed' | 'unknown';
export type PullRequestState = 'open' | 'draft' | 'closed' | 'merged' | 'unknown';
export type TargetKind = 'issue' | 'pull_request';

export interface SavedIssue {
  id: string;                       // canonical target id
  owner: string;
  repo: string;
  number: number;
  url: string;                      // canonical issue URL
  title: string | null;             // null until metadata has been fetched
  state: IssueState;
  savedAt: IsoTimestamp;
  lastSyncedAt: IsoTimestamp | null;
  lastSyncError: string | null;     // bounded, extension-generated message
}

export interface TrackedPullRequest {
  id: string;                       // canonical target id
  owner: string;
  repo: string;
  number: number;
  url: string;                      // canonical pull request URL
  title: string | null;
  state: PullRequestState;
  addedAt: IsoTimestamp;
  lastSyncedAt: IsoTimestamp | null;
  lastSyncError: string | null;
}

export interface IssueNote {
  issueId: string;                  // SavedIssue.id
  body: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface StorageMeta {
  schemaVersion: 1;
}
```

`SavedIssue` and `TrackedPullRequest` deliberately store a metadata snapshot rather than raw GitHub responses. The presence of a `TrackedPullRequest` record is the tracking state.

## Field rules

| Field | Rule |
| --- | --- |
| `id` | Must equal the lowercased `owner`/`repo` plus `#` plus `number`; must match the storage key suffix |
| `owner` | 1-39 characters, `[A-Za-z0-9-]`; no leading or trailing hyphen |
| `repo` | 1-100 characters, `[A-Za-z0-9._-]`; not `.` or `..` |
| `number` | Integer, `1..2147483647` |
| `url` | Valid canonical URL for the same kind, owner, repo, and number |
| `title` | `null` or 1-512 characters; control characters other than normal text are rejected |
| `state` | One of the enum values; issues cannot be `draft` or `merged` |
| `savedAt` / `addedAt` | Valid canonical timestamp |
| `lastSyncedAt` | `null` or valid canonical timestamp; never earlier than `savedAt`/`addedAt` |
| `lastSyncError` | `null` or 1-300 characters; extension-generated, no raw response body or secrets |
| `IssueNote.body` | 1-10,000 UTF-16 code units after trimming; must contain non-whitespace; newlines preserved |
| `IssueNote.createdAt` / `updatedAt` | Valid canonical timestamps; `updatedAt >= createdAt` |
| `IssueNote.issueId` | Must reference an existing `SavedIssue`; otherwise reported as an orphan warning |

Validation is implemented as hand-written type guards returning explicit errors, for example:

```ts
type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function parseSavedIssue(storageKey: string, value: unknown): ValidationResult<SavedIssue>;
function parseTrackedPullRequest(storageKey: string, value: unknown): ValidationResult<TrackedPullRequest>;
function parseIssueNote(value: unknown): ValidationResult<IssueNote>;
```

Validators never mutate or delete invalid data.

## State semantics

### Issues

GitHub issue state is mapped directly:

- `open` - GitHub reports open.
- `closed` - GitHub reports closed.
- `unknown` - metadata has never been fetched successfully. `title` is `null`, `lastSyncedAt` is `null`, and `lastSyncError` is set.

### Pull requests

The stored state is derived from GitHub fields, in this order:

1. `merged_at != null` -> `merged`
2. `state == "closed"` -> `closed`
3. `state == "open" && draft == true` -> `draft`
4. `state == "open"` -> `open`
5. Never successfully fetched -> `unknown`

Anything else is an invalid API response.

### Sync failures

- A failed refresh keeps the last known `title`, `state`, and `lastSyncedAt`, and sets `lastSyncError`.
- A successful refresh replaces the metadata snapshot and clears `lastSyncError`.
- A target saved while metadata is unavailable is still persisted with `unknown`, `null` title, and an error message.
- `lastSyncedAt` records local sync time, not GitHub's `updated_at`.
- No credentials are ever stored, so failures must not expose tokens or raw headers.

## URL parsing

`parseGitHubUrl(input: string)` accepts only:

- `https://github.com/<owner>/<repo>/issues/<number>`
- `https://github.com/<owner>/<repo>/pull/<number>`

Rules:

- Host must be exactly `github.com`; no credentials, ports, or alternate hosts.
- Scheme must be `https`.
- Paths may have trailing slashes, query strings, or fragments; these are removed.
- Extra trailing path segments are accepted and canonicalized away (for example `/pull/123/files`) so PR tabs work.
- Reserved paths such as `/issues/new` and non-numeric numbers are rejected.
- Owner and repo are syntax-checked before use.
- The result includes `kind`, `owner`, `repo`, `number`, `url`, and canonical `id`.
- GitHub redirects `/issues/<number>` to `/pull/<number>` when that number belongs to a pull request (observed in M0: `octocat/Hello-World/issues/1` -> `/pull/1`). The final, post-redirect tab URL decides whether the target is an issue or a pull request.

Parsing is pure and table-tested. The active tab URL is read only after the user invokes the extension; no DOM inspection is used. The popup parses the tab's final URL, so a redirected target is classified by the page actually shown.

## Storage layout

Values are stored as separate keys in `chrome.storage.local`:

| Key | Value |
| --- | --- |
| `contribflow.v1.meta` | `StorageMeta` |
| `contribflow.v1.issue.<id>` | `SavedIssue` |
| `contribflow.v1.pr.<id>` | `TrackedPullRequest` |
| `contribflow.v1.note.<id>` | `IssueNote`, where `<id>` is a `SavedIssue.id` |

Rationale:

- Per-entity keys prevent a read-modify-write of the entire dataset and reduce lost updates when the popup and dashboard are open together.
- Prefix scanning is acceptable for a small local dataset.
- The namespace carries the schema version, so future incompatible layouts can be migrated explicitly.
- The key suffix is verified against the record id; mismatches are treated as invalid records.

If the meta key is missing and no data keys exist, the dataset is empty schema v1. If data exists without valid meta, load fails with a visible corruption error rather than guessing and overwriting. If `schemaVersion` is newer than supported, reads render an "update the extension" error and writes are blocked.

## Repository contract

UI contexts receive a read-only interface. The background service worker owns the write interface.

```ts
interface StorageReader {
  loadSnapshot(): Promise<LoadSnapshotResult>;
  subscribe(listener: (change: StorageChangeSummary) => void): () => void;
}

interface StorageRepository extends StorageReader {
  saveIssue(issue: SavedIssue): Promise<void>;
  savePullRequest(pullRequest: TrackedPullRequest): Promise<void>;
  saveNote(note: IssueNote): Promise<void>;          // upsert
  removeIssue(issueId: string): Promise<void>;       // removes its note too
  removePullRequest(pullRequestId: string): Promise<void>;
  removeNote(issueId: string): Promise<void>;
}

interface StorageSnapshot {
  issues: SavedIssue[];
  pullRequests: TrackedPullRequest[];
  notes: Record<string, IssueNote>; // keyed by issue id
  warnings: StorageWarning[];
}

type StorageWarning =
  | { kind: 'invalid-record'; storageKey: string; reason: string }
  | { kind: 'orphan-note'; issueId: string };

type LoadSnapshotResult =
  | { ok: true; snapshot: StorageSnapshot }
  | {
      ok: false;
      error:
        | { kind: 'unavailable'; message: string }
        | { kind: 'corrupt-metadata'; message: string }
        | { kind: 'unsupported-schema'; found: number; supported: number }
        | { kind: 'migration-failed'; message: string };
    };
```

The in-memory adapter used by tests implements the same interface. The Chrome adapter is the only module that touches `chrome.storage`.

## Lifecycle rules

- Save issue: idempotent by id. An existing issue is returned unchanged; notes are never overwritten.
- Save PR: idempotent by id; an existing record is refreshed rather than duplicated.
- Refresh: replaces the metadata fields only; local timestamps (`savedAt` / `addedAt`) and notes are preserved.
- Remove issue: removes the issue and note keys in one `remove` call.
- Save note: requires an existing issue; updates `updatedAt` and preserves `createdAt`.
- Delete note: independent action; empty note bodies are invalid rather than implicitly deleting.
- Orphan notes (missing issue) are kept, reported as warnings, and not displayed.
- Invalid records are kept, reported, and excluded from the UI.
- The background serializes mutations and re-reads current state before read-modify-write commands.

## Limits

- Note body: 10,000 UTF-16 code units.
- Title: 512 characters.
- Sync error message: 300 characters.
- No artificial item-count limit is enforced in v1; storage quota errors are surfaced to the user.
- Raw API responses, request headers, ETags, and tokens are never persisted.

## Examples

```json
{
  "id": "microsoft/typescript#12345",
  "owner": "microsoft",
  "repo": "TypeScript",
  "number": 12345,
  "url": "https://github.com/microsoft/TypeScript/issues/12345",
  "title": "Improve inference for generic callbacks",
  "state": "open",
  "savedAt": "2026-10-19T09:15:00.000Z",
  "lastSyncedAt": "2026-10-19T09:15:02.120Z",
  "lastSyncError": null
}
```

```json
{
  "id": "vercel/next.js#67890",
  "owner": "vercel",
  "repo": "next.js",
  "number": 67890,
  "url": "https://github.com/vercel/next.js/pull/67890",
  "title": "Fix routing regression",
  "state": "draft",
  "addedAt": "2026-10-19T10:00:00.000Z",
  "lastSyncedAt": "2026-10-19T10:00:01.450Z",
  "lastSyncError": null
}
```

```json
{
  "issueId": "microsoft/typescript#12345",
  "body": "Reproduce with strict mode enabled. Check the related discussion in #12200.",
  "createdAt": "2026-10-19T09:20:00.000Z",
  "updatedAt": "2026-10-19T09:25:30.000Z"
}
```

## Migration policy

- v1 has no migrations. The migration runner and version check are still implemented at M2 so schema changes are possible.
- Migrations run in the background before command handling and are idempotent.
- A migration failure leaves original data untouched, blocks writes, and reports a visible error.
- Every migration is tested against stored fixture payloads.
- Unknown or newer schema versions are never downgraded, rewritten, or cleared.
- Adding fields may be backward-compatible within v1 only if readers tolerate missing values; any change to required fields or key layout requires a new schema version.
