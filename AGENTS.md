# ContribFlow Engineering Guide

ContribFlow is a Chrome Manifest V3 extension for individual GitHub contributors. It saves issues, attaches private notes, tracks pull requests, and shows everything in a local dashboard.

The MVP is local-first: no account, backend, analytics, AI API, or stored GitHub credentials.

## Current status

Foundation (M1), domain/persistence (M2), and the GitHub client/background commands (M3) are complete: WXT + React + TypeScript (strict) + Tailwind scaffold, popup and dashboard shells, validated GitHub REST client, typed messaging contracts, serialized background command handler, repository with in-memory and Chrome adapters, migration runner, and ESLint/Vitest/Playwright setup. Product UI workflows are not implemented yet. Start M4 only after approval in `docs/implementation-plan.md`.

Planning artifacts:

- `docs/architecture.md` - system design, boundaries, permissions, risks
- `docs/data-models.md` - persisted models and storage contracts
- `docs/implementation-plan.md` - milestones and verification
- `docs/feasibility-report.md` - M0 evidence, candidate version pins, and deferred M1 checks

## Stack

- Chrome Manifest V3 via WXT
- React + TypeScript (strict mode)
- Tailwind CSS
- pnpm
- Vitest for unit tests; Playwright for browser tests where appropriate
- `chrome.storage.local`; anonymous public GitHub REST API requests

## Commands

Available commands:

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
- `src/background/` - command validation, routing, serialization, refresh coalescing, and error serialization.
- `src/components/` - shared React UI; no storage or network calls.
- `src/domain/` - pure types, validation, URL parsing, status rules. Never import React, WXT, or Chrome APIs.
- `src/storage/` - repository contract, in-memory and Chrome adapters, keys, migrations. Only adapter files may touch `chrome.storage` or WXT browser APIs.
- `src/github/` - GitHub REST client, response validation, rate-limit parsing, errors. Inject `fetch` for tests.
- `src/messaging/` - typed UI-to-background contracts and runtime message validation.
- `src/hooks/`, `src/lib/`, `src/styles/` - UI data hooks, utilities, design tokens.
- Unit tests live beside source as `*.test.ts(x)`; Playwright tests live in `e2e/`.

## Non-negotiable rules

- UI reads storage through the repository and subscribes to changes. All persistence mutations and all GitHub requests go through the background service worker via typed messages.
- Validate every persisted record on read. Skip invalid records without deleting them and surface the problem. Schema changes require a migration.
- Validate every runtime message and every GitHub response. Malformed messages never reach storage or network code, and raw responses and message contents are never persisted or logged.
- Repository mutations are serialized per instance and re-read state before writing. The single background worker is the only writer; do not claim multi-context transactions that Chrome storage does not provide.
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
