# Implementation Plan

Status: M0-M3 complete and under review. M4.1 (popup target/action workflow) is complete and under review. M4.2 (dashboard workspace, including link/counts, notes, filters, and live updates) is implemented. M5 (dashboard) is implemented and verified by automated tests; manual verification checks are pending. M6 release hardening remains.

## Ground rules

- Each milestone is independently verifiable and ends with a working build.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and relevant E2E checks before marking a milestone complete.
- Add tests for business logic in the same milestone as the logic.
- Automated tests never call the live GitHub API.
- Pin stable, compatible package versions at M1, commit the lockfile, and avoid unnecessary dependencies.
- No permission, scope, or architecture changes without updating the docs and getting approval.
- New dependencies require a stated reason and approval.

## M0 - Feasibility spikes

Timeboxed, throwaway validation. Findings are recorded before building the product.

Status: executed 2026-10-19 to 2026-10-20. Evidence and assumptions are recorded in `docs/feasibility-report.md`.

### Goals

1. Confirm a current stable WXT + React + TypeScript + Tailwind CSS setup builds a Chrome MV3 extension.
2. Confirm Playwright can load the built extension in a persistent Chromium context and determine a deterministic way to mock `api.github.com` requests made by the service worker.
3. Confirm that opening the popup under `activeTab` exposes the active tab URL, including on GitHub issue and PR pages.
4. Record exact package versions and any fallback decisions.

### Acceptance

- A minimal extension builds and loads unpacked in Chrome.
- Playwright either intercepts the service-worker request path, or the documented fallback is chosen: keep the GitHub client under injected-`fetch` unit tests and drive E2E from deterministic storage/state setup.
- `activeTab` behavior is verified. If it is insufficient, explicit URL input is proposed as a product change rather than adding `tabs`.
- Findings and version choices are added to the docs.

### Results

Recorded in `docs/feasibility-report.md`:

- Verified with a throwaway CDP spike in Chrome 155: unpacked loading via the `Extensions` domain, `activeTab` URL/title in the popup (`null` on restricted pages), background messaging, service-worker restart on action, `chrome.storage.local` writes, and the 10 MiB quota.
- Deferred to M1 because M0 prohibited installing dependencies: the WXT + React + TypeScript + Tailwind build, and Playwright extension loading plus service-worker fetch interception with bundled Chromium.
- Candidate versions were checked against the npm registry; TypeScript stays `<6.1` until `typescript-eslint` supports 7.x, and jsdom stays `29.x` on Node 24.14.0.
- Chrome 137+ removed `--load-extension` for branded builds, so M1 must choose the development browser strategy rather than relying on WXT auto-launching the installed Chrome.

## M1 - Foundation

Depends on M0.

### Deliverables

- Scaffold WXT + React + TypeScript in strict mode using pnpm.
- Tailwind CSS with monochrome design tokens.
- Manifest with only `storage`, `activeTab`, and `https://api.github.com/*` host access.
- Popup and dashboard HTML entrypoints with a minimal shell; background service worker stub.
- ESLint, Vitest, Playwright configuration, and `package.json` scripts.
- Proposed directory structure from `docs/architecture.md`, with no empty placeholder modules.
- `.gitignore`, lockfile, and updated command documentation.
- Deferred M0 evidence checks: build with the pinned versions, and load the built extension with Playwright's bundled Chromium.
- Development browser strategy documented: a Chrome for Testing/Chromium binary (the Playwright download can serve both dev and tests) or `webExt` disabled with manual unpacked loading.

