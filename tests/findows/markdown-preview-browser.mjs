/* Focused Markdown Preview UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/markdown-preview-browser.mjs [--port=8902] [--out=DIR] [--playwright=PATH]
   Serves this worktree and mounts the production module with a minimal injected
   services object. Proves safe text-node rendering, inert links, bounded/debounced
   rendering, compact layouts, keyboard/touch paths, dispose cleanup and zero
   external requests. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8902"));
const OUT = resolve(arg("out", join(tmpdir(), "findows-markdown-preview-evidence")));
const playwrightModule = arg("playwright", "") || process.env.FINDOWS_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright();

/* Static contract checks make a missing module/CSS red before any browser work. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/markdown-preview.mjs"), "utf8");
const engineSource = readFileSync(resolve(ROOT, "findows/js/apps/markdown-preview-engine.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/markdown-preview.css"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("markdown-preview.mjs must export async function mount()");
}
if (!/export\s+function\s+parseMarkdown\s*\(/.test(engineSource)) {
  throw new Error("markdown-preview-engine.mjs must export parseMarkdown()");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource + engineSource)) {
  throw new Error("markdown modules must not register document/window listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource + engineSource)) {
  throw new Error("markdown modules must not use markup injection or dynamic code");
}
if (/\b(https?:\/\/|javascript:|data:)\/\//.test(moduleSource) && /href\s*=/.test(moduleSource)) {
  throw new Error("markdown-preview must not assign remote href values");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".md-") && !line.startsWith("@"));
if (badSelectors.length) {
  throw new Error(`markdown-preview.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
const icon = readFileSync(resolve(ROOT, "findows/assets/icon-markdown-preview.svg"), "utf8");
if (!/^\s*<svg[\s>]/.test(icon) || !/viewBox="0 0 64 64"/.test(icon)) {
  throw new Error("icon-markdown-preview.svg is not a valid original 64px icon");
}
console.log("static checks: exports, no global listeners, no markup/dynamic code, scoped CSS, original icon PASS");

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
<title>Markdown Preview UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/shell.css">
<link rel="stylesheet" href="/findows/styles/markdown-preview.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{position:relative;z-index:30;display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{position:relative;z-index:30;padding:0 12px 12px}
  .harness-host{width:min(1000px,calc(100vw - 24px));height:min(620px,calc(100vh - 80px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden;background:#101626}
  @media (max-width:600px),(max-height:499px){.harness-host{width:calc(100vw - 20px);height:min(640px,calc(100vh - 80px))}}
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide" data-wallpaper="dusk" data-reduce-motion="false" data-translucent="true">
  <div class="fw-wallpaper" aria-hidden="true"></div>
  <div class="harness-bar"><button id="outside" type="button">Outside control</button><span>Focus here to prove shortcuts stay in the app</span></div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  /* Dev-only timer audit: proves the debounce is cancelled on dispose. */
  window.__mdTimerAudit = { scheduled: [], cleared: [] };
  const _nativeSetTimeout = window.setTimeout.bind(window);
  const _nativeClearTimeout = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...rest) => {
    const id = _nativeSetTimeout(fn, ms, ...rest);
    window.__mdTimerAudit.scheduled.push({ id, ms });
    return id;
  };
  window.clearTimeout = (id) => {
    window.__mdTimerAudit.cleared.push(id);
    return _nativeClearTimeout(id);
  };

  import { mount } from "/findows/js/apps/markdown-preview.mjs";

  const calls = { setDirty: [], openApp: [] };
  const services = {
    setDirty(id, value) { calls.setDirty.push({ id, value }); },
    openApp(appId, options) { calls.openApp.push({ appId, options }); return Promise.resolve(null); },
  };
  window.__mdCalls = calls;
  window.__mdServices = services;
  window.__mdHandle = null;
  window.__mdAbort = null;
  window.__mdMount = async (source) => {
    if (window.__mdHandle) { window.__mdHandle.dispose(); window.__mdAbort.abort(); }
    window.__mdAbort = new AbortController();
    window.__mdHandle = await mount({
      container: document.getElementById("app"),
      windowId: "markdown-preview-ui-test",
      source,
      services,
      signal: window.__mdAbort.signal,
    });
    window.__mdReady = true;
    return true;
  };
  await window.__mdMount();
  window.__mdReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__markdown-preview-harness.html") {
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
console.log(`markdown preview UI harness serving ${ROOT} at ${BASE}`);

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
  await page.goto(`${BASE}/__markdown-preview-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__mdReady === true, null, { timeout: 8000 });
}
const setSource = async (page, text) => {
  await page.locator(".md-input").fill(text);
  // The mount debounces rendering; wait for the status line that only a
  // completed render writes, so no assertion races the 150ms timer.
  await page.waitForFunction(
    () => /\d+ blocks?/.test(document.querySelector(".md-status")?.textContent || ""),
    null,
    { timeout: 4000 },
  );
};
const externalRequests = () => requests.filter((url) => !url.startsWith(BASE));

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, accessible controls and default appearance");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__mdHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok(await page.locator(".md-app").count() === 1, "exactly one app surface is mounted");
  ok(await page.locator(".md-input").isVisible() && await page.locator(".md-render").isVisible(),
    "source editor and rendered preview are both visible");
  ok(await page.locator(".md-status").isVisible() && await page.locator(".md-toolbar").isVisible(),
    "status bar and toolbar are visible");
  await page.locator("#outside").focus();
  await page.evaluate(() => window.__mdHandle.focus());
  ok(await page.evaluate(() => document.activeElement?.classList.contains("md-input")),
    "handle.focus() returns focus to the Markdown source editor");
  await shot(page, "markdown-preview-desktop.png");

  log("acceptance: **bold** renders as <strong> and introduces no markup");
  await setSource(page, "A **bold** word.");
  ok(await page.locator(".md-render strong").count() === 1, "one strong element is rendered");
  ok(await page.locator(".md-render strong").innerText() === "bold", "strong contains only the word 'bold'");
  ok(await page.locator(".md-render script").count() === 0, "no script element is created");

  log("headings, italics and lists render as native elements");
  await setSource(page, "# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six");
  for (let level = 1; level <= 6; level += 1) {
    ok(await page.locator(`.md-render h${level}`).count() === 1, `heading level ${level} renders as h${level}`);
  }
  await setSource(page, "*alpha* and _beta_");
  ok(await page.locator(".md-render em").count() === 2, "both asterisk and underscore italics render as em");
  ok(await page.locator(".md-render em").first().innerText() === "alpha", "italic text is preserved");
  await setSource(page, "- one\n- two\n\n1. first\n2. second");
  ok(await page.locator(".md-render ul").count() === 1 && await page.locator(".md-render ol").count() === 1,
    "unordered and ordered lists use ul and ol");
  ok(await page.locator(".md-render li").count() === 4, "all four list items are present");

  log("links are labelled text with no href; clicking cannot navigate or request");
  await setSource(page, "[site](https://example.com/path)\n\n[bad](javascript:alert(1))");
  ok(await page.locator(".md-render a[href]").count() === 0, "no rendered link carries an href attribute");
  const anchors = page.locator(".md-render a.md-link");
  ok(await anchors.count() === 1, "exactly one safe link is rendered as a link");
  const anchorText = await anchors.first().innerText();
  ok(anchorText.includes("site") && anchorText.includes("https://example.com/path"),
    `safe link shows its label and target (${anchorText})`);
  ok(await page.locator(".md-render .md-link-blocked").count() === 1,
    "a javascript: target is rendered as a blocked label");
  const urlBefore = page.url();
  await anchors.first().click();
  ok(page.url() === urlBefore, "clicking a link does not navigate");
  ok((await page.locator(".md-note").innerText()).includes("never opens links"),
    "clicking explains that the preview never opens links");
  await anchors.first().focus();
  await page.keyboard.press("Enter");
  ok((await page.locator(".md-note").innerText()).includes("never opens links"),
    "keyboard activation of a link also stays inert");
  ok(externalRequests().length === 0, `no remote request from links (${externalRequests().join(" | ") || "none"})`);

  log("acceptance: <script> stays literal, fires no request and runs no code");
  await setSource(page, '<script>window.__pwned=1</script>\n\n<img src=http://evil.test/x>');
  ok(await page.locator(".md-render script").count() === 0, "no script element from raw HTML text");
  ok(await page.locator(".md-render img").count() === 0, "no img element from raw HTML text");
  ok((await page.locator(".md-render").innerText()).includes("<script>window.__pwned=1</script>"),
    "script text is displayed literally");
  ok(await page.evaluate(() => window.__pwned === undefined), "the injected script never executed");
  ok(externalRequests().length === 0, `zero third-party requests (${externalRequests().join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  await shot(page, "markdown-preview-literal-html.png");

  log("regression F4: a 1MB paste is bounded, non-blocking and truthful");
  await setSource(page, "**kept**");
  const keptRender = await page.locator(".md-render").innerText();
  const pasted = await page.evaluate((text) => {
    const input = document.querySelector(".md-input");
    input.value = text;
    const started = performance.now();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const dispatchMs = performance.now() - started;
    return {
      dispatchMs,
      status: document.querySelector(".md-status").textContent,
      render: document.querySelector(".md-render").innerText,
    };
  }, "a".repeat(1_000_000));
  ok(/too long/i.test(pasted.status) && /20,000/.test(pasted.status),
    `oversized paste reports a truthful status (${pasted.status})`);
  ok(pasted.dispatchMs < 50,
    `the input handler does not synchronously parse a 1MB paste (${pasted.dispatchMs.toFixed(1)}ms)`);
  ok(pasted.render === keptRender, "no partial parse is rendered; the last safe preview is kept");
  ok(await page.locator(".md-render script").count() === 0, "oversized paste still renders no script elements");
  ok(externalRequests().length === 0, `oversized paste fires no request (${externalRequests().join(" | ") || "none"})`);
  await shot(page, "markdown-preview-input-too-long.png");

  log("debounce coalesces rapid typing into one render");
  const rendersBefore = Number(await page.evaluate(() => document.querySelector(".md-render").dataset.renderCount || 0));
  await page.evaluate(() => {
    const input = document.querySelector(".md-input");
    for (let index = 0; index < 12; index += 1) {
      input.value = `**v${index}**`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.waitForFunction(() => /\d+ blocks?/.test(document.querySelector(".md-status")?.textContent || ""), null, { timeout: 4000 });
  const rendersAfter = Number(await page.evaluate(() => document.querySelector(".md-render").dataset.renderCount || 0));
  ok(rendersAfter - rendersBefore === 1, `12 rapid input events produced one render (${rendersAfter - rendersBefore})`);
  ok(await page.locator(".md-render strong").innerText() === "v11", "the last typed value is the one rendered");

  log("keyboard typing updates the preview and input stays scoped to the app");
  await page.evaluate(() => window.__mdHandle.focus());
  await page.keyboard.press("Control+A");
  await page.keyboard.type("**typed bold**");
  await page.waitForFunction(
    () => document.querySelector(".md-render strong")?.textContent === "typed bold",
    null,
    { timeout: 4000 },
  );
  ok(true, "typed markdown renders live via keyboard");
  await page.locator("#outside").focus();
  await page.keyboard.type("abc");
  ok(await page.locator(".md-input").inputValue() === "**typed bold**",
    "typing on an outside control does not reach the editor");

  log("compact 390x844 and short landscape 844x390 with touch controls");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  ok(await mp.locator(".md-input").isVisible() && await mp.locator(".md-render").isVisible(),
    "compact layout keeps source and preview visible");
  const compactFit = await mp.evaluate(() => {
    const node = document.querySelector(".md-app");
    return { scroll: node.scrollWidth, client: node.clientWidth };
  });
  ok(compactFit.scroll <= compactFit.client + 2,
    `compact layout has no horizontal overflow (${compactFit.scroll} <= ${compactFit.client + 2})`);
  await shot(mp, "markdown-preview-compact-390.png");
  await mp.locator('.md-button[data-action="clear"]').tap();
  ok((await mp.locator(".md-input").inputValue()) === "", "tap on Clear empties the source");
  await mp.locator('.md-button[data-action="sample"]').tap();
  ok(await mp.locator(".md-render strong").count() >= 1, "tap on Insert sample restores the sample preview");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator(".md-input").isVisible() && await mp.locator(".md-render").isVisible(),
    "short landscape keeps source and preview reachable");
  const landscapeFit = await mp.evaluate(() => {
    const node = document.querySelector(".md-app");
    return { scroll: node.scrollWidth, client: node.clientWidth };
  });
  ok(landscapeFit.scroll <= landscapeFit.client + 2,
    `landscape layout has no horizontal overflow (${landscapeFit.scroll} <= ${landscapeFit.client + 2})`);
  await shot(mp, "markdown-preview-landscape-844x390.png");
  await phone.close();

  log("dispose and abort cleanup");
  await setSource(page, "**before dispose**");
  const timerMark = await page.evaluate(() => window.__mdTimerAudit.scheduled.length);
  await page.evaluate(() => {
    const input = document.querySelector(".md-input");
    input.value = "**after dispose**";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const pendingIds = await page.evaluate((start) => {
    const audit = window.__mdTimerAudit;
    return audit.scheduled.slice(start)
      .filter((timer) => timer.ms === 150 && !audit.cleared.includes(timer.id))
      .map((timer) => timer.id);
  }, timerMark);
  ok(pendingIds.length === 1, `one debounce timer is pending before dispose (${pendingIds.length})`);
  await page.evaluate(() => window.__mdHandle.dispose());
  const clearedOnDispose = await page.evaluate((ids) => {
    const audit = window.__mdTimerAudit;
    return ids.every((id) => audit.cleared.includes(id));
  }, pendingIds);
  ok(clearedOnDispose, "dispose() clears the pending debounce timer");
  ok(await page.locator(".md-app").count() === 0, "dispose() removes the app surface");
  await page.evaluate(() => window.__mdHandle.dispose());
  ok(true, "a second dispose() is safe");
  await page.evaluate(() => window.__mdMount());
  ok(await page.locator(".md-app").count() === 1, "remount creates a fresh app surface");
  await page.evaluate(() => window.__mdAbort.abort());
  ok(await page.locator(".md-app").count() === 0, "abort signal removes the app surface");
  ok(externalRequests().length === 0, `zero third-party requests overall (${externalRequests().join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors overall (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL MARKDOWN PREVIEW CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`MARKDOWN PREVIEW CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
