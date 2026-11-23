# Pickup Football Teams — vendored copy

- **Source:** https://github.com/anilcanpolat/pickup-football-teams (author: Anilcan Polat)
- **Pinned commit:** `3bc6548a88319a1f8b32eb97d969609b208799ca` (default-branch
  HEAD as returned by `git ls-remote` when this file was written, 2026-11-23)
- **Vendored on:** 2026-11-22; back bar added 2026-11-23
- **License:** **none**. The upstream repository has no LICENSE file. This is a
  permission-based copy, **not** an MIT-licensed snapshot. See `LICENSE`.

## Files

- `index.html` — the merged app: upstream `web/index.html` plus the on-pitch
  scoreboard / kit UI from the deployed site, with the sync backend replaced by
  `localStorage` (see below).
- `football.ico` — favicon copied from upstream `web/football.ico`.
- `LICENSE` — a statement of the actual permission-based situation, not an
  upstream license text (no such text exists).
- `VENDORED.md` — this file.

## Local changes — game behaviour WAS modified

Unlike the other vendored games, this is **not** a verbatim, logic-untouched
snapshot. Known changes relative to upstream `web/index.html`:

1. **Backend replaced with `localStorage`.** GitHub Pages is static, so the
   upstream Python `api/server.py` sync API cannot run. The `scheduleSync`,
   `pushNow` and `pullFromServer` network calls were removed and state
   (`football-balancer-v1`) is persisted to `localStorage` unconditionally,
   including in guest mode (the guest wipe was removed). Name "sign-in" now
   selects or creates a local profile rather than calling a server, and the
   save-status indicator reports local saves only. The `sanitize`/`defaults`
   logic and the `football-lang` / `football-welcome-seen` keys were retained.
2. **Deployed-only UI ported in.** The on-pitch scoreboard, eight kit colours and
   sticky header from the live site were carried over to match what the user saw.
   Repo-only features (saved results/history, form-adjusted strength,
   avoid-repeat pairing) remain in the code but are not surfaced in the UI.
3. **Third-party host scripts removed.** The Cloudflare beacon/scripts injected
   only on the original host were not carried over. No external CSS, JS, fonts,
   CDNs or analytics; system fonts only, and no requests to `/football/api/*`.
4. **Back bar (2026-11-23).** A site-styled `← Mspy1 · Games` bar linking to
   `/games/` was injected immediately after the opening `<body>` tag, using the
   same inline token/style pattern as the other game pages.
5. **Head theme bootstrap.** An inline script before paint sets
   `data-theme`/`data-site-theme` from `localStorage.site-theme` (defaulting to
   `dark` when no choice is stored, while a stored `system` still resolves via
   the system `prefers-color-scheme`).

The app title on the back bar is `Pickup Football Teams`; the page is linked from
the Games hub at `/games/` but its files are served from `/football/`.
