# HyperRogue — vendored official web demo (12.1o)

- **Official demo page:** https://www.roguetemple.com/z/hyper/online.php
- **Binary sources (unmodified):** `https://www.roguetemple.com/z/hyper/hyper.js`
  and `https://www.roguetemple.com/z/hyper/hyper.wasm`, downloaded 2026-11-23.
- **Source pin:** zenorogue/hyperrogue tag `v12.1o` =
  `7dbb60d3f845545dead7c9b9dc25f653f55cc161`. `hyper.h` at that tag contains
  `#define VER "12.1o"`. `corresponding-source.zip` is a verbatim `git archive`
  of that tag (577 files, 81,190,822 bytes; no history, no `node_modules`).
- **License:** GNU GPL v2 or later. Copyright (C) 2011–2019 Zeno Rogue.
  Verbatim GPL v2 text is in `COPYING`; the source copyright/notice header is
  in `hyper.cpp` inside the source archive.
- **Status:** published offline copy of the official, freely redistributable
  web demo. Only the official no-cost demo binaries are shipped — no Steam,
  paid, or proprietary assets.

## Provenance / version match

The published demo page's HTTP `Last-Modified` is 2023-03-14, which is *not*
used as the version identifier. The shipped binaries are identified by embedded
strings:

- `hyper.wasm` SHA-256 `1E912503AB9D99F3C85035BF0D34DB9441881E93A5B48B44DAD4BCD02D1D5F15`,
  size 6,294,500 bytes. It contains the byte strings
  `HyperRogue version 12.1o`, `HyperRogue by Zeno Rogue <zeno@attnam.com>, version 12.1o`,
  `HyperRogue 12.1o`, `HyperRogue %1: online demo`, and
  `released under GNU General Public License version 2`.
- `hyper.js` SHA-256 `69407625B28C043A67363EFE665FF9C9C55CDC83FC25450AC77C1C3D536FC`,
  size 167,373 bytes; unmodified official build.
- Runtime console (headless Brave) prints:
  `HyperRogue by Zeno Rogue <zeno@attnam.com>, version 12.1o`,
  `released under GNU General Public License version 2 and thus`,
  `comes with absolutely no warranty; see COPYING for details`.

This establishes that the binaries are the official **12.1o online demo**,
matching the version-tagged source; it does **not** claim byte-for-byte
reproducibility with a local rebuild. See the build note below.

- `corresponding-source.zip` SHA-256
  `683FE73122034556D8157BE48442067A28989261B37E6B1F7087076B14469C19`.

## Files

- `index.html` — local offline wrapper (site chrome + Emscripten module setup
  derived from the official PHP page, with all trackers/social/external CSS
  removed). No code from `hyper.js`/`hyper.wasm` is modified.
- `hyper.js`, `hyper.wasm` — official demo binaries, byte-for-byte as downloaded.
- `COPYING` — verbatim GPL v2 from the pinned source.
- `corresponding-source.zip` — complete corresponding source at `v12.1o`.
- `../../thumbs/hyperrogue.png` — 1200×750 screenshot of actual gameplay after
  starting a game and moving the character.

## Local wrapper changes (no binary changes)

The official `online.php` loads a remote stylesheet, Cloudflare insights,
Facebook/Twitter/Digg/Reddit/Google widgets, a stale `hyper.html.mem` XHR
(404) and a third-party social footer. None of those are copied. The wrapper
keeps only the canvas, progress/status elements, console textarea, fullscreen
button and the Emscripten `Module` configuration needed by `hyper.js`, plus the
site's themed back bar, favicon, theme bootstrap and local legal/source links.
`hyper.html.mem` is intentionally not requested: the 12.1o WASM build loads
successfully without it (verified below).

## Build / rebuild instructions and attempted local build

Upstream's web target (from `Makefile` at the pinned tag) is:

```
git clone https://github.com/zenorogue/hyperrogue.git
git checkout v12.1o
# Host C++ tools are needed first to generate autohdr.h and language-data.cpp:
make makeh langen
./makeh classes.cpp locations.cpp colors.cpp hyperpoint.cpp geometry.cpp embeddings.cpp goldberg.cpp init.cpp floorshapes.cpp cell.cpp multi.cpp shmup.cpp pattern2.cpp mapeditor.cpp graph.cpp textures.cpp hprint.cpp language.cpp util.cpp complex.cpp multigame.cpp arbitrile.cpp rulegen.cpp *.cpp > autohdr.h
./langen > language-data.cpp
# Then the Emscripten target (Makefile: hyper.html / hyper.js / hyper.wasm):
emcc -std=c++11 -O3 -s USE_ZLIB=1 -s LEGACY_GL_EMULATION=1 -s TOTAL_MEMORY=128MB hyperweb.cpp -o hyper.html
```

A temporary, non-system Emscripten SDK (`emscripten-core/emsdk` 3.1.34,
`emcc 3.1.34 (57b21b8fdcbe3ebb523178b79465254668eab408)`) was installed under
the OS temp directory. The direct `emcc` invocation failed because the generated
files were absent:

```
emcc ... hyperweb.cpp -o hyper.html
  hyper.h:962:10: fatal error: 'autohdr.h' file not found
  EMCC_EXIT=1
```

Compiling `makeh.cpp` with `em++` produced a WASM binary that cannot run on the
Windows host (`makeh.exe ... is not compatible with the version of Windows
you're running`; `AUTOHDR=1`). A second `emcc` attempt with an empty `autohdr.h`
failed with `unknown type name 'monstertype'`, undeclared `motypes`, `ZERO` and
`CF_*` (`EMCC_EXIT=1`). No native C++ compiler (MSVC `cl.exe`/MinGW `g++`) is
available in this environment, so the host generator step could not be
completed. For that reason the **official binaries** are shipped, identified by
the embedded version strings and hashes above, together with complete source at
the matching tag. No future written offer is made; the source archive is
included with the files.

## Validation (headless Brave via Playwright CDP, 2026-11-23)

- Served the site root with
  `python -m http.server 8765 --bind 127.0.0.1 --directory <site-root>` and
  opened `http://127.0.0.1:8765/games/hyperrogue/index.html` in Brave
  (`chromium.launch({ executablePath: BRAVE, headless: true,
  args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'] })`).
- HTTP 200; document title became `HyperRogue 12.1o`; status cleared to empty
  (`All downloads complete`); canvas sized 1051×591.
- Network resources were exactly `hyper.js` and `hyper.wasm` (local). Zero
  remote requests, zero failed requests, zero page errors, and no `*.mem`
  request.
- Dismissed the start menu with "play the game", then pressed arrow keys. The
  rendered game changed (site-path run screenshot SHA-256 prefix
  `7ee96dfb108089be` → `ade5644243277195`) and showed the HyperRogue world
  (Icy Land, kills/score,
  character and monsters) — real gameplay, not a static image.
- Benign console output from the unmodified upstream binary in this headless
  environment: a Chromium "Permissions policy violation: unload is not allowed"
  message, WebGL `INVALID_ENUM` warnings from the legacy GL emulation, and GPU
  stall warnings from SwiftShader `ReadPixels`. No JS exceptions or asset
  failures occurred.
- Largest shipped file is `corresponding-source.zip` at 81,190,822 bytes
  (<100 MB); `hyper.wasm` is 6,294,500 bytes.
