# M0 Feasibility Report

Status: complete. M0 executed 2026-10-19 to 2026-10-20 on Windows (win32) under the planning-only constraint: no project dependencies, tooling, or application code were added to the repository. This report separates what was actually exercised from what remains an assumption. See "M1 addendum" at the end for the deferred checks and their results.

Related: `docs/architecture.md`, `docs/data-models.md`, `docs/implementation-plan.md`.

## Environment

| Item | Value |
| --- | --- |
| Node.js | v24.14.0 |
| pnpm | 12.14.0 (installed globally with `npm install -g pnpm`; `corepack enable pnpm` failed with EPERM on `C:\Program Files\nodejs\pnpm`) |
| Chrome | 155.0.8059.84 (branded stable, system install) |
| Edge | 155.0.4283.62 |
| gh CLI | authenticated as `rabindra789` |
| Playwright | 1.64.1 available only from the npx cache; no browser binaries installed (`C:\Users\rabindra\AppData\Local\ms-playwright` contains only `.links`) |
| Repository | `https://github.com/rabindra789/Contribflow` (private), branch `master`, planning commit `6159061` |

The spike used a throwaway extension and a raw-CDP driver outside the repository:

- `C:\Users\rabindra\AppData\Local\Temp\opencode\contribflow-m0\ext` (manifest, background, popup)
- `C:\Users\rabindra\AppData\Local\Temp\opencode\contribflow-m0\cdp-spike.js`

Neither is part of the project; they can be deleted at any time.

## Verified during M0

### 1. Unpacked extension loading and action triggering in branded Chrome

Chrome 137+ removed the `--load-extension` command-line switch, so branded Chrome cannot install an unpacked extension with WXT/web-ext defaults. The modern supported-by-CDP path works:

- Launching Chrome with `--remote-debugging-pipe --enable-unsafe-extension-debugging --user-data-dir=<temp profile>` exposes the `Extensions` CDP domain.
- `Extensions.loadUnpacked` loaded the throwaway extension (id `mbmlnoahndicnmpljengjnbigogkhfej`) with no manifest errors.
- `Extensions.triggerAction` opened the extension popup as an inspectable target, which allowed direct evaluation in the popup context.

Caveat: this relies on the debugging flag pair above. It is suitable as spike evidence and possibly for local automation, but it is not the supported Playwright extension workflow (see "Not verified").

### 2. `activeTab` exposes the active tab URL in the popup

With the popup opened via `Extensions.triggerAction`:

- On a GitHub issue page, `chrome.tabs.query({ active: true, currentWindow: true })` returned the tab URL and title.
- On a plain page (example.com) the same worked.
- On `chrome://version/` the query returned `tab.url` and `tab.title` as `null`, because `activeTab` is not granted on restricted pages. The planned empty state covers this.

Conclusion: `activeTab` alone is sufficient for the popup workflow. No `tabs` permission and no explicit-URL-input fallback are needed.

Related finding: `https://github.com/octocat/Hello-World/issues/1` redirects to `https://github.com/octocat/Hello-World/pull/1` because that number is a pull request. The popup must parse the final tab URL after redirects, not the URL the user typed. `docs/data-models.md` now records this.

### 3. Background messaging and service-worker restart

- `chrome.runtime.sendMessage({ type: 'PING' })` from the popup received a `pong` response from the background service worker.
- The background successfully wrote to `chrome.storage.local` in response to a message.
- After closing the service worker target (simulating MV3 termination), triggering the action again woke the worker; the next `PING` succeeded and storage writes still worked.

Conclusion: the "stateless handlers, re-read before mutate" design is feasible, and the extension recovers after service-worker termination without extra permissions.

### 4. Storage behavior

- `chrome.storage.local.QUOTA_BYTES` reported `10485760` (10 MiB). `unlimitedStorage` is not needed for the planned dataset, and none is requested.
- Writes and reads across popup/background contexts behaved as expected, including before and after service-worker restart.

### 5. Manifest with the approved permission set

The throwaway manifest declared `permissions: ["storage", "activeTab"]` and `host_permissions: ["https://api.github.com/*"]`, with no content scripts. It loaded cleanly, confirming the permission set is coherent and sufficient for the verified flows.

### 6. Anonymous GitHub API reachability and rate limit

`GET https://api.github.com/rate_limit` returned HTTP 200 anonymously: limit 60 requests/hour, remaining 60, reset at `2026-10-19T19:26:15Z`. The endpoint does not consume quota. This confirms the anonymous public API constraint the architecture depends on.

### 7. Dependency and peer compatibility (npm registry checks)

Candidate pins for M1; final lock happens at M1 with `pnpm install` and `pnpm build`.

