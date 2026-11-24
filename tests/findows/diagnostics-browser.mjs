/* Focused Diagnostics UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/diagnostics-browser.mjs [--port=8807] [--out=DIR] [--playwright=PATH]
   Serves this worktree and mounts the production Diagnostics module with
   injectable shell services plus the real file service / IndexedDB. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8807"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright();

/* Static boundaries make a missing or unsafe module red before any browser work. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/diagnostics.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/diagnostics.css"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("diagnostics.mjs must export async function mount()");
}
if (/\b(innerHTML|outerHTML|document\.write|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("diagnostics.mjs must not use markup injection or dynamic code");
}
if (/\b(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|navigator\.sendBeacon|import\s*\()/.test(moduleSource)) {
  throw new Error("diagnostics.mjs must not make network requests");
}
const fingerprint = [
  "navigator.userAgent", "navigator.plugins", "hardwareConcurrency", "deviceMemory",
  "navigator.language", "navigator.languages", "getBattery", "screen.", "innerWidth",
  "innerHeight", "devicePixelRatio", "localStorage", "sessionStorage", "document.cookie",
  "BroadcastChannel", "indexedDB", "iframe", "canvas", "WebGL", "permissions.query",
];
const leaked = fingerprint.filter((token) => moduleSource.includes(token));
if (leaked.length) throw new Error(`diagnostics.mjs reads out-of-scope browser data: ${leaked.join(" | ")}`);
if (/document\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("diagnostics.mjs must not register document listeners");
}
for (const type of ["online", "offline"]) {
  if (!moduleSource.includes(`addEventListener("${type}"`)) throw new Error(`missing ${type} listener`);
  if (!moduleSource.includes(`removeEventListener("${type}"`)) throw new Error(`${type} listener has no cleanup`);
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".diag-") && !line.startsWith("@"));
if (badSelectors.length) throw new Error(`diagnostics.css has unscoped selectors: ${badSelectors.join(" | ")}`);
const iconSource = readFileSync(resolve(ROOT, "findows/assets/icon-diagnostics.svg"), "utf8");
if (!/^\s*<svg[\s>]/.test(iconSource) || !/viewBox="0 0 64 64"/.test(iconSource) ||
    /<script|foreignObject|xlink:href|http:\/\/(?!www\.w3\.org)/.test(iconSource)) {
  throw new Error("icon-diagnostics.svg is not a valid original 64px icon");
}
console.log("static checks: async mount, no markup/eval/network/fingerprinting, listener cleanup, scoped CSS, original icon PASS");

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
<title>Diagnostics UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/shell.css">
<link rel="stylesheet" href="/findows/styles/diagnostics.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{position:relative;z-index:30;display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{position:relative;z-index:30;padding:0 12px 12px}
  .harness-host{width:min(920px,calc(100vw - 24px));height:min(600px,calc(100vh - 80px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden;background:#101626}
  @media (max-width:600px),(max-height:499px){.harness-host{width:calc(100vw - 20px);height:min(640px,calc(100vh - 80px))}}
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide" data-wallpaper="dusk" data-reduce-motion="false" data-translucent="true">
  <div class="fw-wallpaper" aria-hidden="true"></div>
  <div class="harness-bar"><button id="outside" type="button">Outside control</button><span>Facts here describe only this Findows window</span></div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { createStorage } from "/findows/js/storage.mjs";
  import { createFileService } from "/findows/js/file-service.mjs";
  import { mount } from "/findows/js/apps/diagnostics.mjs";

  const desktop = document.getElementById("fw-desktop");
  const storage = createStorage();
  const files = createFileService({ storage });
  const state = {
    version: "1.4.2-diagnostics",
    count: 3,
    subscribe: true,
    files: "real",
    estimate: "ok",
    online: true,
    countThrows: false,
  };
  const calls = { subscribe: 0, unsubscribe: 0, getWindowCount: 0, windowAdd: [], windowRemove: [] };
  window.__diagCalls = calls;
  window.__diagHandle = null;
  window.__diagAbort = null;
  window.__diagReady = false;

  /* Spy on the exact window listeners the app is allowed to own. */
  const nativeAdd = window.addEventListener.bind(window);
  const nativeRemove = window.removeEventListener.bind(window);
  window.addEventListener = (type, ...rest) => {
    if (type === "online" || type === "offline") calls.windowAdd.push(type);
    return nativeAdd(type, ...rest);
  };
  window.removeEventListener = (type, ...rest) => {
    if (type === "online" || type === "offline") calls.windowRemove.push(type);
    return nativeRemove(type, ...rest);
  };

  /* Control navigator.onLine and navigator.storage.estimate without a network. */
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => state.online });
  const manager = navigator.storage;
  if (manager) {
    const real = typeof manager.estimate === "function" ? manager.estimate.bind(manager) : null;
    Object.defineProperty(manager, "estimate", {
      configurable: true,
      value: () => {
        if (state.estimate === "reject") return Promise.reject(new Error("estimate blocked"));
        if (state.estimate === "missing") return undefined;
        if (state.estimate === "fixed") return Promise.resolve({ usage: 1536, quota: 5 * 1024 * 1024 });
        return real ? real() : Promise.resolve({ usage: 2048, quota: 1024 * 1024 * 512 });
      },
    });
  }

  window.__diagEmitWindows = () => {};
  window.__diagSetOnline = (value) => {
    state.online = value;
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  };
  window.__diagMount = async (options = {}) => {
    if (window.__diagHandle) { window.__diagHandle.dispose(); window.__diagAbort.abort(); }
    Object.assign(state, options);
    const listeners = new Set();
    const services = {
      version: state.version,
      getWindowCount() {
        calls.getWindowCount += 1;
        if (state.countThrows) throw new Error("window count blocked");
        return state.count;
      },
      openApp() { return null; },
      setDirty() {},
    };
    if (state.subscribe) {
      services.subscribeWindows = (fn) => {
        calls.subscribe += 1;
        listeners.add(fn);
        return () => { calls.unsubscribe += 1; listeners.delete(fn); };
      };
      window.__diagEmitWindows = (count) => {
        state.count = count;
        for (const fn of [...listeners]) fn(count);
      };
    } else {
      window.__diagEmitWindows = () => {};
    }
    if (state.files === "real") services.files = files;
    else if (state.files === "error") services.files = {
      ready: () => Promise.reject(new Error("storage check blocked")),
      getStorageMode: () => "temporary",
      getModeReason: () => "UNAVAILABLE",
    };
    else services.files = null;
    window.__diagAbort = new AbortController();
    window.__diagHandle = await mount({
      container: document.getElementById("app"),
      windowId: "diagnostics-ui-test",
      services,
      signal: window.__diagAbort.signal,
    });
    window.__diagReady = true;
    return true;
  };
  await window.__diagMount();
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === "/__diagnostics-ui-harness.html") {
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
console.log(`diagnostics UI harness serving ${ROOT} at ${BASE}`);

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
  await page.goto(`${BASE}/__diagnostics-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__diagReady === true, null, { timeout: 8000 });
}
const text = (page, selector) => page.locator(selector).innerText();
const state = (page, selector, name) => page.locator(selector).getAttribute(name);

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, real facts and accessible structure");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__diagHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await text(page, ".diag-version")) === "1.4.2-diagnostics", `app version comes from services.version (${await text(page, ".diag-version")})`);
  ok((await text(page, ".diag-windows")) === "3", `open window count comes from services.getWindowCount() (${await text(page, ".diag-windows")})`);
  ok((await text(page, ".diag-network")) === "Online", `network state comes from navigator.onLine (${await text(page, ".diag-network")})`);
  ok((await text(page, ".diag-storage")).includes("Persistent"), `storage mode comes from the real file service (${await text(page, ".diag-storage")})`);
  ok((await text(page, ".diag-storage-detail")).includes("clear site data"),
    `persistent storage detail says the browser can clear site data (${await text(page, ".diag-storage-detail")})`);
  ok((await text(page, ".diag-estimate")).includes("used of"), `storage estimate is displayed when the browser provides it (${await text(page, ".diag-estimate")})`);
  ok(await page.locator("article.diag-card h2").count() === 4, "four labelled fact cards are exposed as articles with headings");
  ok(await page.locator(".diag-status[role='status'][aria-live='polite']").count() === 1, "a polite live region announces fact updates");
  const surfaceText = await page.evaluate(() => document.getElementById("app").textContent);
  ok(!/\b(CPU|RAM|process|kernel|device id|serial|OS version)\b/i.test(surfaceText), "no fabricated system or process facts are shown");
  await page.locator("#outside").focus();
  await page.evaluate(() => window.__diagHandle.focus());
  ok(await page.evaluate(() => document.activeElement?.classList.contains("diag-title")), "handle.focus() returns focus to the Diagnostics heading");
  await shot(page, "diagnostics-desktop-dark.png");

  log("reactive window count through services.subscribeWindows");
  const before = await page.evaluate(() => ({ ...window.__diagCalls }));
  ok(before.subscribe === 1 && before.windowAdd.includes("online") && before.windowAdd.includes("offline"),
    `one window subscription and online/offline listeners are registered (${JSON.stringify(before)})`);
  await page.evaluate(() => window.__diagEmitWindows(7));
  await page.waitForFunction(() => document.querySelector(".diag-windows")?.textContent === "7", null, { timeout: 4000 });
  ok((await text(page, ".diag-windows")) === "7", "window count updates from a real subscription callback");
  await page.evaluate(() => window.__diagEmitWindows(-2));
  await page.waitForFunction(() => document.querySelector(".diag-windows")?.textContent === "Unavailable", null, { timeout: 4000 });
  ok((await text(page, ".diag-windows")) === "Unavailable", "an invalid pushed count becomes an explicit Unavailable state");
  await page.evaluate(() => window.__diagEmitWindows(3));

  log("reactive network state with cleanup on dispose");
  await page.evaluate(() => window.__diagSetOnline(false));
  await page.waitForFunction(() => document.querySelector(".diag-network")?.textContent === "Offline", null, { timeout: 4000 });
  ok((await text(page, ".diag-network")) === "Offline" && (await state(page, ".diag-network", "data-state")) === "offline",
    "the offline event flips the network fact and its text state");
  await shot(page, "diagnostics-offline.png");
  await page.evaluate(() => window.__diagSetOnline(true));
  await page.waitForFunction(() => document.querySelector(".diag-network")?.textContent === "Online", null, { timeout: 4000 });
  ok((await text(page, ".diag-network")) === "Online", "the online event restores the network fact");

  log("manual refresh re-reads the shell and announces the update");
  await page.evaluate(() => { window.__diagMount({ version: "2.0.0-refreshed", subscribe: false, estimate: "fixed", online: true }); });
  await page.waitForFunction(() => document.querySelector(".diag-version")?.textContent === "2.0.0-refreshed", null, { timeout: 4000 });
  ok((await text(page, ".diag-estimate")) === "Browser estimate for this whole site (not just Findows): 1.5 KB used of 5.0 MB",
    `Refresh reads the injected estimate and labels it as whole-site (${await text(page, ".diag-estimate")})`);
  const countBeforeRefresh = await page.evaluate(() => window.__diagCalls.getWindowCount);
  await page.locator(".diag-refresh").click();
  await page.waitForFunction((n) => window.__diagCalls.getWindowCount > n, countBeforeRefresh, { timeout: 4000 });
  ok((await text(page, ".diag-status")).toLowerCase().includes("updated"), "the live region reports a completed refresh");

  log("clear unavailable and error states");
  await page.evaluate(() => window.__diagMount({
    version: "", count: "not-a-number", subscribe: false, files: "error", estimate: "reject", online: undefined, countThrows: true,
  }));
  await page.waitForFunction(() => document.querySelector(".diag-version")?.textContent === "Unavailable", null, { timeout: 4000 });
  const unavailable = await page.evaluate(() => ({
    version: document.querySelector(".diag-version")?.textContent,
    windows: document.querySelector(".diag-windows")?.textContent,
    network: document.querySelector(".diag-network")?.textContent,
    storage: document.querySelector(".diag-storage")?.textContent,
    estimate: document.querySelector(".diag-estimate")?.textContent,
    detail: document.querySelector(".diag-storage-detail")?.textContent,
  }));
  ok(Object.values(unavailable).every((value) => typeof value === "string" && value.length > 0),
    `every fact has visible text, never a blank card (${JSON.stringify(unavailable)})`);
  ok(unavailable.version === "Unavailable" && unavailable.windows === "Unavailable" &&
     unavailable.network === "Unavailable" && unavailable.storage === "Unavailable" &&
     unavailable.estimate.includes("unavailable"),
    "missing services, a throwing count, a failing storage check and a blocked estimate all read Unavailable");
  ok(unavailable.detail.includes("storage check blocked"), `storage failure keeps the real reason (${unavailable.detail})`);
  await shot(page, "diagnostics-unavailable.png");

  log("light theme, compact layout and short landscape");
  await page.evaluate(() => window.__diagMount({ version: "1.4.2-diagnostics", count: 5, subscribe: true, files: "real", estimate: "ok", online: true, countThrows: false }));
  await page.waitForFunction(() => document.querySelector(".diag-version")?.textContent === "1.4.2-diagnostics", null, { timeout: 4000 });
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await shot(page, "diagnostics-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  ok(await mp.locator(".diag-windows").isVisible() && await mp.locator(".diag-refresh").isVisible(),
    "compact layout keeps every fact and Refresh reachable");
  const tap = await mp.locator(".diag-refresh").boundingBox();
  const phoneViewport = mp.viewportSize();
  ok(tap && tap.height >= 44, `compact refresh target is at least 44px (${Math.round(tap?.height || 0)}px)`);
  ok(tap && tap.y + tap.height <= phoneViewport.height + 1, "compact Refresh sits inside the viewport without scrolling");
  await shot(mp, "diagnostics-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator(".diag-storage").isVisible() && await mp.locator(".diag-refresh").isVisible(),
    "short landscape still shows storage and Refresh");
  const landscapeTap = await mp.locator(".diag-refresh").boundingBox();
  const landscapeViewport = mp.viewportSize();
  ok(landscapeTap && landscapeTap.y + landscapeTap.height <= landscapeViewport.height + 1,
    "landscape Refresh sits inside the viewport without scrolling");
  await shot(mp, "diagnostics-landscape-844x390.png");
  await phone.close();

  log("dispose removes listeners, subscription and surface");
  const beforeDispose = await page.evaluate(() => ({ ...window.__diagCalls }));
  await page.evaluate(() => window.__diagHandle.dispose());
  ok((await page.locator(".diag-app").count()) === 0, "dispose removes the app surface");
  const afterDispose = await page.evaluate(() => ({ ...window.__diagCalls }));
  ok(afterDispose.unsubscribe === beforeDispose.unsubscribe + 1, "the window subscription is released on dispose");
  for (const type of ["online", "offline"]) {
    ok(afterDispose.windowRemove.filter((t) => t === type).length > beforeDispose.windowRemove.filter((t) => t === type).length,
      `${type} listener is removed on dispose`);
  }
  const countAtDispose = afterDispose.getWindowCount;
  await page.evaluate(() => window.__diagSetOnline(false));
  await page.waitForTimeout(120);
  ok((await page.evaluate(() => window.__diagCalls.getWindowCount)) === countAtDispose,
    "events after dispose no longer trigger a refresh");
  await page.evaluate(() => window.__diagHandle.dispose());
  ok(true, "a second dispose() is safe");

  log("no stray requests, console errors or HTTP failures");
  ok(requests.every((url) => url.startsWith(BASE)), `zero third-party requests (${requests.filter((url) => !url.startsWith(BASE)).join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL DIAGNOSTICS UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`DIAGNOSTICS UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