### Acceptance

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm zip` succeed.
- The unpacked build loads in Chrome without manifest errors.
- Popup and dashboard open and render the monochrome shell.
- The installed permission list matches the architecture document.
- Playwright loads the built extension in its bundled Chromium; if service-worker request interception does not work, the documented fallback is adopted and recorded.
- `docs/feasibility-report.md` is updated with the deferred M0 results.
- No storage, GitHub, or feature logic is implemented yet.

### Results

Status: complete, awaiting review. Executed 2026-10-20.

- Dependencies installed with pnpm 12.14.0 on Node 24.14.0; direct versions are pinned exactly in `package.json` and locked in `pnpm-lock.yaml`.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm zip` pass; the archive is written to `.output/contribflow-0.1.0-chrome.zip`.
- The generated manifest contains only `storage`, `activeTab`, and `https://api.github.com/*`, with no content scripts; `popup.html` and `dashboard.html` are both present in the build.
- Playwright loads the production build in bundled Chrome for Testing 156 (headless) and `browserContext.route()` intercepts service-worker `https://api.github.com/*` fetches, so the E2E suite runs deterministically without live API calls; 4 tests pass, and the interception test passed 3 consecutive repeat runs.
- A branded Chrome 155 smoke test loaded `.output/chrome-mv3`, rendered the popup and dashboard with Tailwind styles applied, and confirmed the same manifest.
- Dev browser strategy: `web-ext` is not installed; `pnpm dev` builds `.output/chrome-mv3-dev` and instructs the user to load it manually, as documented in `README.md`.
- Full evidence and version deviations: `docs/feasibility-report.md`, "M1 addendum".

## M2 - Domain and persistence

Depends on M1.

### Deliverables

- Data types, validators, canonical key/URL helpers, and PR state derivation.
- `parseGitHubUrl` with a documented accepted-URL matrix.
- Storage key helpers, read/write repository contract, Chrome adapter, in-memory adapter, schema metadata, and migration runner/version check.
- Snapshot loading with isolated validation, invalid-record warnings, orphan-note warnings, and typed load errors.
- Colocated unit tests.

### Acceptance

- URL tests cover issue/PR URLs, PR subpaths, query/fragment, trailing slashes, case, unsupported hosts, reserved paths, and malformed numbers.
- Validator tests reject every invalid field combination and verify id/URL/key consistency.
- Round-trip tests prove valid records survive save/load.
- Corrupt records remain in storage, are skipped, and produce warnings.
- Missing metadata, newer schema versions, migration failures, and storage quota errors are surfaced with typed errors.
- `src/domain` imports no React, WXT, or Chrome APIs; only the Chrome adapter touches `chrome.storage`.

### Results

Status: complete, awaiting review. Executed 2026-10-20.

- Implemented `src/domain/models.ts`, `validation.ts`, `github-url.ts`, and `pull-request-state.ts` with hand-written validation and canonical id/URL helpers; no new dependencies.
- Implemented `src/storage/keys.ts`, `repository.ts`, `memory-storage.ts`, `chrome-storage.ts`, `migrations.ts`, and `warnings.ts`. The Chrome adapter is the only module importing `wxt/browser`.
- The URL matrix is documented in `docs/data-models.md`; 71 parser cases cover issue/PR forms, tabs, query/fragment, trailing paths, case, hosts, credentials, ports, reserved paths, and malformed numbers.
- Repository tests cover round trips, duplicate issue saves, PR refreshes preserving `addedAt`, note create/update preserving `createdAt`, missing-issue rejection, one-call removal cascades, unrelated-key preservation, warnings, metadata failures, quota/read/remove failures, subscriptions, and serialized concurrent writes.
- Migration tests use stored v1 fixture payloads and cover chained step order, single-write application, idempotence, missing steps, thrown/non-record results, invalid registries, newer/corrupt/missing metadata, and read/write failures. v1 has an empty registry.
- Full unit suite: 9 files, 301 tests passing. `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm zip`, and `pnpm test:e2e` (4 tests) pass.
- The manifest is unchanged: `storage`, `activeTab`, and `https://api.github.com/*` only. Production build is 229.88 kB; zip is 72.89 kB.
- Not yet implemented, by design: GitHub API client, typed background commands/messaging, storage-to-UI wiring, and functional popup/dashboard flows. The migration runner is not yet invoked because no command handling exists; that wiring belongs to M3.

