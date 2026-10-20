# ContribFlow Architecture

Status: M1 foundation, M2 domain/persistence, and M3 GitHub client/background commands are implemented. The popup and dashboard remain shells; product workflows begin in M4-M5.

## Goals

The MVP lets an individual contributor:

1. Save the GitHub issue open in the active tab.
2. Keep one private note per saved issue.
3. Track selected pull requests.
4. Refresh issue and pull request metadata on demand.
5. View, remove, and manage everything in a local dashboard.

All user data stays in `chrome.storage.local`. The extension works with saved data without a network connection; metadata refresh requires GitHub.

## Non-goals

- Accounts, OAuth, personal access tokens, or private repository metadata.
- A backend, sync, payments, analytics, telemetry, or AI services.
- Notifications, background polling, tags, search, or multiple notes per issue.
- CI, review, or mergeability status for pull requests.
- GitHub writes such as commenting, starring, or closing.
- GitHub Enterprise, Firefox, or non-Chrome browsers.
- Reading or modifying the GitHub DOM.

## System context

```text
Popup / Dashboard (React)
        |
        | typed messages (writes and GitHub operations)
        v
Background service worker
        |                    \
        |                     \ anonymous HTTPS
        v                      v
chrome.storage.local      api.github.com
        ^
        | reads + onChanged
        |
Popup / Dashboard
```

The GitHub website is used only as the source of the active tab URL. No host permission is requested for `github.com`, and no content script is injected.

## Layers and boundaries

| Layer | Responsibility | May import |
| --- | --- | --- |
| `entrypoints` | Popup, dashboard, background wiring | All application layers |
| `components` | Presentational React UI and design-system primitives | `domain` types, `lib`; never storage, GitHub, or Chrome APIs |
| `hooks` | React data/state hooks; load snapshots, subscribe to changes, send messages | `storage` read API, `messaging`, `domain` |
| `messaging` | Discriminated request/response contracts, runtime validation, and result envelopes | `domain` types and storage read-contract types |
| `domain` | Types, validators, URL parsing, key rules, status derivation, sorting | TypeScript standard library only |
| `storage` | Repository contract, Chrome adapter, key layout, migrations | `domain`; Chrome/WXT APIs only in the adapter |
| `github` | REST client, response mapping, error taxonomy; injected `fetch` | `domain` types |

Rules:

- UI never writes to storage directly and never calls GitHub. It reads through the repository and listens for changes.
- All mutations and all GitHub requests are handled by the background service worker.
- Only `src/storage/chrome-storage.ts` touches `chrome.storage`; only `src/github/client.ts` calls `fetch`.
- `src/domain` stays pure and fully unit-testable without browser APIs.
- The background serializes mutations through an in-process queue. The queue is not the source of truth; every command re-reads storage.

## Directory structure

```text
.
├─ AGENTS.md
├─ docs/
│  ├─ architecture.md
│  ├─ data-models.md
│  └─ implementation-plan.md
├─ src/
│  ├─ entrypoints/
│  │  ├─ background.ts
│  │  ├─ popup/
│  │  │  ├─ index.html
│  │  │  ├─ main.tsx
│  │  │  └─ App.tsx
│  │  └─ dashboard/
│  │     ├─ index.html
│  │     ├─ main.tsx
│  │     └─ App.tsx
│  ├─ background/
│  │  ├─ command-handler.ts
│  │  └─ errors.ts
│  ├─ components/
│  │  ├─ ui/                  # Button, Input, Textarea, StatusBadge, etc.
│  │  └─ features/            # IssueList, PullRequestList, NoteEditor, TargetCard
│  ├─ domain/
│  │  ├─ models.ts
│  │  ├─ validation.ts
│  │  ├─ github-url.ts
│  │  └─ pull-request-state.ts
│  ├─ storage/
│  │  ├─ keys.ts
│  │  ├─ repository.ts
│  │  ├─ memory-storage.ts
│  │  ├─ chrome-storage.ts
│  │  ├─ migrations.ts
│  │  └─ warnings.ts
│  ├─ github/
│  │  ├─ client.ts
│  │  ├─ errors.ts
│  │  └─ rate-limit.ts
│  ├─ messaging/
│  │  └─ contracts.ts
│  ├─ hooks/
│  ├─ lib/
│  └─ styles/
│     └─ main.css
├─ e2e/
├─ wxt.config.ts
├─ vitest.config.ts
├─ playwright.config.ts
├─ eslint.config.js
├─ tsconfig.json
└─ package.json
```

