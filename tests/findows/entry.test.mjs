/* Gate 0/1: static contract for the homepage launcher and the Findows route.
   Written before implementation so the feature's absence is provable. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const home = readFileSync(resolve(ROOT, "index.html"), "utf8");
const footer = home.slice(home.indexOf("<footer"), home.indexOf("</footer>"));

test("homepage footer contains a real, accessible Findows launcher", () => {
  const tag = footer.match(/<a\b[^>]*id="findows-easter-egg"[^>]*>/);
  assert.ok(tag, "missing #findows-easter-egg link inside the homepage footer");
  assert.match(tag[0], /href="\/findows\/"/, "launcher must use a real same-tab route");
  assert.match(tag[0], /aria-label="[^"]+"/, "launcher needs a localized accessible name");
  assert.match(tag[0], /data-i18n-aria="findows_launcher"/, "accessible name must be translatable");
  const start = footer.indexOf(tag[0]);
  const anchorBlock = footer.slice(start, footer.indexOf("</a>", start) + 4);
  assert.match(
    anchorBlock,
    /<span[^>]*aria-hidden="true"[^>]*>\s*🖥️/,
    "the glyph must be hidden from assistive technology",
  );
});

test("homepage launcher has a 44px hit target and a visible focus ring", () => {
  const rule = home.match(/#findows-easter-egg\s*\{([^}]*)\}/);
  assert.ok(rule, "missing scoped launcher CSS rule");
  assert.match(rule[1], /44px/, "hit target must be at least 44×44px");
  assert.match(
    home,
    /#findows-easter-egg:focus-visible\s*\{[^}]*(outline|box-shadow)/,
    "launcher needs a visible keyboard focus ring",
  );
});

test("homepage i18n updates the launcher accessible name in EN/TR/DE", () => {
  assert.match(home, /\$\$\("\[data-i18n-aria\]"\)/, "the i18n pass must collect aria-label targets");
  assert.match(home, /setAttribute\("aria-label",t\[k\]\)/, "apply() must localize aria labels");
  assert.match(home, /findows_launcher\s*:/, "a launcher label key must exist");
  const trBlock = home.slice(home.indexOf("tr:{"), home.indexOf("de:{"));
  const deBlock = home.slice(home.indexOf("de:{"), home.indexOf("genz:{"));
  assert.match(trBlock, /findows_launcher\s*:/, "Turkish launcher label missing");
  assert.match(deBlock, /findows_launcher\s*:/, "German launcher label missing");
  assert.notEqual(
    (trBlock.match(/findows_launcher\s*:\s*"([^"]+)"/) || [])[1],
    (deBlock.match(/findows_launcher\s*:\s*"([^"]+)"/) || [])[1],
    "TR and DE labels should be genuinely localized",
  );
});

test("explicit return focuses the launcher without forcing an animation", () => {
  assert.match(
    home,
    /location\.hash\s*===\s*"#findows-easter-egg"/,
    "homepage must detect an explicit return navigation",
  );
  assert.match(home, /findows-easter-egg[^\n]*\.focus\(|getElementById\("findows-easter-egg"\)[^\n]*\.focus\(/, "homepage must focus the launcher on return");
});

test("homepage does not preload or request any Findows code or assets", () => {
  const occurrences = home.split("/findows/").length - 1;
  assert.equal(occurrences, 1, "the only /findows/ reference on the homepage is the launcher href");
  assert.ok(!/<link\b[^>]*findows/i.test(home), "no Findows stylesheet/preload on the homepage");
  assert.ok(!/<script\b[^>]*findows/i.test(home), "no Findows script on the homepage");
});

test("Findows route exists, is unindexed, self-contained and has a working exit", () => {
  const path = resolve(ROOT, "findows", "index.html");
  assert.ok(existsSync(path), "missing findows/index.html route");
  const page = readFileSync(path, "utf8");
  assert.match(page, /<meta\s+name="robots"\s+content="[^"]*noindex/i, "route must carry noindex");
  assert.match(page, /href="\/#findows-easter-egg"/, "persistent Back to Mspy1 link missing");
  assert.match(page, /<noscript\b[\s\S]*<\/noscript>/, "JavaScript-off explanation missing");
  assert.ok(!/<(script|link|img)\b[^>]+https?:\/\//i.test(page), "route must not depend on remote assets");
  const brandAt = page.indexOf("Findows");
  const moduleAt = page.indexOf('type="module"');
  assert.ok(brandAt >= 0 && moduleAt >= 0 && brandAt < moduleAt, "brand/exit markup must render before module bootstrap");
});

test("Calculator CSS and icon are wired; no dev fixture plumbing remains", () => {
  const page = readFileSync(resolve(ROOT, "findows", "index.html"), "utf8");
  assert.match(page, /href="styles\/calculator\.css"/, "Calculator CSS must be loaded on the desktop route");
  const main = readFileSync(resolve(ROOT, "findows", "js", "main.mjs"), "utf8");
  const shell = readFileSync(resolve(ROOT, "findows", "js", "shell.mjs"), "utf8");
  for (const [name, source] of [["main.mjs", main], ["shell.mjs", shell]]) {
    assert.ok(!/dev-fixture|devEnabled|dev-mode/i.test(source), `${name} still carries development-fixture plumbing`);
  }
  assert.ok(
    existsSync(resolve(ROOT, "findows", "assets", "icon-calculator.svg")),
    "icon-clock lane's calculator icon must exist at its published path",
  );
});

test("sitemap and Games hub stay untouched by the Easter egg", () => {
  const sitemap = readFileSync(resolve(ROOT, "sitemap.xml"), "utf8");
  assert.ok(!/findows/i.test(sitemap), "Findows must not be indexed as a site route");
  const hub = readFileSync(resolve(ROOT, "games", "index.html"), "utf8");
  assert.ok(!/findows/i.test(hub), "Findows must not be promoted in the Games hub");
});

/* Footer launcher discoverability lane: sighted users get a hover title and a
   subtle first-run hint, both localized in EN/TR/DE, with no new requests. */