## M3 - GitHub client and background commands

Depends on M2.

### Deliverables

- GitHub REST client with injected `fetch`, 10-second abort timeout, runtime response validation, and typed errors for invalid input, not found, rate limit, network, timeout, unexpected HTTP, malformed response, and wrong target kind.
- Rate-limit reset extraction and user-facing, bounded error messages.
- Typed message contracts with runtime payload validation and a result envelope.
- Background handlers for save issue, track/refresh PR, refresh issue, remove issue (with note), remove PR, save note, and delete note.
- Serialized mutation queue, idempotency, and in-flight refresh coalescing.

### Acceptance

- Fake-`fetch` tests cover success, 404, 403 rate limit, 429, 5xx, network failure, timeout, and malformed payloads.
- Failed metadata fetch still persists a reference with `unknown` state, null title, and a sync error; an existing successful snapshot is retained on refresh failure.
- Duplicate save/track is idempotent and never overwrites notes.
- Removing an issue removes its note in one storage operation.
- Concurrent commands do not lose updates.
- No raw GitHub response is persisted; no request headers or secrets are stored.
- UI code has no write access or direct GitHub access; the background is the only writer.

### Results

Status: complete, awaiting review. Executed 2026-10-20.

- Implemented `src/github/client.ts`, `errors.ts`, and `rate-limit.ts`: fixed `api.github.com` endpoints, encoded owner/repo paths, no credentials, required API headers, 10-second `AbortController` timeout, injected `fetch`, runtime payload validation, issue-vs-PR detection through `pull_request`, and stored-state derivation for pull requests.
- Rate limits are recognized only from 429, `x-ratelimit-remaining: 0`, or `Retry-After`; a 403 without that evidence is a typed HTTP failure, not a rate limit. Reset/retry timing is bounded and optional headers are tolerated.
- Implemented `src/messaging/contracts.ts` with nine commands, strict runtime parsing, explicit extra-field rejection, a discriminated result envelope, and a serializable error taxonomy. Malformed messages never reach storage or network code.
- Implemented `src/background/command-handler.ts` and `errors.ts`: one command handler over injected repository/GitHub/clock, a serialized command queue, identical in-flight refresh coalescing, placeholder-first saves, metadata updates, bounded sync errors, removal cascades, and safe mapping of GitHub/storage/unknown failures.
- Added `StorageRepository.updateIssue` because M2 `saveIssue` is intentionally insert-only; updates preserve `savedAt`, require an existing valid issue, and no-op when unchanged.
- Wired one WXT runtime listener in `src/entrypoints/background.ts`; it ignores non-command messages, handles command-shaped messages, and always sends a structured response without logging message contents.
- The migration runner remains unwired at startup: the v1 registry is empty, the repository already gates older/newer/corrupt metadata, and there is no startup UI channel for failures. Wire it with the first non-empty migration.
- Added deterministic unit coverage for the client, rate limits, contracts, error mapping, and command handler; added an E2E messaging flow that mocks `api.github.com`, validates a command, saves, rejects a duplicate network call, reads the snapshot, and removes the issue.
- Full unit suite: 15 files, 423 tests passing. `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm zip`, and `pnpm test:e2e` (5 tests) pass. Production build is 259.01 kB; zip is 81.05 kB. Manifest permissions are unchanged.
- Not yet implemented, by design: popup save/track workflow, dashboard data binding/note editor, sorting/filtering, and release hardening. Those begin in M4-M6.

## M4 - Popup workflow

Depends on M3.

### Deliverables

- Read the active tab URL through `activeTab`; show a target card for supported issue/PR pages.
- Save issue and track PR actions with loading, success, already-saved, and error states.
- Unsupported-page empty state with guidance.
- Rate-limit/private/deleted-target messaging while preserving the saved reference.
- Link to the dashboard and basic saved counts.
- Component tests for popup states.

