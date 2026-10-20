# ContribFlow

ContribFlow is a local-first Chrome (Manifest V3) extension for individual GitHub contributors. It saves GitHub issues, keeps one private note per saved issue, tracks pull requests, and shows everything in a local dashboard.

The MVP is local: no account, no backend, no analytics, and no stored GitHub credentials.

Current status: milestones M1 (foundation), M2 (domain and persistence), M3 (GitHub client and background commands), M4.1 (popup target/action workflow), and M4.2 (dashboard workspace, search/filter, notes, and live updates) are implemented. The popup detects supported GitHub issues and pull requests, saves issues, tracks pull requests, removes/untracks them, retries metadata, and links to the dashboard with saved counts. The dashboard loads through the background service worker, refreshes on local storage changes, and supports issue removal, PR untracking/refresh, and private note editing. Release hardening (M6) remains. See `docs/implementation-plan.md`.

## Requirements

- Node.js >= 22 (verified with 24.14.0)
- pnpm (verified with 12.14.0)
- Chrome or Chromium for manual checks; Playwright downloads its own Chromium for tests

## Install

```sh
pnpm install
```

`pnpm install` runs `wxt prepare`, which generates the `.wxt/` directory with TypeScript config and types.

## Development

```sh
pnpm dev
```

WXT builds to `.output/chrome-mv3-dev` and watches for changes. Automatic browser launch is intentionally not configured:

- Google Chrome and Microsoft Edge 137+ removed the `--load-extension` command-line switch, so WXT/web-ext cannot side-load the extension into a normal Chrome installation.
- Load the dev build manually: open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `.output/chrome-mv3-dev`. Reload the extension after background changes.
- Optional: install `web-ext` locally and create a gitignored `web-ext.config.ts` that points `binaries.chrome` at a Chrome for Testing/Chromium binary to get automatic browser launch during `pnpm dev`.

## Quality checks

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | `wxt prepare` + `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit tests |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:e2e` | Production build, then Playwright tests in bundled Chromium |

First-time Playwright setup downloads the bundled browser:

```sh
pnpm exec playwright install chromium
```

## Build and package

```sh
pnpm build
pnpm zip
```

- `pnpm build` writes the production extension to `.output/chrome-mv3`.
- `pnpm zip` writes a distributable archive to `.output/`.
- Load `.output/chrome-mv3` through `chrome://extensions` (Developer mode, Load unpacked).

## Permissions and privacy

The extension requests only:

- `storage` - persist saved issues, notes, and tracked pull requests locally
- `activeTab` - read the active tab URL after the user opens the extension
- `https://api.github.com/*` - read public issue and pull request metadata

It does not request `tabs`, `scripting`, `alarms`, identity, or access to `github.com`, and it does not inject content scripts. Notes and saved data never leave the device; the only outbound requests are anonymous public GitHub API reads triggered by explicit user actions.

## Project structure

```text
src/
  entrypoints/    popup, dashboard, and background service worker listener
  background/     command validation, routing, serialization, error mapping
  github/         validated REST client, rate-limit parsing, typed errors
  messaging/      typed command contracts, validation, and background client
  storage/        repository contract, adapters, migrations
  domain/         models, validators, URL parsing, state rules
  hooks/          popup and dashboard workflow state and actions
  lib/            active-tab detection and target resolution
  components/     shared React UI
  styles/         Tailwind CSS entry and design tokens
  test/           Vitest setup
e2e/              Playwright extension tests
docs/             architecture, data models, implementation plan, feasibility report
```

Planning documents: `docs/architecture.md`, `docs/data-models.md`, `docs/implementation-plan.md`, `docs/feasibility-report.md`.
