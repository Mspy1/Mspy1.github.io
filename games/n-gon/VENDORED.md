# n-gon — historical local edition

Source: https://github.com/landgreen/n-gon
Revision: `f8b18c7772f8964386cad61260e1a7ffc726d48f` (commit date
2021-11-28, "affine connection"). Vendored 2026-11-23.
Ross Landgreen and contributors. GNU GPL v3; LICENSE was copied from
this exact historical revision, not from current HEAD.

This official historical revision was deliberately selected because newer
versions include remote third-party soundtrack/image dependencies, streaming
playlists and a code-import editor. None of those newer features/assets are
shipped here. The actual historical game is preserved, not reimplemented.

Changes: index.html removes Google Analytics and adds a return link;
js/index.js replaces network-fetched GitHub updates with a local revision
notice; js/tech.js disables the optional external YouTube music search.
The three library runtime files retain their upstream filenames but now use
readable official distributions (Matter 0.17.1, poly-decomp 0.2.1 browser build,
randomColor 0.6.1) rather than opaque minification, so exact runtime source is
available locally, including the poly-decomp browser wrapper.
Exclusions: Git history/metadata, .vscode, .DS_Store and developer todo list.

## Third-party code and assets

The historical lib/matter.min.js identifies Matter.js 0.17.1 by Liam Brummitt
(@liabru), MIT. lib/decomp.min.js is poly-decomp.js by Stefan Hedman, MIT.
lib/randomColor.min.js is randomColor by David Merfield, CC0-1.0.
Complete license texts are in licenses/. Unminified library sources are in
source/ (Matter 0.17.1, poly-decomp 0.2.1, randomColor 0.6.1). Their upstream
notices remain intact. All game visuals are locally rendered; no external
soundtracks, image packs or remotely loaded code are required.

## Complete corresponding source / running

All game js/*.js, style.css and index.html are editable source and execute
directly without compilation. Serve this directory with any static HTTP server
at /games/n-gon/. Library source is provided alongside the upstream bundled
runtime. The lib/ files themselves are readable complete corresponding source;
no library build is required. This local edition's game modifications are GNU GPL v3.
