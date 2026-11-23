# Vendored: Jingzhe0915/tank-battle

- **Upstream:** https://github.com/Jingzhe0915/tank-battle
- **Pinned commit:** `72bd27c167704403fdf84280efa70fb291db2dd4`
  - Date: 2026-04-07
  - Subject: `Add MIT License to the project`
- **License:** MIT — `Copyright (c) 2026 Jingzhe0915`. Upstream `LICENSE` is
  copied verbatim and retained in this directory.
- **Local path:** `/games/tank-battle/`
- **Vendored on:** 2026-11-23

## What is vendored

The upstream repository is a single, self-contained `index.html` (no build
step, no dependencies, no separate asset files). The two upstream files
`index.html` and `LICENSE` were copied verbatim from the pinned commit and
then locally patched as listed below; no build is needed (`no build`).
Nothing else is required at runtime — all markup, CSS and game JavaScript
are inlined in `index.html` and the arena is rendered to a `<canvas>`.

The values below are **SHA-256 of the vendored (CRLF) file; upstream LF blob
hashes differ** (the working-tree copies use CRLF line endings, whereas the
upstream git blobs are stored with LF). They identify the files as first
vendored, before the local patches below; the patched files hash differently:

- `index.html` → `933A88EEEA9730E78D9C0F73B39C47118A3D8094BEEFFDE596BAF9AE055710EF`
- `LICENSE` → `22C573042B1C87C7FB3DE3D3C6C2B3B329EFCFFF917B0502033A9612962E1700`

## External URL audit

Grep of the verbatim upstream `index.html` for `http://`, `https://`, `//fonts`,
`fonts.googleapis`, `fonts.gstatic`, `cdn.`, `analytics`, `googletagmanager`,
`<link`, `<script src`, `@import`, `url(` and `http` found **zero** matches.
There are no external stylesheets, scripts, fonts, images, CDNs or analytics
endpoints. No CDN stripping was required and the game makes no external
runtime requests.

The only `http://` string introduced by our patches is the standard SVG XML
namespace (`xmlns="http://www.w3.org/2000/svg"`, percent-encoded) inside the
inline data-URI favicon below. It is an identifier, not a fetched resource.

## Local modifications

1. **Theme bootstrap script** added as the first child of `<head>` of
   `index.html`. It reads `localStorage.site-theme` before paint and sets
   `data-site-theme` (and `data-theme`, which this game does not otherwise use)
   on `<html>`, defaulting to `dark` when no choice is stored (a stored `system`
   still falls back to the OS `prefers-color-scheme`).
   This lets the shared back bar theme dark without touching the game's own
   fixed dark UI. No game logic changed.
2. **Back bar** injected immediately after the opening `<body>` tag of
   `index.html`, inlined verbatim from `games/backbar-snippet.html` (the shared
   snippet used by the other vendored games). It links to `/games/` and shows
   the title `Tank Battle` on the right, at 48px height with the snippet's
   `z-index`. No game logic changed.
3. **Back bar 48px lock** — a one-line per-page override appended after the
   verbatim snippet (`.msm-backbar{flex-shrink:0}`). This game's `body` is a
   `display:flex; flex-direction:column; height:100vh` container, so the bar was
   otherwise flex-shrunk to ~14px on small viewports; this keeps it at 48px.
   This is the same class of per-page addition the shared snippet documents.
4. **Inline favicon** added in `<head>` (the site's `M` monogram as a
   `data:image/svg+xml` URI, identical to the one used by the other vendored
   games). The upstream has no favicon, so without this the browser's automatic
   `/favicon.ico` request returned 404 and logged a console error. This is
   browser chrome only — no network request, no game UI change.

5. **Mobile horizontal-overflow guard (superseded by patch 6)** - the upstream
   pins the canvas to its native 800x400 resolution (about 805px wide) and
   centres it with a negative left offset. `body` already had
   `overflow-x:hidden`, but at a 390px viewport
   `document.documentElement.scrollWidth` was 598px, so the document still
   scrolled sideways. A chrome-only rule was added to the head `<style>` block:

   ```css
   html { overflow-x: hidden; }
   ```

   This clipped the fixed-size canvas at narrow widths without touching game
   logic, canvas dimensions, controls, or the back bar. Re-verified at 390x844:
   `document.documentElement.scrollWidth <= innerWidth`, no console errors,
   canvas still rendered, back bar still 48px and themed. **This rule was
   removed by patch 6** once the canvas was actually scaled to fit; it is kept
   in this record only as history, so no clip is needed any more.

6. **Responsive canvas / real mobile layout fix** - the upstream 800x400 backing
   store was hard-pinned and centred with a negative offset, so at 390x844 the
   canvas rendered 805px wide at `left:-207` (only ~250px visible) and at
   320x700 it rendered entirely below the fold. Patch 5 only hid the overflow.
   CSS-only changes in the head `<style>` block of `index.html`:

   - Removed the `html { overflow-x: hidden; }` rule from patch 5 entirely.
   - `#canvas-wrap { min-height: 0; }` so the flex row can shrink and give the
     canvas a definite height to resolve `max-height` against.
   - Added `#gc { max-width: min(100vw, 100%); max-height: 100%; width: auto;
     height: auto; }` (the `100%` half of the `min()` ties the cap to the
     viewport-spanning wrap). The canvas keeps its native 800x400 backing
     store, so every game coordinate, wall, hitbox and control is unchanged;
     only the rendered CSS box scales.
   - Replaced the patch-5-era narrow media query with
     `@media (max-width: 700px), (max-height: 520px)`, which lets the two fixed
     HUD columns shrink (`.hud-player { width:auto; flex:1 1 0; min-width:0 }`,
     `.hp-track { width:100%; max-width:190px }`, smaller HUD type) and caps the
     stacked settings panel at `max-height:32vh; overflow-y:auto` so the arena
     always has room on phones and in landscape. Settings remain reachable by
     scrolling inside the panel.

   No game logic, canvas dimensions, key bindings or back-bar code changed.

No other files were changed. No build step runs on Pages; this is a static
snapshot and will not auto-update.