### Acceptance

- On a GitHub issue URL, save persists the issue and dashboard data updates.
- On a GitHub PR URL, track persists the PR.
- Duplicate opens show the saved state without creating duplicates or changing notes.
- Non-GitHub, `chrome://`, and unsupported GitHub pages show actionable empty states.
- API failure still yields a saved reference and a visible warning.
- Permission and network inspection confirms only `api.github.com` is contacted, only after user action.

### M4.1 - Popup target/action workflow

Status: complete, awaiting review. Executed 2026-10-20. This is the approved subset of M4 that excludes the dashboard link and saved counts.

- Implemented `src/lib/active-target.ts` and `popup-target.ts`: query the active tab in the current window, parse GitHub issues and pull requests separately, return actionable missing/unsupported states, and resolve savedness by canonical id against the snapshot.
- Implemented `src/messaging/background-client.ts`: typed methods for snapshot, save/refresh/remove issue, and track/refresh/remove pull request. It validates result envelopes, errors, records, notes, warnings, and removal ids; messaging rejection and malformed responses produce safe typed errors. It never logs message content.
- Implemented `src/hooks/usePopupWorkflow.ts` and the popup UI in `src/entrypoints/popup/App.tsx`: loading, unsupported/missing, snapshot error/retry, unsaved/saved issue, untracked/tracked PR, pending, success, warning, and error states. Saved references with failed metadata show the bounded sync error and a retry action. Duplicate submissions are blocked synchronously and updates are guarded after unmount.
- Save and track update `GET_SNAPSHOT` data locally; remove and untrack also drop the local record (and the note for a removed issue). No storage or GitHub access exists in UI code, and no permissions or dependencies changed.
- Added 45 deterministic unit/component tests for target resolution, response validation, and popup states, including malformed payloads, command failures, metadata retry, duplicate clicks, and React Strict Mode. The full suite is 19 files / 468 tests.
- Added deterministic Playwright coverage for unsupported pages, save/reload/remove, track/untrack, and metadata failure/retry. Active-tab detection is stubbed before the popup loads; API requests are routed. E2E is 8/8 with no live GitHub calls.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm zip`, and `pnpm test:e2e` pass. Production build is 282.70 kB; zip is 87.68 kB. Manifest permissions remain `storage`, `activeTab`, and `https://api.github.com/*`.
- Not yet implemented, by design: release hardening (M6). Dashboard link/counts and the dashboard workspace were delivered under M4.2.

### M4.2 - Dashboard workspace

Status: implemented, awaiting review. Executed 2026-10-20. This expanded M4.2 beyond the original dashboard link/counts scope to deliver the approved local dashboard workspace; the M5 deliverables below are therefore implemented under M4.2.

- Implemented `src/entrypoints/dashboard/App.tsx` and `src/hooks/useDashboardWorkflow.ts`: snapshot load/error/retry, collection refresh, counts, search/filter/sort, empty/no-match states, issue removal, PR untracking and manual PR refresh, note editing, per-action pending states, and local snapshot updates.
- Added `src/components/dashboard/IssueCard.tsx`, `PullRequestCard.tsx`, `IssueNote.tsx`, `RecordBadges.tsx`, `DashboardFilters.tsx`, and `src/lib/dashboard-view.ts`: last-known state labels, bounded sync errors, inline confirmations, note concurrency tokens, and actionable rate-limit/private/deleted-target messaging.
- Added the popup dashboard link and saved counts in `src/entrypoints/popup/App.tsx`. The link is always available and opens `/dashboard.html` in a new tab; counts come from the same validated snapshot and are not shown on unsupported pages, where storage is not read.
- Added live dashboard updates in `src/hooks/useDashboardWorkflow.ts` and `src/storage/chrome-storage.ts`: a read-only `StorageReader` subscription receives changed keys only, and the dashboard coalesces relevant `contribflow.*` changes into a `GET_SNAPSHOT` reload. UI code never reads storage or calls GitHub directly.
- Added deterministic unit/component coverage for filters, counts, issue/PR actions, note concurrency, storage-change coalescing, and popup link/counts. The full suite is 21 files / 510 tests.
- Added deterministic Playwright coverage for dashboard live updates, note persistence, issue removal, PR refresh/untrack, and the popup dashboard link. E2E is 11/11 with no live GitHub calls.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm zip`, and `pnpm test:e2e` pass. Production build is 315.48 kB; zip is 95.91 kB. Manifest permissions remain `storage`, `activeTab`, and `https://api.github.com/*`.
- Not yet implemented, by design: release hardening (M6). Search and filtering are now in scope; tags, multiple notes, polling, and background auto-refresh remain out of scope.

