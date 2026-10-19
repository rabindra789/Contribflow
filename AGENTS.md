# ContribFlow Engineering Guide

ContribFlow is a Chrome Manifest V3 extension for individual GitHub contributors. It saves issues, attaches private notes, tracks pull requests, and shows everything in a local dashboard.

The MVP is local-first: no account, backend, analytics, AI API, or stored GitHub credentials.

## Current status

Planning only. The repository intentionally contains no application code or tooling yet. Do not scaffold, add dependencies, or implement features until the user approves `docs/implementation-plan.md`.

Planning artifacts:

- `docs/architecture.md` - system design, boundaries, permissions, risks
- `docs/data-models.md` - persisted models and storage contracts
- `docs/implementation-plan.md` - milestones and verification

## Stack

- Chrome Manifest V3 via WXT
- React + TypeScript (strict mode)
- Tailwind CSS
- pnpm
- Vitest for unit tests; Playwright for browser tests where appropriate
- `chrome.storage.local`; anonymous public GitHub REST API requests

## Expected commands

Added during milestone M1:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run WXT dev mode |
| `pnpm build` | Build the Chrome MV3 extension |
| `pnpm zip` | Package the extension |
| `pnpm typecheck` | `wxt prepare` + `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright extension tests |

Run typecheck, lint, and the relevant tests before declaring work complete. Do not claim behavior is verified unless it was actually exercised.

## Boundaries

- `src/entrypoints/` - popup, dashboard, background service worker only.
- `src/components/` - shared React UI; no storage or network calls.
- `src/domain/` - pure types, validation, URL parsing, status rules. Never import React, WXT, or Chrome APIs.
- `src/storage/` - repository contract, Chrome adapter, keys, migrations. Only adapter files may touch `chrome.storage` or WXT browser APIs.
- `src/github/` - GitHub REST client, response mapping, errors. Inject `fetch` for tests.
- `src/messaging/` - typed UI-to-background contracts.
- `src/hooks/`, `src/lib/`, `src/styles/` - UI data hooks, utilities, design tokens.
- Unit tests live beside source as `*.test.ts(x)`; Playwright tests live in `e2e/`.

## Non-negotiable rules

- UI reads storage through the repository and subscribes to changes. All persistence mutations and all GitHub requests go through the background service worker via typed messages.
- Validate every persisted record on read. Skip invalid records without deleting them and surface the problem. Schema changes require a migration.
- Keep TypeScript strict. Do not use `any` without a documented reason.
- Request only the approved permissions: `storage`, `activeTab`, and host access to `https://api.github.com/*`. Permission changes require a docs update and approval.
- Never store GitHub tokens, credentials, analytics IDs, or secrets. Never add telemetry.
- Do not scrape the GitHub DOM or add content scripts. Read the active tab URL only after the user opens the extension.
- Keep the interface monochrome, compact, accessible, and responsive. No gradients, decorative illustrations, or unnecessary animation.
- Do not add features outside the agreed MVP or introduce dependencies without approval. No backend, payments, or auth.
- Keep loading, empty, and error states. Never silently swallow errors.
- Treat notes and saved data as private: never transmit them.
- Update the planning documents when architecture decisions change.

## MVP scope

Save and remove issues, keep one private note per saved issue, track and untrack pull requests, refresh stored metadata manually, and view both lists plus note editing in the dashboard. No search, tagging, notifications, background polling, or GitHub writes.
