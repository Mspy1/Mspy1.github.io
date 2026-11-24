/* Focused JSON Formatter UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/json-formatter-browser.mjs [--port=8851] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8851 and mounts the production module in a
   minimal harness with injected clipboard/download services. The shell registry
   is owned by another lane. No external requests, no fixture data shipped. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8851"));
const BUGFIX = arg("bugfix", "all");
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const PLAYWRIGHT = arg("playwright", "") || process.env.FINDOWS_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || undefined;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright(PLAYWRIGHT);

/* Static contract checks run before any browser work, so a missing app is red. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/json-formatter.mjs"), "utf8");
const engineSource = readFileSync(resolve(ROOT, "findows/js/apps/json-formatter-engine.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/json-formatter.css"), "utf8");
const iconSource = readFileSync(resolve(ROOT, "findows/assets/icon-json-formatter.svg"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("json-formatter.mjs must export async function mount()");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("json-formatter.mjs must not register window/document listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource + "\n" + engineSource)) {
  throw new Error("JSON Formatter must not use markup injection or dynamic code");
}
if (!/^<svg[\s\S]*<\/svg>\s*$/.test(iconSource) || /https?:\/\//.test(iconSource.replace("http://www.w3.org/2000/svg", ""))) {
  throw new Error("icon-json-formatter.svg must be a self-contained original SVG");
}
if (/https?:\/\//.test(moduleSource + "\n" + cssSource)) {
  throw new Error("JSON Formatter must not request external resources");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".jsonfmt-") && !line.startsWith("@"));
if (badSelectors.length) {
  throw new Error(`json-formatter.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
console.log("static checks: mount export, no global listeners, no markup/eval, local assets, app-scoped CSS PASS");

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
<title>JSON Formatter UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/json-formatter.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{padding:12px}
  .harness-host{width:min(900px,calc(100vw - 24px));height:min(640px,calc(100vh - 84px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden;background:#101626}
  @media (max-width:600px),(max-height:499px){
    .harness-host{width:calc(100vw - 20px);height:min(720px,calc(100vh - 84px))}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar"><button id="outside" type="button">Outside control</button><span>Focus here to prove shortcuts are scoped</span></div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { mount } from "/findows/js/apps/json-formatter.mjs";

  window.__jsonfmtPasteText = '{"name":"Ada","tags":["x","y"],"ok":true}';
  window.__jsonfmtCopies = [];
  window.__jsonfmtDownloads = [];
  window.__jsonfmtXss = 0;
  const services = {
    clipboard: {
      async readText() { return window.__jsonfmtPasteText; },
      async writeText(text) { window.__jsonfmtCopies.push(text); },
    },
    download(details) { window.__jsonfmtDownloads.push(details); },
  };
  window.__jsonfmtServices = services;

  /* Harness-only doubles for the lifecycle/copy regression checks. */
  window.__jsonfmtCreated = [];
  window.__jsonfmtRevoked = [];
  window.__jsonfmtAnchorClicks = [];
  URL.createObjectURL = () => {
    const url = "blob:jsonfmt-test/" + (window.__jsonfmtCreated.length + 1);
    window.__jsonfmtCreated.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => { window.__jsonfmtRevoked.push(url); };
  HTMLAnchorElement.prototype.click = function () { window.__jsonfmtAnchorClicks.push(this.download); };

  window.__jsonfmtMountApp = async (chosenServices, windowId) => {
    if (window.__jsonfmtHandle) window.__jsonfmtHandle.dispose();
    if (window.__jsonfmtAbort) window.__jsonfmtAbort.abort();
    const controller = new AbortController();
    window.__jsonfmtAbort = controller;
    window.__jsonfmtHandle = await mount({
      container: document.getElementById("app"),
      windowId,
      fileId: null,
      services: chosenServices,
      signal: controller.signal,
    });
    window.__jsonfmtReady = true;
  };
  await window.__jsonfmtMountApp(services, "json-formatter-ui-test");
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__json-formatter-ui-harness.html") {
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
console.log(`JSON Formatter UI harness serving ${ROOT} at ${BASE}`);

let step = 0;
const log = (message) => console.log(`[${String(++step).padStart(2, "0")}] ${message}`);
const ok = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`      PASS ${message}`);
};
const shot = (page, name) => page.screenshot({ path: resolve(OUT, name), fullPage: false });

