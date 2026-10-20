# Initial Data Models

Status: implemented in M2 for MVP schema version 1. These definitions are the contract for storage, messaging, and tests.

Implementation lives in `src/domain/models.ts`, `validation.ts`, `github-url.ts`, and `pull-request-state.ts`, plus `src/storage/keys.ts`, `repository.ts`, `memory-storage.ts`, `chrome-storage.ts`, and `migrations.ts`. Background commands in `src/background/` and message contracts in `src/messaging/` enforce these rules at the runtime boundary. Unit tests are colocated.

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

`parseGitHubUrl(input: unknown)` returns `{ ok: true, target }` or `{ ok: false, reason, message }`. The accepted matrix is:

| Input shape | Result |
| --- | --- |
| `https://github.com/<owner>/<repo>/issues/<number>` | Issue target |
| `https://github.com/<owner>/<repo>/pull/<number>` | Pull request target |
| Either form with trailing `/` or `///` | Accepted; slashes removed |
| Either form with `?query`, `#fragment`, or both | Accepted; query and fragment removed |
| Issue form with extra trailing path segments (for example `/issues/42/anything`) | Accepted; extra segments removed |
| Pull request form with PR tab subpaths (for example `/files`, `/commits/<sha>`) | Accepted; extra segments removed |
| Surrounding whitespace, or a host written as `GitHub.COM` | Accepted; trimmed and normalized |
| Owner with allowed hyphens; repo with allowed hyphens, underscores, or dots | Accepted within the syntax rules below |
| Number `1` through `2147483647` with no leading zero | Accepted |