Unit tests are colocated as `*.test.ts` / `*.test.tsx`. Playwright tests live in `e2e/`.

## Core flows

### Save an issue

1. The user opens the popup. `activeTab` grants temporary access to the active tab.
2. The popup reads the tab URL, and the background re-validates the canonical URL in the `SAVE_ISSUE` message. Unsupported pages are rejected before touching storage.
3. The background writes a placeholder `SavedIssue` (`state: "unknown"`, `title: null`, pending sync error) keyed by canonical id, then fetches public metadata with a timeout and updates the record.
4. If metadata cannot be fetched (rate limit, private repository, offline, malformed response), the placeholder remains with a bounded `lastSyncError`; the command returns success with a structured `syncError` so the UI can explain that metadata will appear after manual refresh.
5. If GitHub reports that the target is a pull request, the placeholder is removed and the command returns `wrong-target-kind`; an issue URL must resolve to an issue.
6. Duplicate saves return the existing record without a network request and never overwrite an existing note.
7. The popup shows the result; the dashboard updates through `chrome.storage.onChanged`.

### Track a pull request

Same placeholder-first flow using `GET /repos/{owner}/{repo}/pulls/{number}` and a `TrackedPullRequest` record. Presence of the record means "tracked"; removing it means "untracked". Duplicate tracking returns the existing record without a network request.

### Refresh metadata

- Triggered only by an explicit user action on one item.
- The background fetches fresh metadata and updates `title`, `state`, `lastSyncedAt`, and `lastSyncError` while preserving local timestamps (`savedAt` / `addedAt`).
- A failed refresh keeps the last known title, state, and `lastSyncedAt`, records a bounded sync error, and returns the typed error.
- Rate limits, timeouts, 404s, 403s without rate-limit evidence, and malformed responses are surfaced in the UI. There are no automatic retries or background polling.
- Commands run through one serialized background queue. Identical refreshes that arrive while a request is in flight share that request instead of fetching twice.

### Notes

- The dashboard note editor edits the single note for a saved issue.
- Saving is explicit. Empty notes are rejected; deletion uses a separate action.
- Notes are stored separately from the issue and are never sent to GitHub.
- Removing an issue removes its note in the same storage operation.

### Dashboard load

1. The dashboard calls `loadSnapshot` on the repository.
2. Each record is validated independently. Valid records render; invalid records remain in storage and produce a visible warning; orphan notes produce a warning and are not shown.
3. The dashboard subscribes to storage changes and re-reads the snapshot after relevant changes (small dataset, no incremental cache required).

## Persistence summary

- Storage area: `chrome.storage.local` only. `storage.sync` is not used.
- Layout: one versioned storage key per entity, plus a metadata key. This avoids whole-document lost updates between the popup and dashboard.
- Keys and record rules: see `docs/data-models.md`.
- Reads validate every record independently. Invalid data is skipped, never deleted automatically, and reported through snapshot warnings.
- `createStorageRepository(port)` implements the contract over a `StoragePort`. The Chrome adapter is the only module touching `chrome.storage`/`wxt/browser`; the in-memory adapter drives unit tests.
- Writes are centralized in the background service worker. The command handler validates a message, serializes the command, and calls a repository that re-reads storage inside its own queue. The first write stores metadata and the record in the same `set` call.
- The command and repository queues only order work inside one background worker. `chrome.storage.local` does not provide multi-context transactions, so the design relies on a single writer plus per-entity keys rather than claiming cross-tab atomicity. Identical in-flight refreshes are coalesced in the command handler.
- Saves write a placeholder before network access and update it afterward; `updateIssue` preserves `savedAt` and requires an existing valid issue. Duplicate issue saves are no-ops, PR upserts preserve `addedAt`, note upserts preserve `createdAt`, and removing an issue removes its note in one storage call.
- Schema version is stored explicitly. `runMigrations` computes a chain in memory and writes changes plus metadata once; failures write nothing. Reads never migrate implicitly, and unsupported newer versions block writes and show an actionable error instead of destroying data.
- The migration runner is not invoked at startup in M3. The v1 registry is empty, the repository already rejects older/newer/corrupt metadata, and there is no startup UI channel for migration failures; wire the runner with the first non-empty migration.
- Storage quota failures are mapped to a typed error; notes are length-limited.

## GitHub integration

