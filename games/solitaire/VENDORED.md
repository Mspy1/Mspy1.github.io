# Vendored: jhatzimalis/solitaire

- **Upstream:** https://github.com/jhatzimalis/solitaire
- **Pinned commit:** `a737d5a60d79d0e5a24f320354709ae35dc4ec7d` (2026-05-18)
- **License:** MIT — `Copyright (c) 2026 Justin Hatzimalis`. Upstream `LICENSE`
  is copied verbatim to `games/solitaire/LICENSE`.
- **Local path:** `/games/solitaire/`
- **Local patch recorded:** 2026-11-23

## What is vendored

The upstream is a single, self-contained `index.html` (all CSS and JS inlined,
no build step, no companion asset files) plus its `LICENSE`. Both were copied
from the pinned commit and then locally patched as listed below.

## Local modifications

1. **Site-chrome patches (pre-existing).** As recorded in `games/CREDITS.md`:
   injected the site-styled back bar linking to `/games/`, added the site's
   data-URI `M` favicon (so the browser stops requesting `/favicon.ico` and
   logging a 404 console error), and added a width override so the bar spans the
   viewport. Game logic was untouched and upstream inline CSS/JS was retained.
2. **Canonical / og:url repointed to this site (2026-11-23).** In `index.html`
   the `<link rel="canonical">` and `<meta property="og:url">` (plus the
   commented-out `og:image` placeholder), originally pointed at the upstream
   `https://jhatzimalis.github.io/solitaire/`. They were changed to
   `https://mspy1.github.io/games/solitaire/` so SEO/social metadata refers to
   this site's canonical location. No game logic or back bar was touched.
3. **Vendored `twitter:*` metadata removed (2026-11-23).** The upstream
   Twitter/X block in `index.html` — `twitter:card`, `twitter:url` (which still
   pointed at `https://jhatzimalis.github.io/solitaire/`), `twitter:title`,
   `twitter:description` and the commented `twitter:image` — was deleted per
   site policy (no Twitter metadata anywhere). No other head metadata, game
   logic or back bar was changed.

No other files were changed. No build step runs on Pages; this is a static
snapshot and will not auto-update.
