# Vendored: wavde/games (12-game bundle)

- **Upstream:** https://github.com/wavde/games
- **Pinned commit:** `2dac5d16033a19450553371a7920eb1806f8bff4`
  - Date: 2026-06-01
  - Subject: `Clarify games accessibility claims`
- **License:** MIT — `Copyright (c) 2026 Tejas Wavde`. Upstream `LICENSE` is
  copied verbatim; all upstream copyright headers are retained.
- **Local path:** `/games/wavde/` (hub) and `/games/wavde/<game>/` (12 games).

## Game routes

| # | Route | Title |
|---|---|---|
| 1 | `/games/wavde/tic-tac-toe/` | Tic-Tac-Toe |
| 2 | `/games/wavde/2048/` | 2048 |
| 3 | `/games/wavde/minesweeper/` | Minesweeper |
| 4 | `/games/wavde/memory/` | Memory Match |
| 5 | `/games/wavde/chess/` | Chess |
| 6 | `/games/wavde/connect-four/` | Connect Four |
| 7 | `/games/wavde/lights-out/` | Lights Out |
| 8 | `/games/wavde/mini-sudoku/` | Mini Sudoku |
| 9 | `/games/wavde/tango/` | Tango |
| 10 | `/games/wavde/queens/` | Queens |
| 11 | `/games/wavde/zip/` | Zip |
| 12 | `/games/wavde/patches/` | Patches |

## Local modifications (only these five)

1. **Google Fonts removed** from all 13 HTML pages (hub + 12 games). Exactly
   three `<link>` tags were deleted per page:
   - `<link rel="preconnect" href="https://fonts.googleapis.com">`
   - `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`
   - `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fira+Mono:wght@400;500;700&display=swap">`
2. **Monospace fallback** added to `shared.css`:
   `font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;`
   so the retro-terminal look is preserved with system fonts and **zero
   external network requests**.
3. **Back bar** injected immediately after the opening `<body>` tag of all 13
   HTML pages, inlined verbatim from `games/backbar-snippet.html` (the shared
   snippet used by the other vendored games). It links to `/games/` and shows
   the page title on the right.
4. **Canonical / og:url repointed to this site (2026-11-23).** In the hub
   `index.html`, `<meta property="og:url">` originally pointed at the upstream
   `https://wavde.github.io/games/`. It was changed to
   `https://mspy1.github.io/games/wavde/` so social/SEO metadata refers to this
   site's canonical location. The hub has no `<link rel="canonical">`. The
   `github.com/wavde/games` / `wavde.github.io` footer credit links were left
   as-is because they are outside this patch's scope. No game logic, game links
   or back bar were touched.
5. **Vendored `twitter:*` metadata removed (2026-11-23).** The upstream
   `<meta name="twitter:card" content="summary">` tag was deleted from the hub
   `index.html` per site policy (no Twitter metadata anywhere). No other head
   metadata, game links, game logic or back bar were changed.

No other files were changed. No build step, no external requests, no runtime
dependencies. All other upstream files (JS, CSS, `favicon.svg`, `manifest.json`,
`README.md`, `.nojekyll`) are copied verbatim.
