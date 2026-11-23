# Roomwright — vendored copy

- **Source:** https://github.com/pyros-projects/roomwright
- **Pinned SHA:** `a1a943f9762df17a94a8c80d5f8d7faae37e7370`
- **Vendored on:** 2026-11-23
- **License:** MIT (see `LICENSE`, copied verbatim from the pinned commit).
  Copyright (c) 2026 pyros-projects.

## Files

- `index.html` — the complete, build-free game (single file, ~430 KB). Copied
  verbatim from the pinned commit; all art is generated at boot from code and
  all audio is synthesised, so there are no companion asset files.
- `LICENSE` — verbatim MIT license from the pinned commit.
- `VENDORED.md` — this file.

## Build

**No build needed.** The upstream repository ships a ready-to-play `index.html`
at the pinned commit (it is generated from the `src/` modules by the upstream
`tools/build.sh`, but that generated file is committed and is what we vendor).
Nothing is fetched or compiled at runtime.

The intro video (`intro.mp4`) and promotional GIFs were intentionally **not**
shipped — they are not needed to play the game.

## Patches applied to `index.html`

Only the shared site chrome was added and one tiny compatibility guard was
inserted (patch 3 below); the visible game UI and all gameplay are unchanged.
Aside from these three edits the file is byte-for-byte identical to the pinned
upstream `index.html` (verified by reversing the edits and comparing SHA-256).

1. **Head script (before paint).** Inserted immediately after `<head>` a tiny
   inline script that reads `localStorage.site-theme` (defaulting to the system
   `prefers-color-scheme`) and sets `html[data-site-theme]` before first paint.
   Only `data-site-theme` is set — Roomwright does not use `data-theme` for its
   own UI — so the game cannot be affected by the site theme.

2. **Themed back bar.** The shared `games/backbar-snippet.html` was inlined
   verbatim immediately after `<body>` with the title `Roomwright`. It keeps
   `href="/games/"`, a 48px sticky bar, and `z-index:2147483000`, and themes from
   `data-site-theme` (dark when `site-theme=dark`). No per-page CSS overrides
   were added.

3. **Skip the intro film request (compatibility guard).** Upstream calls
   `Intro.load()` unconditionally at boot; that creates a `<video>` element and
   sets `el.src = 'intro.mp4'`, which 404s (console error + failed request)
   because the MP4 is intentionally not shipped. A four-line guard at the top of
   `Intro.load()` marks the intro as unavailable and returns before the player
   is created. `Intro.begin()` already returns false in that case, so the game
   starts on the title screen exactly as upstream does when the film file is
   missing — no visual/gameplay change, just no failed request. The upstream
   `?intro=0` hook alone is not enough because it only skips `begin()`, not
   `load()`.

## External requests / CDN stripping

**None.** The pinned `index.html` contains no external URLs, protocol-relative
URLs, `<link>` tags, `<script src>`, `@import`, `@font-face`, web fonts, CDN
assets, analytics/gtag, `fetch()` or `XMLHttpRequest`. All code, art and audio
are self-contained, so no CDN/font/analytics links needed stripping and no
patch of that kind was recorded. Verified by static scan and by serving the
page locally and observing the network (see verification report).
