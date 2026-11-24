/* Focused Character Map UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/character-map-browser.mjs [--port=8858] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8858 and mounts the production module in a
   minimal harness with an injectable clipboard double. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8858"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const PLAYWRIGHT = arg("playwright", "") || process.env.FINDOWS_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || undefined;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright(PLAYWRIGHT);

/* Static contract checks run first: a missing app, icon or unscoped CSS is red. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/character-map.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/character-map.css"), "utf8");
const iconSource = readFileSync(resolve(ROOT, "findows/assets/icon-character-map.svg"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("character-map.mjs must export async function mount()");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("character-map.mjs must not register window/document listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("character-map.mjs must not use markup injection or dynamic code");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".cm-") && !line.startsWith("@"));
if (badSelectors.length) {
  throw new Error(`character-map.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
if (/https?:\/\/|url\(/i.test(cssSource.replace(/url\(\s*["']?#/g, ""))) {
  throw new Error("character-map.css must not fetch remote assets");
}
if (!/^<svg[\s>]/i.test(iconSource.trim()) || /<(script|image|foreignObject)\b|on[a-z]+\s*=/i.test(iconSource)) {
  throw new Error("icon-character-map.svg must be an original static vector with no active content");
}
console.log("static checks: mount export, no global listeners, no markup/eval, app-scoped CSS, inert icon PASS");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const HARNESS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Character Map UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/character-map.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{padding:12px}
  .harness-host{width:min(860px,calc(100vw - 24px));height:min(600px,calc(100vh - 84px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden;background:#101626}
  @media (max-width:600px),(max-height:499px){
    .harness-host{width:calc(100vw - 20px);height:min(620px,calc(100vh - 84px))}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar"><button id="outside" type="button">Outside control</button><span>Focus here to prove keys are scoped</span></div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { mount } from "/findows/js/apps/character-map.mjs";

  /* A deterministic clipboard double. No real permissions or OS clipboard. */
  window.__cmCopyCalls = [];
  window.__cmClipboardMode = "success";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    get() {
      if (window.__cmClipboardMode === "missing") return undefined;
      const mode = window.__cmClipboardMode;
      return {
        writeText(text) {
          window.__cmCopyCalls.push(text);
          if (mode === "reject") return Promise.reject(new Error("Permission denied"));
          return Promise.resolve();
        },
      };
    },
  });
  window.__cmSetClipboardMode = (mode) => { window.__cmClipboardMode = mode; };

  const controller = new AbortController();
  window.__cmAbort = controller;
  window.__cmHandle = await mount({
    container: document.getElementById("app"),
    windowId: "character-map-ui-test",
    fileId: null,
    services: {},
    signal: controller.signal,
  });
  window.__cmReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__character-map-ui-harness.html") {
      response.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
      response.end(HARNESS_HTML);
      return;
    }
    const target = resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    const body = readFileSync(target);
    response.writeHead(200, {
      "content-type": MIME[extname(target).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});

await new Promise((ready, fail) => {
  server.once("error", fail);
  server.listen(PORT, "127.0.0.1", ready);
});
const BASE = `http://127.0.0.1:${PORT}`;
console.log(`character-map UI harness serving ${ROOT} at ${BASE}`);

let step = 0;
const log = (message) => console.log(`[${String(++step).padStart(2, "0")}] ${message}`);
const ok = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`      PASS ${message}`);
};
const shot = (page, name) => page.screenshot({ path: resolve(OUT, name), fullPage: false });

const consoleErrors = [];
const badResponses = [];
const requests = [];
function watch(page) {
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => requests.push(request.url()));
}

