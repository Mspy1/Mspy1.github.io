# Game credits and licenses

The 21 games hosted at `/games/` are vendored snapshots of open-source projects.
Each keeps its upstream MIT license and copyright notice verbatim (see the
`LICENSE` files alongside the games). No game logic was modified. Screenshots of
the games under `games/thumbs/` are covered by the same MIT attribution.

| # | Game | Upstream project | License | Copyright |
|---|------|------------------|---------|-----------|
| 1 | Solitaire | [jhatzimalis/solitaire](https://github.com/jhatzimalis/solitaire) | MIT | Copyright (c) 2026 Justin Hatzimalis |
| 2 | Wordle Clone | [WebDevSimplified/wordle-clone](https://github.com/WebDevSimplified/wordle-clone) | MIT | Copyright 2022 WebDevSimplified |
| 3 | Fancy, the Banana | [lfcfoundry/fancy-banana](https://github.com/lfcfoundry/fancy-banana) | MIT | Copyright (c) 2026 LFC Foundry |
| 4 | 12-game bundle | [wavde/games](https://github.com/wavde/games) | MIT | Copyright (c) 2026 Tejas Wavde |
| 5 | Brush & Blade | [emollick/brush-and-blade](https://github.com/emollick/brush-and-blade) | MIT | Copyright (c) 2026 Ethan Mollick |
| 6 | Bomberman Web | [LoggeL/bomberman-web](https://github.com/LoggeL/bomberman-web) | MIT | © 2026 bomberman-web contributors |
| 7 | Tank Battle | [Jingzhe0915/tank-battle](https://github.com/Jingzhe0915/tank-battle) | MIT | © 2026 Jingzhe0915 |
| 8 | Craterfall | [blueRonyHazard/craterfall-the-game](https://github.com/blueRonyHazard/craterfall-the-game) | MIT | © 2026 Craterfall contributors |
| 9 | Roomwright | [pyros-projects/roomwright](https://github.com/pyros-projects/roomwright) | MIT | © 2026 pyros-projects |

## 1. Solitaire

- **Upstream:** https://github.com/jhatzimalis/solitaire
- **Pinned commit:** `a737d5a60d79d0e5a24f320354709ae35dc4ec7d` (2026-05-18)
- **License:** MIT — `Copyright (c) 2026 Justin Hatzimalis`. Upstream `LICENSE`
  copied verbatim to `games/solitaire/LICENSE`.
- **Local files:** `games/solitaire/`
- **Local patches:** injected site-styled back bar linking to `/games/`, added
  the site's data-URI favicon, and added a width override so the bar spans the
  viewport. Game logic untouched; upstream inline CSS/JS retained verbatim.

## 2. Wordle Clone

- **Upstream:** https://github.com/WebDevSimplified/wordle-clone
- **Source credit:** this is the upstream source for the Wordle clone hosted at
  `/games/wordle/`. (Per the implementation ledger, Wordle's source credit is
  carried here in the site-wide credits rather than by editing game files.)
- **Pinned commit:** `b12c2df422d2393b156600d2536a20f4c824af32` (2022-03-17)
- **License:** MIT — `Copyright 2022 WebDevSimplified`. Upstream `LICENSE`
  copied verbatim to `games/wordle/LICENSE`.
- **Local files:** `games/wordle/`
- **Local patches:** injected site-styled back bar linking to `/games/` and
  added the site's data-URI favicon. `styles.css` and `script.js` are
  byte-identical to upstream; game logic untouched.

## 3. Fancy, the Banana

- **Upstream:** https://github.com/lfcfoundry/fancy-banana
- **Pinned commit:** `e39b007ae168053f6cdfc617747dbd6b081df078` (2026-11-22)
- **License:** MIT — `Copyright (c) 2026 LFC Foundry`. Upstream `LICENSE`
  copied verbatim to `games/fancy-banana/LICENSE`.
- **Local files:** `games/fancy-banana/`
- **Local patches:** injected site-styled back bar (using `position:fixed` and a
  `padding-top` override so the canvas sizes correctly below it); upstream's
  inline favicon retained. Game logic untouched.

## 4. wavde/games (12-game bundle)

- **Upstream:** https://github.com/wavde/games
- **Pinned commit:** `2dac5d16033a19450553371a7920eb1806f8bff4` (2026-06-01,
  `Clarify games accessibility claims`)
- **License:** MIT — `Copyright (c) 2026 Tejas Wavde`. Upstream `LICENSE`
  copied verbatim to `games/wavde/LICENSE`.
- **Local files:** `games/wavde/` (hub + 12 games: tic-tac-toe, 2048,
  minesweeper, memory, chess, connect-four, lights-out, mini-sudoku, tango,
  queens, zip, patches). All 12 games' `Source ↗` links on the hub point to
  this single upstream repo.
- **Local patches (recorded in full in `games/wavde/VENDORED.md`):**
  - **Google Fonts removed** from all 13 HTML pages (hub + 12 games): exactly
    three `<link>` tags deleted per page (two `preconnect` links and the
    `fonts.googleapis.com` Fira Mono stylesheet). This removes all external
    network requests.
  - **System-monospace fallback** added to `games/wavde/shared.css`
    (`font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;`)
    to preserve the retro-terminal look without a CDN font.
  - **Back bar** injected immediately after the opening `<body>` tag of all 13
    HTML pages, linking to `/games/`.
  - No other files changed; all JS, other CSS, favicon, manifest and docs are
    verbatim. No build step, no runtime dependencies.

## 5. Brush & Blade

- **Upstream:** https://github.com/emollick/brush-and-blade
- **Pinned commit:** `24b9cbc5262511f22b39951e438f1f445fcd4db3` (2026-11-23)
- **License:** MIT — `Copyright (c) 2026 Ethan Mollick`. Upstream `LICENSE`
  copied verbatim to `games/brush-and-blade/LICENSE`.
- **Local files:** `games/brush-and-blade/` — the vendored `dist/` produced by
  the one-time, dependency-free build command `node build.cjs`.
- **Local patches:** built once with `node build.cjs` and vendored the resulting
  `dist/`; injected the site-styled back bar linking to `/games/` immediately
  after the opening `<body>` tag of `games/brush-and-blade/index.html`. Game
  logic untouched; no runtime external requests introduced.

## 6. Bomberman Web

- **Upstream:** https://github.com/LoggeL/bomberman-web
- **Pinned commit:** `5436b40300b6cbd4f6fb411af4ef52955d7995c7`
- **License:** `MIT · © 2026 bomberman-web contributors`. Upstream `LICENSE`
  copied verbatim to `games/bomberman/LICENSE`.
- **Local files:** `games/bomberman/` — the vendored `dist/` output of the
  one-time Vite build (`npm ci && npm run build`), with `base` set so the assets
  resolve under `/games/bomberman/`. Built in local-multiplayer mode only.
- **Local patches:** no runtime CDN, font or analytics requests; injected the
  themed back bar linking to `/games/` and a head script that sets
  `data-site-theme` from `localStorage.site-theme` before paint, leaving the
  game's own `data-theme` untouched. Game logic unchanged. Full build, audit
  and patch detail is in `games/bomberman/VENDORED.md`.

## 7. Tank Battle

- **Upstream:** https://github.com/Jingzhe0915/tank-battle
- **Pinned commit:** `72bd27c167704403fdf84280efa70fb291db2dd4` (2026-04-07,
  `Add MIT License to the project`)
- **License:** `MIT · © 2026 Jingzhe0915`. Upstream `LICENSE` copied verbatim
  to `games/tank-battle/LICENSE`.
- **Local files:** `games/tank-battle/` — the upstream `index.html` and
  `LICENSE`, copied verbatim. No build step: all HTML, CSS and game JavaScript
  are inlined in the single page and the arena renders to a `<canvas>`.
- **Local patches:** the external-URL audit found no CDNs, fonts, analytics or
  other external references, so no stripping was needed. Added a head theme
  bootstrap script that sets `data-site-theme` from `localStorage.site-theme`
  before paint, and injected the back bar linking to `/games/`. Game logic
  unchanged; full detail is in `games/tank-battle/VENDORED.md`.

## 8. Craterfall

- **Upstream:** https://github.com/blueRonyHazard/craterfall-the-game
- **Pinned commit:** `0685b15ffa8fd305ad14d0b004add3dc65ae9a3b`
- **License:** `MIT · © 2026 Craterfall contributors`. Upstream `LICENSE`
  copied verbatim to `games/craterfall/LICENSE`.
- **Local files:** `games/craterfall/` — the vendored `dist/` output of the
  one-time Vite/Phaser build (`npm ci && npm run build`), with the `base` path
  set so every hashed chunk and asset resolves under `/games/craterfall/`.
- **Local patches:** no runtime CDN, font or analytics requests; injected the
  themed back bar linking to `/games/` and a head script that sets
  `data-site-theme` from `localStorage.site-theme` before paint without
  touching the game's own theming. Game logic unchanged. Full build, audit and
  patch detail is in `games/craterfall/VENDORED.md`.

## 9. Roomwright

- **Upstream:** https://github.com/pyros-projects/roomwright
- **Pinned commit:** `a1a943f9762df17a94a8c80d5f8d7faae37e7370`
- **License:** `MIT · © 2026 pyros-projects`. Upstream `LICENSE` copied
  verbatim to `games/roomwright/LICENSE`.
- **Local files:** `games/roomwright/` — the upstream `index.html` and
  `LICENSE`, copied verbatim. No build step: the game is a single self-contained
  page with its CSS and JavaScript inlined.
- **Local patches:** no runtime CDN, font or analytics requests; injected the
  themed back bar linking to `/games/` and a head script that sets
  `data-site-theme` from `localStorage.site-theme` before paint. Game logic
  unchanged. Full detail is in `games/roomwright/VENDORED.md`.

## Shared local patch — back bar

Every one of the 21 game pages (plus the wavde hub) carries a slim site-styled
bar at the top: `← Mspy1 · Games` linking to `/games/` with the page title on
the right. It is inlined from `games/backbar-snippet.html`. This is a navigational
containment bar only; no game UI or logic is altered by it.
