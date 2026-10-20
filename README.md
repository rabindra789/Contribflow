# ContribFlow

![ContribFlow Logo](logo.svg)

ContribFlow is a local-first Chrome (Manifest V3) extension for individual GitHub contributors. It saves GitHub issues, keeps one private note per saved issue, tracks pull requests, and shows everything in a local dashboard.

## Install without Chrome Web Store

ContribFlow is not yet on the Chrome Web Store. You can install it directly from GitHub:

1. Download the latest `contribflow-0.1.0-chrome.zip` from the [GitHub Releases page](https://github.com/rabindra789/Contribflow/releases/latest).
2. Extract the ZIP into a folder.
3. Open `chrome://extensions` in Chrome.
4. Enable **Developer mode** (top right).
5. Click **Load unpacked**.
6. Select the extracted extension folder.

This is suitable for developers and early adopters. It is not as convenient as a Chrome Web Store installation, and users may need to update the extension manually when new versions are released.

## Install from Source (Development)

```sh
pnpm install
pnpm build
```

Then load the `.output/chrome-mv3` directory as an unpacked extension (see Development section below).

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

Pre-built releases are available on the [GitHub Releases page](https://github.com/rabindra789/Contribflow/releases).

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

## Support

ContribFlow is free and open source. If you find it useful and would like to support ongoing development, you can buy me a coffee:

- [Buy Me a Coffee](https://buymeacoffee.com/rabindra789)

Contributions are completely optional and do not unlock any features. The extension will always remain free and local-first.