Rejected inputs (with the parser's `reason`):

| Input | Reason |
| --- | --- |
| Empty, whitespace-only, or unparseable string; non-string values | `invalid-url` |
| `http://` or any non-HTTPS scheme | `unsupported-scheme` |
| `gitlab.com`, `www.github.com`, `api.github.com`, `gist.github.com`, subdomains, or suffix tricks such as `github.com.evil.com` | `unsupported-host` |
| URLs containing a username or password | `credentials-not-allowed` |
| An explicit non-default port such as `github.com:8443` | `port-not-allowed` |
| Missing, empty, or doubled path segments (for example `/issues/1//files`) | `invalid-path` |
| `/pulls/<number>`, `/tree/...`, or path kinds with different casing such as `/Issues/1` | `unsupported-target-kind` |
| `/issues/new` or `/pull/new` | `reserved-path` |
| Number `0`, leading-zero numbers, values above `2147483647`, decimals, exponents, hex, negatives, non-numeric or percent-encoded text | `invalid-number` |
| Owner or repo that violates the syntax rules, including dot segments normalized by `URL` | `invalid-owner` / `invalid-repo` |

Rules:

- Host must be exactly `github.com`; no credentials, ports, or alternate hosts.
- Scheme must be `https`.
- Query strings and fragments are ignored. Trailing path segments after the number are ignored, but an empty segment in the path is invalid.
- Owner and repo are syntax-checked before use.
- The result includes `kind`, `owner`, `repo`, `number`, `url`, and canonical `id`.
- An `/issues/<number>` URL is always classified as an issue. GitHub redirects it to `/pull/<number>` when the number belongs to a pull request (observed in M0: `octocat/Hello-World/issues/1` -> `/pull/1`). The final, post-redirect tab URL decides the kind.

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

If the meta key is missing and no data keys exist, the dataset is empty schema v1. If data exists without valid meta, load fails with a visible corruption error rather than guessing and overwriting. If `schemaVersion` is newer than supported, reads render an "update the extension" error and writes are blocked. An older metadata version blocks reads with `migration-failed` and writes with `schema-migration-required`; migrations are never applied implicitly by a read.

Load treats these conditions as warnings while keeping the underlying keys in storage:

- A `contribflow.*` key that cannot be parsed, uses a version other than the supported one, or does not match its record id.
- A valid record that fails field validation.
- A valid note whose issue is missing (`orphan-note`).

Keys outside the `contribflow.` namespace are ignored and preserved.

## Repository contract

UI contexts receive a read-only interface. The background service worker owns the write interface.

```ts
interface StorageReader {
  loadSnapshot(): Promise<LoadSnapshotResult>;
  subscribe(listener: (change: StorageChangeSummary) => void): () => void;
}

interface StorageRepository extends StorageReader {
  saveIssue(issue: SavedIssue): Promise<void>;       // insert-only
  updateIssue(issue: SavedIssue): Promise<void>;     // requires an existing issue
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

`loadSnapshot` never throws for storage, metadata, or migration errors; it returns the typed result above. Subscription callbacks receive only changed keys that parse as ContribFlow keys.

Write commands reject with the exported `StorageRepositoryError`, whose `kind` is one of:

| Kind | Meaning |
| --- | --- |
| `invalid-record` | The input record fails validation; nothing is written |
| `corrupt-record` | An existing record for the same key is invalid; it is left untouched |
| `corrupt-metadata` | Meta is missing alongside data, or is invalid |
| `unsupported-schema` | Stored metadata is newer than the extension supports |
| `schema-migration-required` | Stored metadata is older and must be migrated first |
| `missing-issue` | A note or issue update targets an issue that is not saved |
| `quota-exceeded` | Chrome rejected the write because the storage quota was exceeded |
| `unavailable` | The storage adapter failed for another reason |

The repository is created with `createStorageRepository(port)`. `createMemoryStorageHarness()` / `createMemoryStorageRepository()` provide the in-memory adapter used by tests, and `createChromeStorageRepository()` provides the production adapter. The Chrome adapter is the only module that touches `chrome.storage` or WXT browser APIs.

## Lifecycle rules

- Save issue: insert-only and idempotent by id. A valid existing issue is left unchanged; notes are never overwritten. An invalid existing record blocks the save with `corrupt-record`.
- Update issue: requires a valid existing issue, preserves the stored `savedAt`, validates the full record, and skips identical writes. Missing issues fail with `missing-issue`; corrupt existing records are left untouched.
- Save PR: upsert by id. A refresh updates metadata while preserving `addedAt`; identical upserts do not write. An invalid existing record blocks the write.
- Refresh: replaces the metadata fields only; local timestamps (`savedAt` / `addedAt`) and notes are preserved.
- Remove issue: removes the issue and note keys in one `remove` call, and also removes an orphan note for that id. Missing keys are a no-op.
- Save note: requires a valid existing issue; upserts the single note, updates `updatedAt`, and preserves the stored `createdAt`.
- Delete note: independent action; empty note bodies are invalid rather than implicitly deleting.
- Orphan notes (missing issue) are kept, reported as warnings, and not displayed.
- Invalid records are kept, reported, and excluded from the UI.
- The first write to an empty store writes the meta key and the record in one `set` call. Every mutation validates meta before writing, including no-op duplicates.
- One repository instance serializes mutations through an in-process promise queue and re-reads storage inside the queued command. The queue is not persisted and does not provide a cross-context or multi-tab transaction. Per-entity keys avoid whole-dataset lost updates, and a single background worker is the only writer.

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

- v1 has no migrations; the registry is empty. The runner and version checks are implemented at M2 so schema changes are possible.
- `runMigrations(port, { migrations, supportedVersion })` reads the store, follows a chain from the stored version, applies each step to an in-memory copy, then writes only the changed keys plus new metadata in one `set` call.
- The runner is idempotent: a store already at the supported version performs no write. An empty store without data keys is treated as current.
- Missing steps, duplicate or non-advancing definitions, steps beyond the supported version, malformed metadata, a newer stored version, and thrown migration errors all return typed failures without writing. A failed later step leaves earlier in-memory changes unapplied.
- Migrations cannot delete keys through this interface; unrelated data and keys outside the namespace are preserved.
- The migration runner is not invoked at startup in M3. The v1 registry is empty, repository reads/writes already gate schema versions, and there is no startup UI channel for migration failures; wire the runner with the first non-empty migration. Ordinary reads never migrate.
- Every migration is tested against stored fixture payloads.
- Unknown or newer schema versions are never downgraded, rewritten, or cleared.
- Adding fields may be backward-compatible within v1 only if readers tolerate missing values; any change to required fields or key layout requires a new schema version.