| Package | Candidate | Notes |
| --- | --- | --- |
| `wxt` | 0.21.4 | Node >=22; peer Vite `^6.3.4 \|\| ^7 \|\| ^8.0.0-0`; peer TypeScript >=5.4 |
| `@wxt-dev/module-react` | 1.2.2 | Peer WXT >=0.19.16 and matching Vite ranges; React plugin provided internally |
| `vite` | 8.3.4 | WXT 0.21 makes Vite a required peer dependency; compatible with Vitest and Tailwind plugins |
| `react` / `react-dom` | 19.3.1 | |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.3 | Vite plugin peer includes Vite 8 |
| `typescript` | 5.9.3 | Latest is 7.0.2, but `typescript-eslint@8.72.0` caps TypeScript at `<6.1.0`; WXT requires >=5.4 |
| `typescript-eslint` | 8.72.0 | Supports ESLint `^8.57 \|\| ^9 \|\| ^10` |
| `eslint` | 10.13.0 | Node engines satisfied |
| `@eslint/js` | 10.0.1 | |
| `eslint-plugin-react-hooks` | 7.1.1 | Supports ESLint ^10 |
| `globals` | 17.13.0 | |
| `vitest` | 5.0.5 | Node `^22.12 \|\| ^24 \|\| >=26`; works with Vite 8 |
| `jsdom` | 29.1.1 | 30.x requires Node `^22.22.2 \|\| ^24.15.0`; local Node is 24.14.0 |
| `@testing-library/react` | 16.3.3 | Supports React 19 |
| `@testing-library/jest-dom` | 7.0.1 | |
| `@testing-library/user-event` | 14.6.8 | |
| `@playwright/test` | 1.64.1 | Installs bundled Chrome for Testing 156.0.8078.4 (chromium v1248) |
| `web-ext` | 10.8.0 | Optional WXT peer; only needed if `pnpm dev` should open a browser automatically |
| `@types/react` / `@types/react-dom` | 19.3.0 | |

Notes:

- WXT 0.21 moved `vite`, `typescript`, and `web-ext` from dependencies to peer dependencies. M1 must add `vite` and `typescript` explicitly and choose whether to include `web-ext`.
- `@types/chrome` is not needed; WXT provides `wxt/browser` types.
- TypeScript 7.x is currently blocked by `typescript-eslint`; it can be revisited when the parser supports it.

## Not verified (assumptions carried into M1)

1. **WXT + React + TypeScript + Tailwind build.** No dependencies were installed, so the actual `wxt build` pipeline with the candidate pins above is unverified. This is the first check of M1.
2. **Playwright extension loading with bundled Chromium.** Playwright's documented flow uses its own Chromium/Chrome for Testing with a persistent context; system Chrome cannot be used for extensions. Browser binaries are not installed. Deferred to M1 (`pnpm exec playwright install chromium` downloads several hundred MB).
3. **Playwright interception of service-worker `api.github.com` fetches.** Documented as supported, but not exercised. If M1 confirms it, the planned E2E suite can mock API responses deterministically. If not, the documented fallback applies: keep the GitHub client under injected-`fetch` unit tests and drive E2E from deterministic storage/state setups.
4. **WXT dev-mode browser startup in branded Chrome.** Chrome 137+ removed `--load-extension`, and the older `--disable-features=DisableLoadExtensionCommandLineSwitch` workaround no longer works in current Chrome (reported broken from Chrome 142). M1 must either point `webExt.binaries.chrome` at a Chrome for Testing/Chromium binary (the Playwright download could serve both dev and tests) or disable `webExt` and load `.output/chrome-mv3-dev` manually.
5. **`pnpm zip` packaging.** Not exercised.

## Alternatives considered and rejected

| Option | Outcome |
| --- | --- |
| Raw CDP `Extensions.loadUnpacked` as the E2E mechanism | Verified working on Chrome 155, but depends on `--enable-unsafe-extension-debugging`. Keep as spike evidence; prefer Playwright's supported bundled-Chromium flow for tests. |
| `--disable-features=DisableLoadExtensionCommandLineSwitch` (WXT pre-0.20.7 workaround) | No longer effective in current Chrome. Not usable for dev startup. |
| Adding the `tabs` permission for the popup | Not needed; `activeTab` was verified sufficient. |
| `unlimitedStorage` | Not needed; 10 MiB quota is far above the planned dataset. |

## M0 acceptance summary

| Criterion | Status |
| --- | --- |
| A minimal extension builds and loads unpacked in Chrome | Loading verified via CDP spike; the WXT build itself deferred to M1 (no dependencies allowed in M0) |
| Playwright intercepts the service-worker request path, or the documented fallback is chosen | Not exercised in M0 (no browser binaries). Decision deferred to M1; the documented fallback remains the plan of record until then |
| `activeTab` behavior is verified; fallback is URL input, not `tabs` | Satisfied in Chrome 155; no fallback or permission change needed |
| Findings and version choices are added to the docs | Satisfied by this report plus updates to the architecture, data-models, and implementation-plan documents |

Overall: M0 is substantially complete given its planning-only constraints. The remaining evidence checks were folded into M1 deliverables and acceptance criteria in `docs/implementation-plan.md`.

## Confirmed test strategy (smallest useful)

