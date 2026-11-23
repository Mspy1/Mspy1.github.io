# shapez — vendored original browser demo

This directory contains the **official original shapez browser demo** (tobspr
Games), self-hosted under `/games/shapez/`. It is not the Community Edition,
not the desktop/Steam build, and not shapez 2.

## Pin / provenance

| Item | Value |
| --- | --- |
| Upstream | `https://github.com/tobspr-games/shapez.io` |
| Commit | `8a79de5255fb6756f3a1d26579b1e9bc36e0c811` (official HEAD, release 1.5.7) |
| Official demo | `https://shapez.io/` — verified to embed `/v/8a79de52/bundle.js` and `/v/8a79de52/main.css` at this exact commit |
| Assets | fetched only from the official `https://shapez.io/v/8a79de52/` static path, plus the matching upstream source at the pin |
| Bundle SRI | `sha256-mNKPf1/lebdrakwoUsPDf7rUAS/qkFwRrLfgq9Nnha0=` (recomputed after the local patch; embedded in `game.html`) |

No third-party mirror, no CE/desktop build, and no npm install on the host were
used. The temporary build workspace was removed from the published site; only
the files documented here are public.

## License / corresponding source

The upstream repository is licensed **GPL-3.0** (`LICENSE`, copied verbatim
here). Its `CONTRIBUTING.md` contains a Contributor License Agreement requiring
contributions to be incorporated under GPL-3 and requiring contributors to
confirm originality or disclose third-party restrictions. No `NOTICE`, per-file
license header, or exclusion list exists anywhere in the repository. The atlas,
UI art and font binaries are committed directly in that GPL-3 repository.

GitHub's commit history confirms traceable original authorship for the shipped
art: the font, UI art and atlas sources were committed by the original author
(`tobspr`) with messages such as `Minor artwork update`, `v1.5.2` and
`Minor adjustments to atlas padding`.

`source/shapez-8a79de52-src.zip` is the **complete corresponding source** for
the unmodified upstream program: the full source tree at the pin (`src/`,
`gulp/`, `res/`, `res_raw/`, `translations/`, build config, `yarn.lock`), minus
only the deliberately omitted audio and font (below). `source/REPRODUCE.md`
and `source/reproduce/patch-bundle.cjs` document and perform the exact,
mechanical transformation from the official prebuilt bundle to the shipped
bundle. The whole archive is ~29 MB; no single file exceeds 100 MB.

## Residual provenance risk (documented, not asserted away)

- The upstream README points to a separate artwork repository for "most
  assets". That repository could not be reached/verified during this audit.
  We rely on the GPL-3 root license, the CLA, in-repo commitment and traceable
  authorship for the bundled **atlas/UI art**; this residual ambiguity is
  recorded here rather than ignored.
- `GameFont.woff2` is included upstream but is Brotli-compressed with no
  readable license/copyright metadata. Its origin could not be verified, so it
  is **not shipped**: `game.html` maps `GameFont` to a local system UI font.
- The music (`theme-full`, `menu`, `puzzle-full`, `theme-short`) is committed
  upstream but the soundtrack is sold separately, so no redistribution grant
  is assumed. **All music and all SFX are omitted**; the shipped bundle's audio
  loaders resolve immediately, so the demo runs in silence.

## Local modifications (all in `source/REPRODUCE.md`)

1. `/v/8a79de52/` → `/games/shapez/v/8a79de52/` (single blob-loader literal) so
   all same-origin asset paths work from the nested Pages route.
2. Audio loaders silenced; music and SFX files not shipped.
3. Google-Analytics shims and every external network entry point (player count,
   ad check, discounts, analytics register/events, AB variant, campaign notes)
   replaced with no-ops. No external request is attempted at runtime.
4. A restrictive CSP in `game.html` allows only same-origin, `blob:` and `data:`
   resources; it is a second layer on top of (3).
5. `index.html` adds the site's existing themed `← Mspy1 · Games` return bar in
   a reserved 48 px strip above a viewport-filling same-origin iframe that runs
   the unmodified demo UI.

## Credits

- shapez © tobspr Games — `https://tobspr.io`, `https://github.com/tobspr-games/shapez.io`
- Original code and in-repo art: GPL-3.0 (see `LICENSE`).
- No third-party font, music or SFX is redistributed here.
