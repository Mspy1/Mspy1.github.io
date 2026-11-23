# Vendored: blueRonyHazard/craterfall-the-game

- **Upstream:** https://github.com/blueRonyHazard/craterfall-the-game
- **Pinned commit:** `0685b15ffa8fd305ad14d0b004add3dc65ae9a3b`
  - Date: 2026-10-06 (commit date `2026-10-06 23:54:40 +0100`)
  - Subject: `Adding New Weapons (Dirt Remover + Dirt Collector + Magma Pool) + Fix Tests`
- **License:** MIT — `Copyright (c) 2026 Craterfall contributors`. Upstream `LICENSE` is
  copied verbatim and retained in this directory (SHA-256
  `6CEEED8A660705E050BA9F2751DD2DB7395255E7D4DF5BD09755B2D0F3348F20`).
- **Local path:** `/games/craterfall/`

## What is vendored

The complete upstream `dist/` production build, plus the upstream `LICENSE` and
this provenance note. The build was produced once at the pinned commit with the
upstream's own toolchain (TypeScript + Phaser 3 + Vite). No upstream source files,
tests, workflows, or docs are vendored — only the built static snapshot.

Build command (run from a clean clone at the pinned commit):

```
npm install
BASE_PATH=/games/craterfall/ npm run build
```

(`npm ci` is not available upstream — the repository pins no `package-lock.json`
at this commit, so `npm install` was used. The build script is
`tsc --noEmit && vite build`; Vite resolved `vite@6.4.6`, `phaser@3.90.x`.)

Build output: `dist/` (11 vendored files, ~11.53 MB total — dominated by the two
optional source maps). Vendored files:

- `index.html`, `favicon.svg`, `LICENSE`, `VENDORED.md`
- `assets/index-BXf4CT2m.js`, `assets/index-CjY3zExj.css`
- `assets/phaser-ZmHddmjc.js` (Phaser kept in its own long-cacheable chunk)
- `assets/index-BXf4CT2m.js.map`, `assets/phaser-ZmHddmjc.js.map` (optional
  DevTools source maps; not requested at runtime unless DevTools is open)
- `assets/README.md`, `.DS_Store` (inert passthrough files copied from upstream
  `public/`; harmless)

All runtime assets are local. The game paints every texture procedurally and
synthesises every sound with the Web Audio API, so it fetches no images, fonts,
or audio at runtime.

## Base-path / config patches

**No source or config patch was needed.** The upstream `vite.config.ts` already
reads `process.env.BASE_PATH ?? '/'` and applies it as Vite's `base`, and its
`index.html` references `/favicon.svg` / `/src/main.ts` (which Vite rewrites
against that base). Building with `BASE_PATH=/games/craterfall/` rewrote every
emitted asset URL to `/games/craterfall/...`, e.g.:

- `<link rel="icon" ... href="/games/craterfall/favicon.svg" />`
- `<script type="module" crossorigin src="/games/craterfall/assets/index-BXf4CT2m.js"></script>`
- `<link rel="modulepreload" crossorigin href="/games/craterfall/assets/phaser-ZmHddmjc.js">`
- `<link rel="stylesheet" crossorigin href="/games/craterfall/assets/index-CjY3zExj.css">`

`vite.config.ts` was not modified.

## External URL audit

Grep of all built text files for `http://`, `https://`, `//fonts`,
`fonts.googleapis`, `fonts.gstatic`, `cdn.`, `analytics`, `googletagmanager`,
and `@import` found **no runtime-fetchable external references**:

- `index.html`: all `src`/`href` are local `/games/craterfall/...` paths.
- `assets/index-CjY3zExj.css`: no `@import`, no `url(http...)`; only system font
  stack and a CSS radial gradient.
- `assets/index-*.js`: only Vite's inline modulepreload feature test
  (`document.createElement('link').relList`) — no network fetch.
- `assets/phaser-*.js`: `https://...` matches are confined to third-party
  `@license` / `@author` doc-comment headers (e.g. `opensource.org/licenses/MIT`)
  and an unused `xhrSettings` asset-loader code path. The game never calls the
  Phaser loader with an external URL, so no request is made.
- `favicon.svg`: `xmlns="http://www.w3.org/2000/svg"` is the standard SVG XML
  namespace identifier, not a fetched resource.

No CDN, font, or analytics links existed upstream, so **nothing was stripped**.

## Local modifications

Only `index.html` was modified after the build:

1. **Theme head script** — a tiny inline `<script>` inserted as the first child
   of `<head>`. It reads `localStorage.site-theme`, falls back to the system
   `prefers-color-scheme`, and sets `data-site-theme` on `<html>` before first
   paint so the back bar paints in the correct theme without a flash. It sets
   only `data-site-theme` (not `data-theme`) so it cannot collide with any
   game-owned theming.
2. **Back bar** — the shared snippet from `games/backbar-snippet.html` inlined
   verbatim immediately after the opening `<body>` tag, with the title span set
   to `Craterfall`. It keeps the `/games/` link, the 48px height and the
   `z-index: 2147483000` stacking value. No game logic, markup below the bar,
   CSS, or JS chunk was changed.

No other files were changed. No build step runs on Pages; this is a static
snapshot and will not auto-update.
