# Vendored: LoggeL/bomberman-web

- **Upstream:** https://github.com/LoggeL/bomberman-web
- **Pinned commit:** `5436b40300b6cbd4f6fb411af4ef52955d7995c7`
  - Checked out on: 2026-11-23
  - Commit subject: `Replace Tidal Works SVG with generated splash and tile art`
- **License:** MIT — `Copyright (c) 2026 bomberman-web contributors`.
  Upstream `LICENSE` is copied verbatim into this directory.
- **Local path:** `/games/bomberman/`
- **Mode:** static local couch play only. The upstream WebSocket server
  (`npm start` / `/ws`) is **not** included; online multiplayer is unavailable
  on static hosting, exactly as upstream's own GitHub Pages target documents.

## Build

Built once from a clean checkout at the pinned SHA, in a temp directory (not in
the repo). Per upstream README, this needs Node 24+ (built with Node v26.13.0 /
npm 11.20.0):

```
git clone https://github.com/LoggeL/bomberman-web.git <temp>/bomberman-web
cd <temp>/bomberman-web
git checkout 5436b40300b6cbd4f6fb411af4ef52955d7995c7
npm ci
npm run build          # package.json "build" == "vite build"
```

Both `npm ci` and `npm run build` exited 0. Vite 6.4.3 transformed 36 modules
and emitted `dist/` (index.html 24.54 kB, one CSS chunk 37.21 kB, one JS chunk
133.70 kB, plus favicon, 6 splash WebPs, 5 sprite WebPs and 6 tile WebPs).
The whole `dist/` tree was copied into this folder verbatim, followed by the
patches below. No build runs on Pages — this is a static snapshot.

### Vite base path — no patch needed

Upstream `vite.config.js` already sets `root: 'client'`, `base: './'` and
`outDir: '../dist'`. The built `index.html` therefore uses only relative asset
URLs (`./assets/…`, `./splashes/…`, `./favicon.svg`, `./tiles/…`,
`./sprites/…`); there are no root-absolute `/…` paths. No Vite config edit was
required.

## External resource audit

A grep of the built `dist/` for `http://`, `https://`, `fonts.googleapis`,
`fonts.gstatic`, `cdn.`, `analytics`, `googletagmanager`, `gtag`, `src="/` and
`href="/` found exactly one match:

- `favicon.svg` line 1: `xmlns="http://www.w3.org/2000/svg"`

That is the standard SVG XML namespace identifier, not a fetched resource.
**No font / CDN / analytics links were present, so no CDN-stripping patch was
needed.** The only remaining network-capable code is the optional online-mode
WebSocket client, which connects to same-origin `/ws` only when a user chooses
"Online spielen"; it is never touched in local mode and makes no request on
page load.

## Local modifications (only these two)

1. **Back bar** inlined verbatim immediately after the opening `<body>` tag of
   `index.html`, from the shared `games/backbar-snippet.html`, with
   `{{GAME_TITLE}}` replaced by `Bomberman`. It keeps the `← Mspy1 · Games`
   link to `/games/`, is 48px tall, sticky at `top: 0`, and has
   `z-index: 2147483000` so it overlays the game's fixed full-viewport `#app`.
   No game logic changed.
2. **Head script** added as the first element inside `<head>`:

   ```html
   <script>(function(){var t="system";try{t=localStorage.getItem("site-theme")||"system"}catch(e){}if(t!=="dark"&&t!=="light"){t=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}var d=document.documentElement;d.setAttribute("data-site-theme",t)})();</script>
   ```

   It reads `localStorage.site-theme` before paint (system default resolved via
   `prefers-color-scheme`). It sets **only** `data-site-theme` — not
   `data-theme` — so it cannot collide with any game-owned theme attribute;
   the shared back bar CSS responds to `html[data-site-theme="dark"]`.

No other files were changed. All game assets and logic are upstream verbatim.