| Concern | Decision |
| --- | --- |
| Endpoints | `GET /repos/{owner}/{repo}/issues/{number}`, `GET /repos/{owner}/{repo}/pulls/{number}` |
| Authentication | None. Anonymous public API requests only |
| Headers | `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` |
| Data stored | Only the fields needed by the models; never raw responses |
| Timeout | 10 seconds via `AbortController`; injected `fetch` for tests |
| Rate limit | 429, 403 with `x-ratelimit-remaining: 0`, or 403 with `Retry-After`; surface bounded retry/reset timing; no auto-retry |
| Forbidden | A 403 without rate-limit evidence is a typed HTTP failure, not a rate limit |
| Private/deleted targets | 404/410 is shown as "not found or private"; a reference can still be saved without metadata |
| Malformed payload | Reject with a typed invalid-response error; retain previous state on refresh and the placeholder on save |
| Wrong target kind | The issue payload's non-null `pull_request` field rejects the target; a new issue placeholder is removed |
| Network scope | Only `https://api.github.com/*`; no GitHub page access; requests have no credentials or custom user data |

API calls happen only on explicit save, track, or refresh actions. No `alarms` permission and no background polling.

## Permissions

| Permission | Type | Why it is required | Why no broader alternative |
| --- | --- | --- | --- |
| `storage` | API permission | Persist saved issues, tracked PRs, notes, and schema metadata | Required for any persistence |
| `activeTab` | API permission | Read the active tab URL after the user invokes the extension | Avoids the broader `tabs` permission and persistent access to all tabs |
| `https://api.github.com/*` | Host permission | Fetch public issue and PR metadata from the background worker | Avoids any `github.com` host access, content scripts, or `scripting` |

Not requested: `tabs`, `scripting`, `alarms`, `identity`, `cookies`, `unlimitedStorage`, `<all_urls>`, or access to `https://github.com/*`.

The final manifest is audited in milestone M1. The M0 spike verified in Chrome 155 that `activeTab` exposes the URL and title to the popup on GitHub and non-GitHub pages, and exposes nothing on restricted pages such as `chrome://` (the popup shows an empty state). The fallback of an explicit URL input, not a broader permission, is therefore not needed; behavior is re-checked in M4.

## Security and privacy

- No credentials or secrets are stored or requested. No authentication flow exists.
- Notes and saved references never leave the device. The only outbound requests are anonymous GitHub API reads for the requested public resource.
- No telemetry, analytics, remote configuration, remotely hosted code, or third-party scripts.
- Manifest V3 CSP is kept at the default; no `eval` or dynamic code execution.
- React escapes rendered text; no `dangerouslySetInnerHTML`.
- All stored records are validated on read; API payloads are treated as untrusted and mapped through narrow type guards.
- Runtime messages are validated before routing. Malformed messages receive a typed error and never reach storage or network code.
- API paths are built only from validated owner/repo/number fields; the client never fetches arbitrary or redirect-supplied URLs.
- Stored error messages are generated by the extension and bounded; raw server bodies are not persisted.
- GitHub URLs are parsed and canonicalized; only `https://github.com` owner/repo issue/PR URLs are accepted.

## UI and design direction

- Monochrome design tokens: white background, near-black text, neutral grays for surfaces, borders, and muted text. No gradients or decorative imagery.
- System font stack; monospace only for repository references and numbers. Compact type scale and a 4/8/12/16/24 spacing scale.
- Popup: fixed width around 380px, max height around 600px, usable without horizontal scrolling.
- Dashboard: full tab, max width around 960px, responsive stacking on narrow viewports.
- Small border radii and subtle 1px borders; minimal elevation.
- Status labels use text plus shape, never color alone. "Open", "Draft", "Closed", and "Merged" remain distinguishable in grayscale.
- Visible focus styles, semantic landmarks, labels, keyboard-operable controls, and announced async results. No unnecessary motion.
- Every surface defines loading, empty, and error states. Per-item refresh and save failures are visible, not swallowed.

## Testing strategy

