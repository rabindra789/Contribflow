# Chrome Web Store Release Documentation (Draft)

**Version:** 0.1.0
**Date:** 2025-10-20
**Status:** Draft — pending review and verification

---

## 1. Product Information

| Field | Value |
|-------|-------|
| **Product Name** | ContribFlow |
| **Short Description** | Save GitHub issues with private notes and track pull requests in a local dashboard. |
| **Detailed Description** | ContribFlow is a local-first Chrome Manifest V3 extension for individual GitHub contributors. It lets you save GitHub issues with private notes, track pull requests, and view everything in a local dashboard — all without an account, backend, or cloud sync. Data stays in your browser's `chrome.storage.local`. The extension makes only anonymous public GitHub API requests when you explicitly save, track, or refresh an issue or pull request. No credentials, no telemetry, no cloud sync. |

---

## 2. Key Features

- **Save Issues** — One click saves the current GitHub issue with its metadata (title, state, timestamps) and an optional private note.
- **Track Pull Requests** — Track PRs with the same metadata persistence and sync behavior.
- **Private Notes** — One private note per saved issue, stored locally, never transmitted.
- **Manual Refresh** — Refresh issue/PR metadata on demand; failures preserve last-known state and show bounded error messages.
- **Local Dashboard** — Full-page dashboard with search, filtering, per-item busy states, live storage updates, and inline note editing.
- **Popup Workflow** — Active-tab detection, save/track/remove/untrack, metadata retry, dashboard link with saved counts.
- **Privacy First** — No account, no backend, no analytics, no stored GitHub credentials, no content scripts.

---

## 3. Permissions Justification

| Permission | Type | Purpose |
|------------|------|---------|
| `storage` | API permission | Persist saved issues, private notes, tracked PRs, and schema metadata in `chrome.storage.local`. Required for any local persistence. |
| `activeTab` | API permission | Read the active tab's URL after the user opens the extension popup. Used only to detect whether the current tab is a supported GitHub issue or PR page. Does not grant persistent access to all tabs. |
| `https://api.github.com/*` | Host permission | Fetch public issue and PR metadata (title, state, timestamps) from GitHub's public REST API. Requests are anonymous, unauthenticated, and only triggered by explicit user actions (save, track, refresh). |

**Not requested:** `tabs`, `scripting`, `alarms`, `identity`, `cookies`, `unlimitedStorage`, `<all_urls>`, or any access to `https://github.com/*`.

---

## 4. Privacy & Data Handling

| Aspect | Detail |
|--------|--------|
| **Data Storage** | All user data (saved issues, notes, tracked PRs) is stored in `chrome.storage.local` on the user's device. No cloud sync, no backend, no remote database. |
| **Data Transmission** | The extension makes **only** anonymous, unauthenticated GET requests to `https://api.github.com/repos/{owner}/{repo}/issues/{number}` or `/pulls/{number}` when the user explicitly clicks Save, Track, or Refresh. No other network requests are made. |
| **Credentials** | No OAuth, no personal access tokens, no GitHub credentials are ever requested or stored. |
| **Notes** | Private notes are stored locally, never transmitted to GitHub or any other server. |
| **Analytics/Telemetry** | None. No tracking, no analytics, no crash reporting, no remote configuration. |
| **Data Retention** | Data persists until the user explicitly removes an issue/note or uninstalls the extension. Browser restart does not clear data. |
| **Data Deletion** | Removing an issue deletes its note in the same storage operation. Untracking a PR removes it. Uninstalling the extension clears all extension storage. |

---

## 5. Installation Instructions

### From Chrome Web Store (after publication)
1. Open the Chrome Web Store listing for ContribFlow.
2. Click **Add to Chrome** → **Add extension**.
3. The extension icon appears in the toolbar.
4. Open a GitHub issue or pull request page, then click the extension icon to save/track.

### Manual Installation (Development/Testing)
1. Download the `.zip` from the releases page (or build locally).
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the extracted `.output/chrome-mv3` folder.
5. Or drag the `.crx`/`.zip` onto the extensions page if supported.

---

## 6. Known Limitations

| Limitation | Details |
|------------|---------|
| **GitHub API rate limits** | Anonymous API calls are limited to 60 requests/hour/IP. Failed refreshes show a bounded error with retry timing; no automatic retries. |
| **Private repositories** | Cannot fetch metadata for private repos (404/403). The issue/PR is still saved as a reference with `unknown` state. |
| **Single note per issue** | Only one private note per saved issue. No tags, search within notes, or multiple notes. |
| **No background polling** | No automatic refresh, no notifications, no background sync. All refreshes are manual. |
| **Chrome only** | Manifest V3, Chrome/Chromium only. No Firefox or Safari support. |
| **No GitHub writes** | Cannot comment, star, close, or modify issues/PRs. Read-only metadata fetching only. |
| **Manifest V3 only** | Requires Chrome 88+ (Manifest V3 support). |

