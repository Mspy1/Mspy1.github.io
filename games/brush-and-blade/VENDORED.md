# Vendored: emollick/brush-and-blade

- **Upstream:** https://github.com/emollick/brush-and-blade
- **Pinned commit:** `24b9cbc5262511f22b39951e438f1f445fcd4db3`
  - Date: 2026-09-15
  - Subject: `Release Brush and Blade with eight artist knights and MIT license`
- **License:** MIT — `Copyright (c) 2026 Ethan Mollick`. Upstream `LICENSE` is
  copied verbatim and retained in this directory.
- **Local path:** `/games/brush-and-blade/`

## What is vendored

Only the upstream `dist/` build output plus the upstream `LICENSE` and this
provenance note. `dist/` was produced once at the pinned commit with the
upstream's own dependency-free build script:

```
node build.cjs
```

Build output: `Built 18 public files.` (~10.02 MB total, dominated by eight
WebP sprite sheets + one WebP gallery background). The vendored files are:

- `index.html`, `style.css`, `engine.js`, `game.js`, `favicon.svg`, `_headers`
- `assets/fighter-motion.js`, `assets/sprite-layout.js`, `assets/sprites.js`
- `assets/{klimt,hokusai,kandinsky,matisse,mondrian,okeeffe,rothko,vangogh}.webp`
- `assets/gallery.webp`

All assets referenced by `index.html` and the JS are present locally; no
runtime network requests are required.

## External URL audit

Grep of all vendored files for `http://`, `https://`, `//fonts`,
`fonts.googleapis`, `fonts.gstatic`, `cdn.`, `analytics`, and
`googletagmanager` found a **single** match:

- `favicon.svg` line 1: `xmlns="http://www.w3.org/2000/svg"`

This is the standard SVG XML namespace identifier, not a fetched resource —
no patch required. No runtime-critical external URLs were found.

## Local modifications

1. **Back bar** injected immediately after the opening `<body>` tag of
   `index.html`, inlined verbatim from `games/backbar-snippet.html` (the shared
   snippet used by the other vendored games). It links to `/games/` and shows
   the title `Brush & Blade` on the right. No game logic changed.

No other files were changed. No build step runs on Pages; this is a static
snapshot and will not auto-update.