test("launcher carries a localized title via a targeted i18n extension", () => {
  const tag = footer.match(/<a\b[^>]*id="findows-easter-egg"[^>]*>/);
  assert.ok(tag, "missing launcher tag");
  assert.match(tag[0], /title="[^"]+"/, "launcher needs a hover title for sighted users");
  assert.match(tag[0], /data-i18n-title="findows_launcher_title"/, "title must be translatable");
  assert.match(home, /\$\$\("\[data-i18n-title\]"\)/, "i18n must collect title targets");
  assert.match(home, /setAttribute\("title",t\[k\]\)/, "apply() must localize title attributes");
  const trBlock = home.slice(home.indexOf("tr:{"), home.indexOf("de:{"));
  const deBlock = home.slice(home.indexOf("de:{"), home.indexOf("genz:{"));
  assert.match(trBlock, /findows_launcher_title\s*:/, "Turkish launcher title missing");
  assert.match(deBlock, /findows_launcher_title\s*:/, "German launcher title missing");
  const en = (tag[0].match(/title="([^"]+)"/) || [])[1];
  const tr = (trBlock.match(/findows_launcher_title\s*:\s*"([^"]+)"/) || [])[1];
  const de = (deBlock.match(/findows_launcher_title\s*:\s*"([^"]+)"/) || [])[1];
  assert.ok(en && tr && de, "launcher title must exist in EN/TR/DE");
  assert.equal(new Set([en, tr, de]).size, 3, "launcher titles must be genuinely localized");
});

test("footer shows a subtle, localized first-run hint (never a nav item)", () => {
  const hint = footer.match(/<span\b[^>]*id="findows-hint"[^>]*>/);
  assert.ok(hint, "missing #findows-hint in footer");
  assert.match(footer, /data-i18n="findows_hint"/, "hint text must reuse the text i18n key");
  assert.ok(!/<a\b[^>]*findows-hint/i.test(footer), "hint must not be a link / nav item");
  assert.match(home, /#findows-hint\s*\{[^}]*font-size\s*:\s*1[01]px/, "hint must be visually subtle");
  assert.match(home, /#findows-hint\s*\{[^}]*opacity\s*:\s*\.?[0-5]/, "hint must be low-contrast");
  assert.match(home, /findows-hint-seen/, "hint must retire once the desktop has been opened");
  const trBlock = home.slice(home.indexOf("tr:{"), home.indexOf("de:{"));
  const deBlock = home.slice(home.indexOf("de:{"), home.indexOf("genz:{"));
  assert.match(trBlock, /findows_hint\s*:/, "Turkish hint missing");
  assert.match(deBlock, /findows_hint\s*:/, "German hint missing");
  const en = (footer.match(/data-i18n="findows_hint"[^>]*>([^<]+)/) || [])[1];
  const tr = (trBlock.match(/findows_hint\s*:\s*"([^"]+)"/) || [])[1];
  const de = (deBlock.match(/findows_hint\s*:\s*"([^"]+)"/) || [])[1];
  assert.ok(en && tr && de, "hint must exist in EN/TR/DE");
  assert.equal(new Set([en.trim(), tr, de]).size, 3, "hints must be genuinely localized");
});