- Unit (Vitest, Node): URL parsing, validators, key rules, PR state derivation, migrations, repository against the in-memory adapter, GitHub client with fake `fetch`, message payload validation, sorting.
- Component (Vitest + Testing Library, jsdom): popup states, note editor, lists, status badges.
- E2E (Playwright, bundled Chromium): one thin suite covering extension load, save issue, note persistence across reload, PR refresh to `merged`, rate-limit handling, and removal. API responses are mocked if M1 confirms service-worker routing; otherwise seeded storage plus unit-tested fetch paths.
- Manual Chrome checks: permissions/manifest audit, `activeTab` on restricted pages, network panel scope, persistence after browser restart.

## Follow-ups carried by M1

1. Scaffold with the pinned versions and prove `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm zip`.
2. Decide and document the development browser strategy (Chrome for Testing via the Playwright download, or manual unpacked loading with `webExt` disabled).
3. Run the Playwright bundled-Chromium extension spike and record whether service-worker request interception works; adopt the fallback explicitly if it does not.

## M1 addendum (2026-10-20)

All three follow-ups were executed as part of the M1 foundation.

### Deferred checks resolved

1. **WXT + React + TypeScript + Tailwind build.** Verified with the pinned versions. `pnpm build` produces `.output/chrome-mv3` (manifest, `popup.html`, `dashboard.html`, `background.js`, JS chunks, and a Tailwind CSS bundle); `pnpm zip` produces `.output/contribflow-0.1.0-chrome.zip`; `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.
2. **Playwright extension loading.** Verified with Playwright 1.64.1 and its bundled Chrome for Testing 156.0.8078.4 (chromium v1248) in headless mode using a persistent context and `--load-extension` (supported on Chrome for Testing, unlike branded Chrome). The 4-test E2E suite covers popup rendering, dashboard rendering, MV3 service-worker startup, and request mocking.
3. **Service-worker request interception.** Verified. `browserContext.route('https://api.github.com/**')` intercepts `fetch` calls made from the MV3 service worker, and the intercepted response is delivered back to the worker. The test passed on every run, including 3 consecutive repeats, so the documented fallback is not needed. E2E tests do not call the live GitHub API.
4. **`pnpm zip` packaging.** Verified; archive written to `.output/contribflow-0.1.0-chrome.zip` (72.89 kB).

### Additional findings

- **Branded Chrome 155 smoke test.** The production build was loaded as unpacked in the system Chrome 155 via the CDP flow from M0. The manifest showed `manifest_version: 3`, permissions `storage` and `activeTab`, host permission `https://api.github.com/*`, no content scripts, and the popup action. Popup and dashboard rendered with Tailwind styles applied (verified via computed styles and stylesheet presence).
- **WXT 0.21 no longer auto-detects `src`.** `srcDir` now defaults to the project root; the config sets `srcDir: 'src'` explicitly.
- **TypeScript needs `jsx: react-jsx` for `.tsx`.** The generated `.wxt/tsconfig.json` does not set `jsx`; the root `tsconfig.json` does.
- **`pnpm dev` works without `web-ext`.** WXT builds `.output/chrome-mv3-dev`, starts the dev server, and prints "Load .output/chrome-mv3-dev as an unpacked extension manually". This is the documented default until Chrome restores command-line extension loading.
- **pnpm 12 supply-chain policy.** pnpm added `pnpm-workspace.yaml` with `minimumReleaseAgeExclude` entries for the pinned `typescript-eslint` 8.72.0 packages so the lockfile passes its minimum-release-age policy; the file is part of the repository.
- **`eslint-plugin-react-hooks` 7 requires scoped overrides for Playwright fixtures.** `e2e/**` disables `no-empty-pattern` and `react-hooks/rules-of-hooks`, which are incompatible with the required Playwright fixture signatures.

### Version deviations from the M0 candidate list

| Package | M0 candidate | M1 decision | Reason |
| --- | --- | --- | --- |
| `@types/node` | not listed | `24.19.2` | Required for Node type references in `playwright.config.ts` and the E2E fixtures; WXT does not provide it. Pinned to the Node 24 line, matching the runtime. |
| `@testing-library/dom` | not listed | `10.4.2` | Declared peer dependency of `@testing-library/react` 16; pnpm strict resolution requires it as a direct dev dependency. |
| `@testing-library/user-event` | `14.6.8` | not installed | No M1 test needs it; add it when a test requires realistic input events. |
| `web-ext` | `10.8.0` (optional) | not installed | Branded Chrome 137+ cannot side-load extensions, so auto-launch is not useful by default; manual loading is documented instead. |

All other packages were installed at the M0 candidate versions: `wxt` 0.21.4, `@wxt-dev/module-react` 1.2.2, `vite` 8.3.4, `react`/`react-dom` 19.3.1, `tailwindcss`/`@tailwindcss/vite` 4.3.3, `typescript` 5.9.3 (typescript-eslint caps TypeScript at `<6.1.0`), `typescript-eslint` 8.72.0, `eslint` 10.13.0, `@eslint/js` 10.0.1, `eslint-plugin-react-hooks` 7.1.1, `globals` 17.13.0, `vitest` 5.0.5, `jsdom` 29.1.1 (jsdom 30 requires Node >= 24.15.0), `@playwright/test` 1.64.1, and `@types/react`/`@types/react-dom` 19.3.0.
