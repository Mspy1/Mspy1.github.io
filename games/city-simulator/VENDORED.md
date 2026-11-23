# City Simulator — vendored copy (published modified edition)

- **Upstream:** https://github.com/graememcc/micropolisJS
- **Published snapshot:** gh-pages `afe2047a9fca66d721ddcfe2eaf6d08d2c226c56`
  (the shipped `index.html` identifies the source build as
  `f13a1624d111d235e804bd80f48ba7c9f66a8e0f`; the upstream `about.html` footer
  carries the shorter build marker `f13a1624d111`).
- **Source archive:** `corresponding-source.zip` — a verbatim `git archive` of
  source commit `f13a1624d111d235e804bd80f48ba7c9f66a8e0f`. No history, no
  `node_modules`. Large file check: 625,436 bytes total, max file 449,242 bytes.
- **Vendored on:** 2026-11-23
- **Status:** published, modified and unendorsed edition. The owner confirmed a
  noncommercial arcade; the neutral display name is used because the Micropolis
  Public Name License restricts promotional/website use of the mark.

## License and notices

- GNU GPL v3 — full text in `COPYING` (verbatim).
- micropolisJS / Electronic Arts additional GPL §7 terms, copyright notice,
  indemnity, no-affiliation condition and disclaimer — `LICENSE` (verbatim).
- Micropolis Public Name License v1 — `name_license.html` (verbatim upstream
  legal document). The required courtesy attribution is reproduced verbatim on
  the game page (`index.html`) and on `CREDITS.html` / `about.html`.
- jQuery (MIT) — `thirdparty/jquery/MIT-LICENSE.txt`; the three bundled jQuery
  builds are unmodified.
- Chunk font (SIL OFL 1.1) — `css/FONT_LICENSE.markdown`; `css/chunk.woff` is
  unmodified.
- Webpack runtime notice — `src/micropolis.js.LICENSE.txt`.

The required trademark attribution, source pin and author credit are preserved
in `CREDITS.html`; no rights in the MICROPOLIS or SimCity marks are claimed and
no endorsement or affiliation is implied.

## Files

- `index.html` — game page, patched as described below.
- `src/micropolis.js` — upstream bundle, three literal string substitutions only.
- `css/style.css`, `css/chunk.woff`, `images/*`, `sprites/*`, `thirdparty/*` —
  upstream assets, except the removed remote font import in `style.css`.
- `COPYING`, `LICENSE`, `name_license.html`, `css/FONT_LICENSE.markdown`,
  `thirdparty/jquery/MIT-LICENSE.txt`, `src/micropolis.js.LICENSE.txt` —
  verbatim upstream notices.
- `CREDITS.html`, `about.html` — local credits/neutral about routes.
- `apply-local-patch.py` — deterministic patcher; given the pristine gh-pages
  snapshot it reproduces every local file listed above.
- `VENDORED.md` — this file.
- `../../thumbs/city-simulator.png` — actual gameplay screenshot, 1200×750.

## Build

No build is required. The pinned gh-pages snapshot already contains the compiled
bundle and all artwork. To reproduce the local files:

```
python apply-local-patch.py <pristine-gh-pages-checkout> <output-dir>
```

Upstream pinning used during vendoring:

```
git clone https://github.com/graememcc/micropolisJS.git
git checkout f13a1624d111d235e804bd80f48ba7c9f66a8e0f   # source
git fetch origin gh-pages && git checkout afe2047a9fca66d721ddcfe2eaf6d08d2c226c56  # published bundle
git archive --format=zip -o corresponding-source.zip f13a1624d111d235e804bd80f48ba7c9f66a8e0f
```

## Local patches

1. Neutral presentation: title `<title>`, header, noscript heading, splash and
   touch-warning copy, and nag header changed from the upstream product name to
   **City Simulator**; upstream author/build/source links and the mandatory
   verbatim trademark attribution are retained.
2. Site chrome: the shared `games/backbar-snippet.html` (styled ← Mspy1 · Games
   bar), the site theme bootstrap and the site favicon are inlined. No network
   request is introduced.
3. Privacy / no external runtime: the remote Google Fonts `@import` in
   `css/style.css` and the remote Twitter widget/loader (if present) are removed.
   Local `chunk.woff` and all local images are retained.
4. `src/micropolis.js`: two user-visible `WELCOME` strings changed to
   “Welcome to City Simulator”; localStorage namespace `micropolisJSGame`
   renamed to `citySimulatorGame`. No other game logic changed.
5. `CREDITS.html` added; `about.html` replaced with a short neutral pointer to
   it, while keeping the required verbatim courtesy attribution. A data-URI
   favicon link was added to the `<head>` of the verbatim `name_license.html`
   only to avoid a site-root `/favicon.ico` 404; the license text is untouched.

## Validation (headless Brave via Playwright CDP, 2026-11-23)

- `python -m http.server 8765 --bind 127.0.0.1 --directory <site-root>`;
  opened `http://127.0.0.1:8765/games/city-simulator/index.html` in Brave
  (`C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe`,
  `chromium.launch({ executablePath: BRAVE, headless: true })`).
- Images loaded with non-zero natural sizes: `tiles.png` 512×512,
  `tilessnow.png` 512×512, `sprites.png` 768×384; `dirtbg.png` and `chunk.woff`
  returned HTTP 200.
- Started a game (Testville / Easy), then selected Road and clicked the main
  canvas (`#MicropolisCanvas`) twice. Funds went from 20000 to 19980/19989 and
  the date advanced Jan → Feb 1900: real gameplay, not a static screenshot.
- Zero remote requests, zero failed requests, zero page errors, zero console
  messages. Verified `document.title === 'City Simulator'`, neutral header,
  presence of the themed back link to `/games/`, and the verbatim attribution.
- Also loaded `CREDITS.html`, `about.html` and `name_license.html` on the same
  nested path: all HTTP 200, no remote/failed requests, no page errors; each
  contains the verbatim attribution.
- Screenshot: `games/thumbs/city-simulator.png`, 1200×750, captured from the
  running game after road placement.
