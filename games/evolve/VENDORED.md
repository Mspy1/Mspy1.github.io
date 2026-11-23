# Evolve Idle

Official source and published build: https://github.com/pmotschmann/Evolve
Commit: `3436358dcd03d9f9e071d51ea071e0a78c0322e4` (master).
The official repository has no gh-pages branch; its checked-in evolve/ and
wiki/ files are the published static distribution. These files were copied
verbatim, not rebuilt. Full corresponding source, build scripts, package lock,
translations, assets and MPL-2.0 LICENSE are supplied alongside the build.

Build from this directory with the documented upstream Node toolchain:
`npm ci`, then `npm run build-win` (Windows) or `npm run build`.
Build dependencies are not shipped or required to play.

Integration changes, 2026-11-23: index.html is a site backbar plus a same-origin
iframe, preserving game viewport/input/scroll behavior. play.html derives from
the upstream index: Google Analytics and remote Google font removed; six CDN
libraries replaced by local copies of the exact versions and SHA-384 values
specified by upstream. No gameplay logic changes. Browser saves retain the
upstream localStorage key `evolved`. Original entry is upstream-index.html.txt.
The bundled wiki.html and save.html likewise have analytics removed and
their remote dependencies localized.

Third-party rights: local jQuery 3.6.3, Vue 2.7.14, Buefy 0.9.22, Popper
2.9.2, SortableJS 1.10.2 and Chart.js 3.8.2 are MIT licensed, with verbatim
licenses in third-party/. lz-string is MIT (Pieroxy); Weather Icons font is
SIL OFL 1.1 and CSS is MIT (Erik Flowers), as recorded in their CSS header
and third-party notices. Original bundled library headers are retained.
Other upstream bundled tools retained for corresponding-source completeness:
CryptoJS (MIT), Less (Apache-2.0), html5sortable (MIT); their licenses are
also supplied in third-party/. No Lato font files are distributed.
Game images, translations and source are distributed as part of the upstream
MPL-2.0 project; no unrelated artwork or remotely hosted font is introduced.
The thumbnail is a local 1200x750 screenshot of actual gameplay.

Serve this directory over HTTP; no build or external service is needed.

Published-build verification (2026-11-23): downloaded
https://pmotschmann.github.io/Evolve/evolve/main.js and compared SHA-256 with
the pinned source repository's evolve/main.js; both are
`29a17b7eeb7042d772131f88124a525a56b3fb5b36e32e2d53f78f49d77ca9db`.

Local validation: Brave headless/CDP, 1200x750, HTTP nested route
`/games/evolve/`; clicked RNA 25 times, waited for autosave, reloaded,
confirmed 25 RNA retained (second run retained and increased to 50).
Zero Runtime exceptions, failed requests, HTTP errors or external requests
in this flow. Wiki/save and late-game paths were not exhaustively played.