| Level | Tool | Coverage |
| --- | --- | --- |
| Unit | Vitest (Node) | URL parsing and canonicalization, validators, key rules, status derivation, migrations, repository with an in-memory adapter, GitHub client success/error paths with fake `fetch`, rate-limit parsing, message contracts, background command handler with in-memory repository and fake GitHub, sorting |
| Component | Vitest + Testing Library (jsdom) | Popup target/save states, note editor, list empty/loading/error states, status badges |
| End-to-end | Playwright with a persistent bundled Chromium (Chrome for Testing) context | Extension loads, background message round trip, mocked save/snapshot/remove flow, popup save/track flow, dashboard note persistence, refresh failure messaging, reload persistence |
| Manual Chrome checks | Chrome | Permission prompts/manifest, `activeTab` behavior, CSP, network panel shows only `api.github.com`, persistence after browser restart |

Playwright tests must not depend on the live GitHub API. Playwright loads extensions with its bundled Chromium because branded Chrome can no longer install unpacked extensions via command-line flags (removed in Chrome 137); M1 verified that the production build loads in headless bundled Chromium and that `browserContext.route()` intercepts service-worker `api.github.com` fetches, so E2E runs deterministically offline. The injected-fetch unit tests remain the primary coverage for error paths and payload mapping. `docs/feasibility-report.md` records the evidence.

## Technical risks

| Risk | Impact | Mitigation | How to verify |
| --- | --- | --- | --- |
| Anonymous API limit (60 requests/hour/IP) and private repos | Refresh/save metadata fails | Fetch only on explicit actions; cache; allow saving without metadata; show reset time; no retries or polling | Fake-fetch unit tests for 403/429; E2E mocked rate-limit state; manual check of message and reset display |
| Playwright cannot intercept MV3 service-worker fetches | E2E network mocking is flaky or impossible | Resolved in M1: `browserContext.route()` intercepts service-worker requests reliably; E2E mocks `api.github.com` and never calls the live API | M1 E2E suite passes offline, including repeated runs |
| `activeTab` URL availability or lifecycle | Popup cannot identify the current issue/PR | Verify in real Chrome early; show actionable error; consider explicit URL input as an approved fallback | M0/M4 manual test on GitHub tabs and non-GitHub tabs |
| Service worker termination and concurrent writers | Lost updates or inconsistent records | Stateless handlers, re-read before mutate, serialized command/repository queues, in-flight refresh coalescing, per-entity keys; no multi-context transaction claim | Handler concurrency/coalescing tests; repository concurrency tests (serialized writes, queued note/remove ordering, last-write-wins); manual/idle reload test; E2E parallel save |
| Corrupt or incompatible stored data | Dashboard crash or data loss | Validate each record, skip without deleting, surface warnings, version metadata, block unsupported newer versions | Fixture tests with malformed records and unknown schema version |
| Storage quota exceeded | Saves/notes fail | Bounded note length, small records, catch quota errors, clear UI error | Fake adapter tests for quota rejection; manual large-note check |
| URL edge cases (PR tabs, trailing paths, query strings, case, fake hosts) | Wrong target saved or duplicate records | Pure parser with a broad table-driven test suite; canonical ids and URLs | Unit tests plus active-tab tests |
| Tailwind/WXT/Vite version incompatibility | Build failures or missing styles | Pin stable compatible versions at M1 (candidates and constraints in `docs/feasibility-report.md`), commit lockfile, follow official integration docs | `pnpm build`, load unpacked, visual smoke test |
| Chrome 137+ removed `--load-extension` for branded builds | `pnpm dev` cannot auto-launch the installed Chrome; E2E cannot use system Chrome | Use Chrome for Testing/Chromium for dev and Playwright's bundled Chromium for E2E, or disable `webExt` and load unpacked manually; M0 confirmed unpacked loading still works via CDP | M1 dev-browser check; Playwright load test in M1 |
| Monochrome accessibility | Status/actions indistinguishable or low contrast | Text-plus-shape badges, contrast checks, focus states, keyboard tests | Manual contrast/focus audit and keyboard E2E |
| GitHub response shape drift | Mapping fails or shows wrong state | Narrow DTO guards, typed errors, preserve last known state, surface sync error | Fixture tests including malformed payloads |

## Decisions pending approval

1. Use the anonymous public GitHub REST API for metadata (recommended) versus URL-only references with no API access.
2. Ship both a compact popup and a full-page dashboard (recommended) versus popup only.
3. One note per saved issue, stored separately from the issue (recommended).
4. PR tracking covers state only (open/draft/closed/merged) with manual refresh, not CI/review status or polling (recommended).
5. Hand-written validators instead of a schema library, to keep runtime dependencies minimal (recommended for this fixed, small model set).

Implementation starts only after approval, beginning with milestone M0 in `docs/implementation-plan.md`.
