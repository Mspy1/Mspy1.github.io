# Space Huggers — local edition

Source: https://github.com/KilledByAPixel/SpaceHuggers
Revision: `c31a5aaa116842bed4b7385921eaef54dea9681d`
Vendored: 2026-11-23. Copyright 2021 Frank Force; GNU GPL v3.
See the complete upstream LICENSE and README.md.

Changes: added the Mspy1 return link to index.html. No gameplay changes.
The game, engine, tile artwork, icon and procedurally generated sound are
from this revision. Engine audio incorporates the author's ZzFX implementation;
upstream attribution is preserved in source and README.

Exclusions: Git history/metadata and promotional screenshot. No remote runtime
dependencies, online modes, analytics or streaming media are included.

## Complete corresponding source / running

The shipped app*.js, engine/*.js, tiles.png and index.html are the preferred
editable source and the runtime itself. No compilation is needed: serve this
directory using any static HTTP server. All paths are relative.
The original optional 13KB packaging scripts and instructions are retained in
engine/build/ and README.md; do not run setupBuild.bat merely to play.
This local edition and modifications are distributed under GNU GPL v3.