const consoleErrors = [];
const badResponses = [];
const externalRequests = [];
function watch(page) {
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) externalRequests.push(url);
  });
}

async function openHarness(page) {
  await page.goto(`${BASE}/__json-formatter-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__jsonfmtReady === true, null, { timeout: 5000 });
}

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract and initial empty state");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__jsonfmtHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  const inputAttrs = await page.locator(".jsonfmt-input").evaluate((node) => ({
    tag: node.tagName.toLowerCase(),
    label: Boolean(document.querySelector(`label[for="${node.id}"]`)),
    described: Boolean(node.getAttribute("aria-describedby")),
  }));
  ok(inputAttrs.tag === "textarea" && inputAttrs.label && inputAttrs.described,
    `input is a labelled, described textarea (${JSON.stringify(inputAttrs)})`);
  ok((await page.locator(".jsonfmt-node").count()) === 0 && (await page.locator(".jsonfmt-empty").isVisible()),
    "empty state shows a prompt before any JSON is formatted");

  log("real clipboard paste, pretty print and render tree");
  await page.evaluate(() => { window.__jsonfmtPasteText = '{"name":"Ada","tags":["x","y"],"ok":true}'; });
  await page.locator('[data-action="paste"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".jsonfmt-node").length > 0);
  ok((await page.locator(".jsonfmt-input").inputValue()) === '{"name":"Ada","tags":["x","y"],"ok":true}',
    "paste fills the textarea from the injected clipboard service");
  ok((await page.locator('.jsonfmt-node[data-path="$"]').count()) === 1 &&
     (await page.locator('.jsonfmt-node[data-path="$.tags"]').count()) === 1,
    "tree exposes root and nested nodes with stable paths");
  const values = await page.locator(".jsonfmt-value").allInnerTexts();
  ok(values.includes('"x"') && values.includes('"y"') && values.includes("true"),
    `leaf values are rendered as text (${JSON.stringify(values)})`);
  ok((await page.locator(".jsonfmt-stats").innerText()).includes("nodes"), "node statistics are shown");
  await shot(page, "json-formatter-desktop-paste.png");

  log("collapse tree by pointer and keyboard, expand all");
  const tagsToggle = page.locator('.jsonfmt-node[data-path="$.tags"] > .jsonfmt-node-row > .jsonfmt-toggle');
  ok((await tagsToggle.getAttribute("aria-expanded")) === "true", "container starts expanded");
  await tagsToggle.click();
  ok((await tagsToggle.getAttribute("aria-expanded")) === "false" &&
     (await page.locator('.jsonfmt-node[data-path="$.tags"] > .jsonfmt-children').isHidden()) === true,
    "clicking the toggle collapses children and updates aria-expanded");
  await tagsToggle.focus();
  await page.keyboard.press("ArrowRight");
  ok((await tagsToggle.getAttribute("aria-expanded")) === "true", "ArrowRight expands the focused node");
  await page.keyboard.press("ArrowLeft");
  ok((await tagsToggle.getAttribute("aria-expanded")) === "false", "ArrowLeft collapses the focused node");
  await page.locator('[data-action="expand"]').click();
  ok((await page.locator(".jsonfmt-toggle[aria-expanded='true']").count()) >= 2, "Expand all restores containers");
  await shot(page, "json-formatter-desktop-tree.png");

  log("indent and sort options feed the copied output");
  await page.locator(".jsonfmt-indent").selectOption("4");
  await page.locator('[data-action="copy"]').click();
  const fourSpace = await page.evaluate(() => window.__jsonfmtCopies.at(-1));
  ok(fourSpace.includes('\n    "name"'), "four-space indent is used for copy output");
  await page.locator(".jsonfmt-indent").selectOption("\t");
  await page.locator('[data-action="copy"]').click();
  ok((await page.evaluate(() => window.__jsonfmtCopies.at(-1))).includes('\n\t"name"'), "tab indent is used");
  await page.locator(".jsonfmt-indent").selectOption("2");
  await page.locator(".jsonfmt-sort").check();
  await page.locator('[data-action="copy"]').click();
  const sorted = await page.evaluate(() => window.__jsonfmtCopies.at(-1));
  ok(sorted.indexOf('"name"') < sorted.indexOf('"ok"') && sorted.indexOf('"ok"') < sorted.indexOf('"tags"'),
    "sort keys reorders members in the output");
  await page.locator(".jsonfmt-sort").uncheck();

  log("minify keeps valid JSON and the copy path is parseable");
  await page.locator('[data-action="minify"]').click();
  const minified = await page.locator(".jsonfmt-input").inputValue();
  ok(minified === '{"name":"Ada","ok":true,"tags":["x","y"]}' ||
     minified === '{"name":"Ada","tags":["x","y"],"ok":true}',
    `minify produces compact source (${minified})`);
  await page.locator('[data-action="copy"]').click();
  const copied = await page.evaluate(() => {
    const text = window.__jsonfmtCopies.at(-1);
    try { return { text, value: JSON.parse(text) }; } catch { return { text, value: null }; }
  });
  ok(copied.value && copied.value.name === "Ada" && Array.isArray(copied.value.tags),
    "copied text is valid JSON with the original values");
  ok((await page.locator(".jsonfmt-sr-status").innerText()).includes("Copied"), "copy is announced politely");

  log("download requests an inert .json file through the service");
  await page.locator('[data-action="download"]').click();
  const download = await page.evaluate(() => window.__jsonfmtDownloads.at(-1));
  ok(download && download.filename.endsWith(".json") && /jsonformatter-/.test(download.filename),
    `download uses a safe filename (${download?.filename})`);
  ok(download && JSON.parse(download.content).name === "Ada", "download content is the formatted JSON");

  log("parse error reports a position; injected markup stays inert text");
  await page.locator(".jsonfmt-input").fill('{\n  "a": 1,\n  "bad": [1, <img src=x onerror="window.__jsonfmtXss=1">,],\n}');
  await page.locator(".jsonfmt-input").press("Control+Enter");
  ok(await page.locator(".jsonfmt-error").isVisible(), "invalid JSON shows the error region");
  const errorText = await page.locator(".jsonfmt-error").innerText();
  ok(/Line \d+/.test(errorText) && /column \d+/.test(errorText) && /position \d+/.test(errorText) && errorText.includes("^"),
    `error carries line, column, position and a caret (${errorText.replace(/\n/g, " / ")})`);
  ok((await page.locator(".jsonfmt-error-snippet").innerText()).includes("<img"),
    "offending source is shown as plain text");
  ok((await page.locator(".jsonfmt-node").count()) === 0, "invalid input never renders a stale tree");
  ok((await page.locator("img").count()) === 0 && (await page.evaluate(() => window.__jsonfmtXss)) === 0,
    "pasted markup is never inserted as an element or executed");
  await shot(page, "json-formatter-desktop-error.png");

  log("sample JSON with hostile string stays inert");
  await page.locator('[data-action="sample"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".jsonfmt-node").length > 0);
  ok((await page.locator("img").count()) === 0 && (await page.evaluate(() => window.__jsonfmtXss)) === 0,
    "sample's <img onerror> string creates no element and runs no script");
  ok((await page.locator(".jsonfmt-value").allInnerTexts()).some((text) => text.includes("\\u003cimg")),
    "hostile string is displayed escaped");
  await shot(page, "json-formatter-desktop-sample.png");

  log("keyboard is scoped to the app surface");
  await page.locator("#outside").focus();
  const beforeOutside = await page.locator(".jsonfmt-input").inputValue();
  await page.keyboard.type("AAA");
  await page.keyboard.press("Control+Enter");
  ok((await page.locator(".jsonfmt-input").inputValue()) === beforeOutside,
    "typing and shortcuts outside the app cannot reach it");
  await page.locator(".jsonfmt-input").focus();
  await page.locator(".jsonfmt-input").press("Control+Enter");
  ok((await page.locator(".jsonfmt-node").count()) > 0, "Ctrl+Enter inside the textarea re-formats");

  log("light theme");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(200);
  await shot(page, "json-formatter-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  if (BUGFIX === "all" || BUGFIX === "f3") {
    log("F3 regression: blob URL revoked on dispose and never twice");
    await page.evaluate(async () => { await window.__jsonfmtMountApp({}, "json-formatter-url-test"); });
    await page.locator('[data-action="sample"]').click();
    await page.locator('[data-action="download"]').click();
    const immediate = await page.evaluate(() => {
      const created = window.__jsonfmtCreated.at(-1);
      window.__jsonfmtHandle.dispose();
      return {
        created,
        revoked: window.__jsonfmtRevoked.slice(),
        clicks: window.__jsonfmtAnchorClicks.slice(),
      };
    });
    ok(Boolean(immediate.created) && immediate.revoked.filter((url) => url === immediate.created).length === 1,
      `blob URL is revoked synchronously on dispose (${JSON.stringify(immediate)})`);
    ok(immediate.clicks.at(-1) === "jsonformatter-json-formatter-url-test.json",
      "download link uses the local Blob fallback with a safe filename");

    await page.evaluate(async () => { await window.__jsonfmtMountApp({}, "json-formatter-url-test-2"); });
    await page.locator('[data-action="sample"]').click();
    await page.locator('[data-action="download"]').click();
    await page.waitForTimeout(1150);
    const delayed = await page.evaluate(() => {
      const created = window.__jsonfmtCreated.at(-1);
      const beforeDispose = window.__jsonfmtRevoked.filter((url) => url === created).length;
      window.__jsonfmtHandle.dispose();
      return { created, beforeDispose, afterDispose: window.__jsonfmtRevoked.filter((url) => url === created).length };
    });
    ok(delayed.beforeDispose === 1 && delayed.afterDispose === 1,
      `delayed revoke runs once and dispose does not revoke again (${JSON.stringify(delayed)})`);
  }

  if (BUGFIX === "all" || BUGFIX === "f2") {
    log("F2 regression: legacy copy failure is announced truthfully");
    await page.evaluate(async () => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
      document.execCommand = () => false;
      await window.__jsonfmtMountApp({}, "json-formatter-copy-fail");
    });
    await page.locator('[data-action="sample"]').click();
    await page.locator('[data-action="copy"]').click();
    const status = await page.locator(".jsonfmt-sr-status").innerText();
    ok(/Copy failed/i.test(status) && !/Copied formatted JSON/i.test(status),
      `failed execCommand copy does not claim success (${status})`);
    ok((await page.locator(".jsonfmt-scratch").count()) === 0,
      "scratch textarea is removed even when copy is refused");
  }

  log("390x844 touch layout");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const columns = await mp.locator(".jsonfmt-main").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  ok(columns === 1, `compact layout stacks editor and tree (${columns} column)`);
  const buttonHeights = await mp.locator("button.jsonfmt-btn").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  ok(buttonHeights.length > 0 && buttonHeights.every((height) => height >= 44),
    `all compact action buttons are at least 44px (min ${Math.min(...buttonHeights).toFixed(1)})`);
  const clipped = await mp.evaluate(() => {
    const pane = document.querySelector(".jsonfmt-editor").getBoundingClientRect();
    return [...document.querySelectorAll(".jsonfmt-editor .jsonfmt-btn")]
      .some((button) => button.getBoundingClientRect().bottom > pane.bottom + 1);
  });
  ok(!clipped, "all editor controls fit inside the compact editor pane");
  await mp.tap('[data-action="paste"]');
  await mp.waitForFunction(() => document.querySelectorAll(".jsonfmt-node").length > 0);
  ok((await mp.locator(".jsonfmt-node").count()) > 0, "touch tap on Paste formats JSON");
  await mp.tap('.jsonfmt-node[data-path="$.tags"] > .jsonfmt-node-row > .jsonfmt-toggle');
  ok((await mp.locator('.jsonfmt-node[data-path="$.tags"] > .jsonfmt-node-row > .jsonfmt-toggle').getAttribute("aria-expanded")) === "false",
    "touch tap collapses a tree node");
  await shot(mp, "json-formatter-compact-390.png");

  log("844x390 short landscape layout");
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.waitForTimeout(120);
  ok((await mp.locator(".jsonfmt-input").isVisible()) && (await mp.locator(".jsonfmt-tree").isVisible()),
    "short landscape keeps input and tree usable");
  const landscapeHeights = await mp.locator("button.jsonfmt-btn").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  ok(landscapeHeights.every((height) => height >= 44),
    `short landscape keeps buttons tappable (min ${Math.min(...landscapeHeights).toFixed(1)} of ${JSON.stringify(landscapeHeights)})`);
  await shot(mp, "json-formatter-landscape-844x390.png");
  await phone.close();

  log("dispose through signal and idempotent handle.dispose");
  await page.evaluate(() => window.__jsonfmtAbort.abort());
  ok((await page.locator(".jsonfmt-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__jsonfmtHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);

  log("ALL JSON FORMATTER UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`JSON FORMATTER UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