## M5 - Dashboard

Depends on M4.

Status: implemented and verified by automated tests (unit, component, E2E). All deliverables implemented. Manual verification checks (keyboard, contrast, narrow/full layout, browser restart, real Chrome smoke test) are pending.

### Deliverables

- Issues list (newest first) with metadata, state, sync status, and refresh action.
- Inline note editor for saved issues: view, edit, explicit save, delete, validation, and errors.
- Pull requests list (newest first) with state, sync status, refresh, and untrack.
- Remove issue/PR confirmation that also removes the note.
- Loading, empty, error, warning, and per-item busy states.
- Live updates through `chrome.storage.onChanged`.
- Responsive monochrome layout, keyboard support, visible focus, and non-color-only state labels.
- Component tests for the note editor, lists, and key states.

### Acceptance

- Notes persist across popup/dashboard reloads and never trigger network requests.
- Removing an issue removes its note; untracking a PR removes it.
- Refresh updates title/state/timestamps and clears the previous sync error on success.
- Invalid-record and orphan-note warnings are visible without deleting data.
- Keyboard-only use is possible; focus order and contrast are checked.
- Layout works at narrow popup-like widths and on a full dashboard tab.

### Manual verification checklist (pending)

- [ ] Keyboard-only navigation and focus order
- [ ] Visible focus indicators
- [ ] Contrast and non-color-only state indicators
- [ ] Narrow and full dashboard widths
- [ ] Browser-restart persistence
- [ ] Network panel: note edits cause no GitHub API requests
- [ ] Successful and failed dashboard issue refresh
- [ ] Actual Chrome extension reload and smoke test

## M6 - End-to-end, hardening, release candidate

Depends on M5.

### Deliverables

- Playwright E2E using the agreed deterministic API strategy:
  - save an issue and see it in the dashboard,
  - add a note and verify persistence after reload,
  - track a PR and refresh to `merged`,
  - handle a rate-limited response while preserving the reference,
  - remove an issue and verify the note is gone.
- Accessibility, permission, CSP, and network audits.
- Final docs update and production build/zip.
- Manual smoke test on a clean Chrome profile with a real public issue and PR (non-CI).

### Acceptance

- All E2E tests pass offline and deterministically.
- All quality commands pass: typecheck, lint, unit tests, E2E, build, zip.
- Loading the zip in a clean profile causes no console or manifest errors.
- Network inspection shows no requests except explicit GitHub API reads.
- Saved issues, notes, and PRs survive browser restart.
- No secrets, telemetry, raw responses, or new permissions are present.
- Documentation matches the shipped behavior.

## Global definition of done

A milestone is done only when:

- Its acceptance criteria are met and actually exercised.
- New logic has tests, and no `any` is used without a documented justification.
- Typecheck, lint, and relevant tests pass.
- Permissions and dependency changes are reviewed and documented.
- Loading, empty, error, and disabled states are handled in the UI.
- Planning docs stay accurate.

## Deferred until after the MVP

Tags, multiple notes, notifications, background polling, auto-refresh, review/CI status, import/export, sync, authentication, private repository metadata, Firefox support, and any GitHub write operation.
