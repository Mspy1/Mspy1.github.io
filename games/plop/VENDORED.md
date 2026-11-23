# PLOP

Official project: https://github.com/Caltrop256/plop
Commit: `e4c82e4e9cd9bff54314a7d5b2857c68baccffbd`.
The checked-in official build/ distribution was copied verbatim (including
sim.wasm and glue.min.js); no compiler or executable was installed.

Complete corresponding source is in source/src/, with verbatim GPL-3.0
LICENSE, upstream README and makefile in source/. PLOP by Caltrop256 is
distributed under GPL-3.0; retain its notices and offer this corresponding
source with any redistributed build. Pako 2.0.4 is MIT AND Zlib; its original
header and full PAKO-LICENSE are retained. C allocator source retains its
upstream notices. Logo, favicon, default scene and glyphs come exclusively
from the same GPL project.

Rebuild: on a POSIX system install clang with wasm32 support, GNU make and
uglifyjs, enter source/, create an empty build/ directory, then run `make`.
The makefile compiles all C source to build/sim.wasm, concatenates/minifies
the listed JavaScript sources, and copies src/static/ to build/.
Copy the resulting files beside this document to deploy; no runtime package
installation or external CDN is required.

Integration changes, 2026-11-23: original index.html is upstream-index.html
and play.html; the new index.html supplies the existing site backbar and a
same-origin, full remaining viewport iframe. This leaves upstream canvas
coordinate calculations, keyboard handling and save/import/export intact.
No simulation, input, WASM or bundled JavaScript changes. The thumbnail is
a 1200x750 local gameplay screenshot after painting sand.

Serve over HTTP with `.wasm` MIME type `application/wasm`.

Published-build verification (2026-11-23): downloaded
https://caltrop.dev/plop/sim.wasm and compared SHA-256 with the pinned
repository build; both are
`71ed1016cdc8f646687dae5825764b5d0df0c114f3ccef150262b5b8ef7d24e3`.

Local validation: Brave headless/CDP at 1200x750, HTTP nested route
`/games/plop/`; held the left mouse button in the simulation to paint sand
and observed the yellow pile interacting with the loaded scene. Zero
Runtime exceptions, failed requests, HTTP errors or external requests.
PLOP uses explicit file save/import/export rather than automatic reload
persistence; file-dialog save/import/export was not exercised in headless
validation. Full keyboard/mobile and every material were not exhaustively tested.
