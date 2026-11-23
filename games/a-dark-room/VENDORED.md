# A Dark Room — local edition

Source: https://github.com/doublespeakgames/adarkroom
Revision: `1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7`
Vendored: 2026-11-23. Michael Townsend / doublespeak games and contributors.
Upstream's MPL-2.0 is retained in full in LICENSE.md.

Changes to index.html: use the bundled jQuery rather than the Google CDN;
remove Google Analytics; add the Mspy1 return link. Gameplay, local saves,
translations and bundled audio are preserved.

The upstream audio/, img/, css/, lang/ and script/ files are distributed under
the repository license, with their original notices intact. No separately
licensed external music, remote artwork or online save service is added.
Unused script/dropbox.js is excluded, as are Git metadata/history.

Third-party notices: jQuery 1.10.1 and jQuery Color 2.1.2 are MIT
(licenses/jquery.txt and embedded headers); jquery.event.move by Stephen Band
and jquery.event.swipe by Stephen Band are WTFPL, with upstream package license
declarations retained under licenses/ and full text in licenses/WTFPL.txt.
Base64 retains its webtoolkit.info attribution. Translation helpers and all
remaining upstream files retain their repository notices.

## Source and running

The editable JavaScript, CSS, HTML, translations and assets are shipped directly,
including the changed index.html (MPL-2.0). No compilation is required.
Serve this folder under /games/a-dark-room/ using any static HTTP server.
README.md, contributing.md, doc/, tools/, package.json and development server
source are retained for development; no dependency install is needed to play.
