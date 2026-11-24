# Findows focused browser checks (dev-only)

These checks are development tooling, not loaded by the site. They use a
locally installed Playwright package. If the package is outside this checkout,
set `FINDOWS_PLAYWRIGHT_MODULE` to its module path before running the tests.

1. Serve the worktree root on a unique port (example uses 8791):

   ```sh
   python -m http.server 8791 --bind 127.0.0.1 --directory .
   ```

2. Run the checks:

   ```sh
   node tests/findows/browser/smoke.mjs --base=http://127.0.0.1:8791 --out=.superpowers/sdd/2026-11-24-findows/evidence --browser=chromium
   ```

The script records screenshots in `--out` and exits non-zero on the first
failed assertion. Pass `--soft` to collect multiple assertion failures, or
`--browser=firefox` or `--browser=webkit` to exercise another installed
Playwright browser. Its compact checks simulate small/touch viewports, not a
physical phone. It does not target a public deployment unless you change `--base`.
