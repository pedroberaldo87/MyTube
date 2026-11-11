# Contributing to MyTube

Thanks for your interest in MyTube. This document covers how to set up the project, how it is laid out, and what a good pull request looks like.

## Getting started

### Prerequisites

- Node.js 20 or later and npm
- Chrome (to load the unpacked extension)
- Chromium for Playwright, used by six of the tests: `npx playwright install chromium`

### Local setup

```bash
git clone https://github.com/pedroberaldo87/MyTube.git
cd MyTube
npm ci
npm run build
```

Load the generated `dist/` folder at `chrome://extensions` with **Developer mode** on and **Load unpacked**. After each rebuild, click the reload icon on the MyTube card and reload your YouTube tab. The README has the full walkthrough.

## Project structure

- `src/content/` is the part injected into youtube.com: the sidebar, the feed overlays, scrapers for the subscriptions and playlists pages, and `page-bridge.ts`, which runs in the page's MAIN world.
- `src/background/` is the service worker: storage access, the new-upload poller, the channel-page scraper and every AI call (`src/background/ai/`).
- `src/shared/` is code used by both sides: types, storage, IndexedDB, i18n strings, AI provider types.
- `src/dashboard/` is the extension's options page. `src/permission/` is the small popup used to request host permissions. `src/aikey/` is the popup window where an API key is typed: keys are never entered in the sidebar, which lives in youtube.com's DOM.
- `src/styles/` holds the theme logic and design tokens.
- `build.ts` is the real build entry point. It bundles each part separately and writes `dist/manifest.json`, so permission changes go there, not in a static file. `vite.config.ts` only serves `npm run dev`.
- `test/` holds the tests; `test/fixtures/` holds recorded inputs.

## Scripts

```bash
npm run build       # type-check, then build into dist/
npm run typecheck   # types only
npm test            # test suite (node:test via tsx)
npm run package     # build, then zip dist/ into mytube.zip
npm run dev         # Vite dev server (dashboard page only)
```

There is no lint script. CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run typecheck`, `npm test` and `npm run build`; please run them locally before opening a PR.

## Guidelines

- **Keep a PR focused** on one change.
- **Add a test** for behavior you change. Tests live in `test/*.test.mjs`. Prefer asserting on what the real code does; several tests drive a real Chromium through Playwright.
- **Strings go through `src/shared/i18n.ts`** with both `en` and `pt-BR` entries.
- **Permissions are expensive.** Every new entry in `build.ts` becomes a line in Chrome's install dialog. Explain why in the PR and update the permissions table in both READMEs.
- **Credentials never cross a message response, and never touch `chrome.storage.local` or the sidebar.** See [SECURITY.md](SECURITY.md) for the four invariants around AI provider credentials.
- **Docs follow the code.** If you change a script, setting or permission, update `README.md` and `README.pt-BR.md` in the same PR.
- **Screenshots use made-up data only.** No real channels, accounts or e-mail addresses.
- Match the existing style: TypeScript, 2-space indentation, no semicolons.

## Pull requests

- Use a clear title, for example "Fix duplicate channels after a handle change".
- Say what changed and why, and how you tested it.
- For UI changes, attach a screenshot or short recording.

## Bugs and ideas

Open an issue. For bugs, include your Chrome version, what you did, what you expected and what happened. If YouTube changed its markup and a scraper broke, say which page.

Do not report security problems in a public issue. Follow [SECURITY.md](SECURITY.md).

By contributing you agree that your work is released under the project's [GPL-3.0 license](LICENSE). Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