---

## 7. Suggested Screenshots (Manual Capture)

| # | View | Description |
|---|------|-------------|
| 1 | Popup on GitHub issue page | Shows "Save issue" button, saved state, metadata, dashboard link. |
| 2 | Popup on GitHub PR page | Shows "Track pull request" button, tracked state. |
| 3 | Popup on unsupported page | Empty state with guidance. |
| 4 | Dashboard — empty state | "Your workspace is empty" with summary counts (0/0/0). |
| 5 | Dashboard — populated | Issues list with state badges, sync details, note editor, filters. |
| 6 | Dashboard — note editing | Inline note editor with save/cancel/delete, character count. |
| 6 | Dashboard — PR refresh | PR card with Refresh button, pending state, success notice. |
| 7 | Dashboard — orphan warning | Storage warnings section showing orphan-note warning. |
| 8 | Popup — dashboard link | Footer with "Open dashboard" link and saved counts. |

---

## 8. Release Checklist

### Pre-Submission
- [x] Repository is private
- [x] Version 0.1.0 in `package.json` and manifest
- [x] Manifest permissions match approved set (`storage`, `activeTab`, `https://api.github.com/*`)
- [x] Icons present at 16, 32, 48, 128
- [x] All quality gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm zip`, `pnpm test:e2e`
- [x] ZIP size: ~98 KB, contains only production assets (no source maps, no dev files)
- [x] Manifest contains correct name, version, description, permissions, icons
- [x] README includes privacy section, permissions explanation, install instructions
- [x] Buy Me a Coffee link present and correct
- [x] Repository is private
- [x] No secrets, credentials, or `.env` files in repo or ZIP

### Store Listing (To Be Created)
- [ ] Store title: "ContribFlow"
- [ ] Short description (≤132 chars): "Save GitHub issues with private notes and track pull requests locally."
- [ ] Detailed description (as above)
- [ ] Category: Developer Tools
- [ ] Screenshots uploaded (5-8)
- [ ] Promotional tile (440x280) — *pending design approval*
- [ ] Marquee (1400x560) — *pending design approval*
- [ ] Privacy policy URL — *decision needed: host a simple static page or link to repo README*
- [ ] Support email / contact — *decision needed*

---

## 8. Items Requiring Your Decision / Verification

| # | Item | Status |
|---|------|--------|
| 1 | **Privacy Policy URL** — Chrome Web Store requires a privacy policy. Options: (a) host a minimal static page on GitHub Pages, (b) link to `README.md#permissions-and-privacy` in the repo, (c) create a dedicated `PRIVACY.md` in the repo. | 🔴 Pending |
| 2 | **Support Contact** — Store requires a support email or contact form. Use personal email? Create a dedicated alias? | 🔴 Pending |
| 3 | **Promotional Images** — 440x280 tile and 1400x560 marquee are optional but recommended. Need design approval or creation. | 🔴 Pending |
| 4 | **Category** — "Developer Tools" seems correct. Confirm? | 🟡 Tentative |
| 5 | **Single-Purpose Description** — Store requires a single-purpose description. Current: "Save GitHub issues with private notes and track pull requests in a local dashboard." Confirm? | 🟡 Tentative |
| 6 | **Manual Chrome Smoke Test** — Load the built ZIP in a clean Chrome profile, verify install, save/untrack, dashboard, note edit, refresh, uninstall clears data. | 🔴 Pending |
| 7 | **Version Bump Strategy** — Confirm 0.1.0 is correct for initial submission. Future: semantic versioning? | 🟡 Tentative |

---

## 9. Artifacts for Submission

| Artifact | Path | Size |
|----------|------|------|
| Extension ZIP | `.output/contribflow-0.1.0-chrome.zip` | 97.99 kB |
| Manifest | `.output/chrome-mv3/manifest.json` | 453 B |
| Icons | `.output/chrome-mv3/icon-{16,32,48,128}.png` | 128 B / 153 B / 220 B / 656 B |

---

## 10. Remaining Risks & Open Questions

1. **Chrome Web Store review time** — Typically 1-3 business days; may require clarification on permissions.
2. **Rate limit messaging** — Users may hit GitHub's anonymous rate limit; current error messaging surfaces reset timing but cannot increase quota.
3. **Manifest V3 CSP** — Default CSP is restrictive; no inline scripts, eval, or remote scripts. Verified clean.
4. **No analytics** — Cannot measure adoption or errors post-launch without adding telemetry (which violates privacy promise).
5. **No update mechanism documented** — Chrome handles auto-updates; no in-app update notification needed.
6. **No migration path** — Schema v1 is final for MVP; future migrations will need careful handling.

---

*Document prepared for review. Do not submit to Chrome Web Store until all 🔴 items are resolved and manual Chrome smoke test passes.*