async function openHarness(page) {
  await page.goto(`${BASE}/__character-map-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__cmReady === true, null, { timeout: 8000 });
}
const searchText = (page) => page.locator(".cm-search").inputValue();
const statusText = (page) => page.locator(".cm-status").innerText();
const detailCode = (page) => page.locator(".cm-detail-code").innerText();
const insideDetail = (page, selector) => page.evaluate((sel) => {
  const node = document.querySelector(sel);
  const panel = node?.closest(".cm-detail");
  if (!node || !panel) return false;
  const item = node.getBoundingClientRect();
  const area = panel.getBoundingClientRect();
  return item.top >= area.top - 1 && item.bottom <= area.bottom + 1;
}, selector);
const insideGrid = (page) => page.evaluate(() => {
  const node = document.querySelector(".cm-glyph");
  const grid = document.querySelector(".cm-grid");
  if (!node || !grid) return false;
  const item = node.getBoundingClientRect();
  const area = grid.getBoundingClientRect();
  return item.top >= area.top - 1 && item.bottom <= area.bottom + 1 && item.height >= 40;
});

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, scoped surface and block grid");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__cmHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  const rootAttrs = await page.locator(".cm-app").evaluate((node) => ({
    label: node.getAttribute("aria-label"), role: node.getAttribute("role"),
    windowId: node.dataset.windowId,
  }));
  ok(rootAttrs.label === "Character Map" && rootAttrs.role === "group" &&
     rootAttrs.windowId === "character-map-ui-test",
    `root is a labelled group with data-window-id (${JSON.stringify(rootAttrs)})`);
  const blockCount = await page.locator(".cm-block option").count();
  ok(blockCount >= 12, `block picker offers ${blockCount} Unicode blocks`);
  ok((await page.locator(".cm-block").inputValue()) === "basic-latin", "Basic Latin is the default block");
  const initialGlyphs = await page.locator(".cm-glyph").count();
  ok(initialGlyphs > 40, `grid renders the block's glyphs as buttons (${initialGlyphs})`);
  const firstGlyph = await page.locator(".cm-glyph").first().evaluate((node) => ({
    code: node.dataset.code, label: node.getAttribute("aria-label"), text: node.textContent, tag: node.tagName.toLowerCase(),
  }));
  ok(firstGlyph.tag === "button" && firstGlyph.code === "U+0021" && firstGlyph.label.includes("EXCLAMATION MARK") &&
     firstGlyph.text === "!", `glyph buttons are labelled native buttons (${JSON.stringify(firstGlyph)})`);
  ok((await page.locator(".cm-block-meta").innerText()).includes("U+0021"), "block metadata shows its range");
  ok(!(await page.locator(".cm-detail-body").isVisible()) && await page.locator(".cm-detail-empty").isVisible(),
    "empty detail hides the code/copy controls instead of showing blank fields");
  await shot(page, "character-map-desktop-dark.png");

  log("block switching and empty/inert search states");
  await page.locator(".cm-block").selectOption("emoticons");
  ok((await page.locator(".cm-glyph[data-code='U+1F600']").count()) === 1,
    "switching to Emoticons renders the grinning face glyph");
  ok((await page.locator(".cm-result-label").innerText()).includes("Emoticons"), "result label names the selected block");
  await page.locator(".cm-search").fill("<img src=x onerror=alert(1)>");
  ok((await page.locator(".cm-glyph").count()) === 0, "markup-like query matches no glyph");
  ok((await page.locator(".cm-empty").isVisible()) && (await statusText(page)).includes("No matches"),
    "no-match state is visible and announced without claiming results");
  ok((await page.locator(".cm-app img, .cm-app script, .cm-app iframe, .cm-app a, .cm-app object").count()) === 0,
    "no active elements are created from a hostile query");
  const requestsBefore = requests.length;
  await page.waitForTimeout(120);
  ok(requests.length === requestsBefore, "hostile query fires no network request");
  await page.locator(".cm-clear-search").click();
  ok((await searchText(page)) === "" && (await page.locator(".cm-glyph").count()) > 0,
    "Clear search restores the block grid");

  log("search by name, U+ code, decimal and literal glyph");
  await page.locator(".cm-search").fill("grinning");
  ok((await page.locator(".cm-glyph[data-code='U+1F600']").count()) === 1,
    "name search finds GRINNING FACE");
  await page.locator(".cm-search").fill("U+03B1");
  ok((await page.locator(".cm-glyph[data-code='U+03B1']").count()) === 1,
    "U+ notation finds GREEK SMALL LETTER ALPHA");
  await page.locator(".cm-search").fill("128512");
  ok((await page.locator(".cm-glyph[data-code='U+1F600']").count()) === 1,
    "decimal codepoint finds the same glyph");
  await page.locator(".cm-search").fill("α");
  ok((await page.locator(".cm-glyph[data-code='U+03B1']").count()) === 1,
    "typing the glyph itself finds it");
  await shot(page, "character-map-search.png");
  await page.locator(".cm-clear-search").click();
  await page.locator(".cm-block").selectOption("emoticons");

  log("selection detail and truthful clipboard success");
  await page.locator(".cm-glyph[data-code='U+1F600']").click();
  ok((await detailCode(page)) === "U+1F600", "clicking a glyph shows its U+ code");
  ok((await page.locator(".cm-detail-name").innerText()) === "GRINNING FACE", "detail shows the plain-text glyph name");
  ok((await page.locator(".cm-detail-glyph").innerText()) === "\u{1F600}", "detail shows the glyph itself as text");
  ok((await page.locator(".cm-detail-decimal").innerText()) === "128512", "detail shows the decimal codepoint");
  ok((await page.locator(".cm-glyph[data-code='U+1F600']").getAttribute("aria-pressed")) === "true",
    "selected glyph exposes aria-pressed");
  ok(await page.locator(".cm-detail-body").isVisible() && !(await page.locator(".cm-detail-empty").isVisible()),
    "selection reveals the code and copy controls");
  await page.locator(".cm-copy-code").click();
  await page.waitForFunction(() => document.querySelector(".cm-status")?.textContent.includes("Copied"), null, { timeout: 3000 });
  ok((await page.evaluate(() => window.__cmCopyCalls.at(-1))) === "U+1F600",
    "copy writes the exact U+ code through the clipboard API");
  ok((await statusText(page)).includes("U+1F600"), "success status names what was copied");
  await shot(page, "character-map-copy-success.png");

  log("truthful fallback when clipboard rejects or is unavailable");
  await page.evaluate(() => window.__cmSetClipboardMode("reject"));
  const beforeRejectCalls = await page.evaluate(() => window.__cmCopyCalls.length);
  await page.locator(".cm-copy-code").click();
  await page.waitForFunction(() => document.querySelector(".cm-status")?.textContent.includes("unavailable"), null, { timeout: 3000 });
  const rejected = await page.evaluate(() => ({
    status: document.querySelector(".cm-status").textContent,
    calls: window.__cmCopyCalls.length,
    field: document.querySelector(".cm-code-field").value,
    focused: document.activeElement === document.querySelector(".cm-code-field"),
    selected: document.querySelector(".cm-code-field").selectionEnd > document.querySelector(".cm-code-field").selectionStart,
  }));
  ok(!rejected.status.includes("Copied") && rejected.status.includes("selected") && rejected.focused && rejected.selected,
    `rejected clipboard says unavailable and leaves text selected (${rejected.status})`);
  ok(rejected.calls === beforeRejectCalls + 1 && rejected.field === "U+1F600",
    "the failed attempt is disclosed, not silently retried or faked");
  await shot(page, "character-map-copy-fallback.png");
  await page.evaluate(() => window.__cmSetClipboardMode("missing"));
  await page.locator(".cm-copy-code").click();
  await page.waitForFunction(() => document.querySelector(".cm-status")?.textContent.includes("unavailable"), null, { timeout: 3000 });
  ok(!(await statusText(page)).includes("Copied"), "missing clipboard never reports a successful copy");
  await page.evaluate(() => window.__cmSetClipboardMode("success"));

  log("keyboard: roving arrows, Home/End, native Enter and scoped events");
  // The previous Clear already emptied the field; changing the block also clears it.
  await page.locator(".cm-block").selectOption("arrows");
  await page.locator(".cm-glyph").first().focus();
  await page.keyboard.press("ArrowRight");
  ok(await page.evaluate(() => document.activeElement?.dataset.code === "U+2191"),
    "ArrowRight moves focus to the next glyph");
  await page.keyboard.press("End");
  ok(await page.evaluate(() => document.activeElement?.dataset.code?.startsWith("U+21")),
    "End moves focus to the last glyph in the block");
  await page.keyboard.press("Home");
  ok(await page.evaluate(() => document.activeElement?.dataset.code === "U+2190"),
    "Home returns focus to the first glyph");
  await page.keyboard.press("Enter");
  ok((await detailCode(page)) === "U+2190", "Enter selects the focused glyph once through native button activation");
  const passive = await page.evaluate(() => {
    const root = document.querySelector(".cm-app");
    root.focus();
    const fire = (init) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      root.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return {
      tab: fire({ key: "Tab" }),
      ctrl: fire({ key: "a", ctrlKey: true }),
      alt: fire({ key: "ArrowRight", altKey: true }),
      ime: fire({ key: "a", isComposing: true }),
      plain: fire({ key: "q" }),
    };
  });
  ok(!passive.tab && !passive.ctrl && !passive.alt && !passive.ime && !passive.plain,
    `Tab, modifier chords, IME and plain letters are never intercepted (${JSON.stringify(passive)})`);
  const detailBefore = await detailCode(page);
  await page.locator("#outside").focus();
  await page.keyboard.type("ArrowLeft");
  ok((await detailCode(page)) === detailBefore, "typing outside the app cannot change the selection");
  await page.evaluate(() => window.__cmHandle.focus());
  ok(await page.evaluate(() => document.activeElement?.classList.contains("cm-search")),
    "handle.focus() returns focus to the search field");
  await shot(page, "character-map-keyboard.png");

  log("light theme, compact 390x844 and short landscape 844x390");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(200);
  await shot(page, "character-map-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  ok(await mp.locator(".cm-search").isVisible() && await mp.locator(".cm-grid").isVisible() &&
     await mp.locator(".cm-detail").isVisible(),
    "compact layout keeps search, grid and detail reachable");
  const sizes = await mp.locator(".cm-glyph").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return Math.min(rect.width, rect.height);
    }));
  ok(sizes.every((size) => size >= 40), `compact glyph targets are at least 40px (min ${Math.min(...sizes).toFixed(1)})`);
  await mp.locator(".cm-block").selectOption("emoticons");
  await mp.tap(".cm-glyph[data-code='U+1F600']");
  ok((await detailCode(mp)) === "U+1F600", "touch tap selects a glyph");
  ok(await insideDetail(mp, ".cm-detail-glyph") && await insideDetail(mp, ".cm-copy-code"),
    "compact detail keeps the glyph and copy button inside the visible panel");
  await mp.tap(".cm-copy-code");
  await mp.waitForFunction(() => document.querySelector(".cm-status")?.textContent.includes("Copied"), null, { timeout: 3000 });
  ok((await statusText(mp)).includes("U+1F600"), "touch copy reports the truthful success status");
  await shot(mp, "character-map-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator(".cm-search").isVisible() && await mp.locator(".cm-grid").isVisible() &&
     await mp.locator(".cm-detail").isVisible(),
    "short landscape keeps search, grid and detail reachable");
  ok(await insideDetail(mp, ".cm-detail-glyph") && await insideDetail(mp, ".cm-copy-code"),
    "short landscape keeps the glyph and copy button inside the visible panel");
  ok(await insideGrid(mp), "short landscape still shows a full, usable row of glyphs");
  await shot(mp, "character-map-landscape-844x390.png");
  await phone.close();

  log("dispose through signal and idempotent handle.dispose");
  await page.evaluate(() => window.__cmAbort.abort());
  ok((await page.locator(".cm-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__cmHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(requests.every((url) => url.startsWith(BASE)),
    `zero third-party requests (${requests.filter((url) => !url.startsWith(BASE)).join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL CHARACTER MAP UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`CHARACTER MAP UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
