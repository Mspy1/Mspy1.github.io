/* Focused Block Drop browser evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/block-drop-browser.mjs [--port=8863] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8863 and mounts the production module with a
   minimal injected services object. Verifies both 390x844 and 844x390, keyboard
   and touch paths, timer cleanup on dispose and zero external requests. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8863"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const PLAYWRIGHT =
  arg("playwright", "") ||
  process.env.FINDOWS_PLAYWRIGHT_MODULE ||
  process.env.PLAYWRIGHT_MODULE ||
  "";
const BROWSER_PATH = process.env.FINDOWS_BROWSER_EXECUTABLE || "";

mkdirSync(OUT, { recursive: true });

let chromium;
try {
  ({ chromium } = loadPlaywright(PLAYWRIGHT || undefined));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

/* Static contract checks before launching the browser. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/block-drop.mjs"), "utf8");
const engineSource = readFileSync(resolve(ROOT, "findows/js/apps/block-drop-engine.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/block-drop.css"), "utf8");
const iconSource = readFileSync(resolve(ROOT, "findows/assets/icon-block-drop.svg"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("block-drop.mjs must export async function mount()");
}
for (const required of ["block-drop-engine.mjs", "./block-drop-engine.mjs", "createBlockDrop"]) {
  if (!moduleSource.includes(required)) throw new Error(`block-drop.mjs is missing ${required}`);
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource + engineSource)) {
  throw new Error("Block Drop must not use markup injection or dynamic code");
}
if (/\b(document|window|globalThis)\s*\.\s*addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("block-drop.mjs must not attach global listeners");
}
if (/\b(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|new\s+Audio\s*\()/.test(moduleSource + engineSource)) {
  throw new Error("Block Drop must not use network or audio APIs");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".bd-") && !line.startsWith("@") &&
    !/^(from|to|#fw-desktop|\d+(?:\.\d+)?%)$/.test(line.slice(0, -1).trim()));
if (badSelectors.length) throw new Error(`block-drop.css has unscoped selectors: ${badSelectors.join(" | ")}`);
if (!iconSource.trimStart().startsWith("<svg") || !iconSource.includes('viewBox="0 0 64 64"') ||
    /<script|onload=|href="https?:/i.test(iconSource)) {
  throw new Error("icon-block-drop.svg must be a local, original 64×64 SVG without scripts");
}
console.log("static checks: mount export, engine wiring, scoped CSS, local icon, no markup/global/network/audio PASS");

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
<title>Block Drop UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/block-drop.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-shell{padding:10px;width:100vw;height:100vh;box-sizing:border-box}
  .bd-host{width:100%;height:100%;margin:0 auto;border:1px solid rgba(255,255,255,.22);
    border-radius:14px;overflow:hidden}
  #app2{margin-top:10px}
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-shell">
    <div id="app" class="bd-host"></div>
    <div id="app2" class="bd-host" hidden></div>
  </div>
</div>
<script type="module">
  const [{ mount }] = await Promise.all([import("/findows/js/apps/block-drop.mjs")]);
  const services = Object.freeze({});
  window.__bdAbort = new AbortController();
  window.__bdHandle = await mount({
    container: document.getElementById("app"),
    windowId: "block-drop-test",
    fileId: null,
    services,
    signal: window.__bdAbort.signal,
  });
  window.__bdReady = true;
  window.__bdMountSecond = () => mount({
    container: document.getElementById("app2"),
    windowId: "block-drop-second",
    services,
    signal: new AbortController().signal,
  });
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__block-drop-harness.html") {
      response.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
      response.end(HARNESS_HTML);
      return;
    }
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204).end();
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
console.log(`block-drop browser harness serving ${ROOT} at ${BASE}`);

let step = 0;
const log = (message) => console.log(`[${String(++step).padStart(2, "0")}] ${message}`);
const ok = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`      PASS ${message}`);
};
const shot = (page, name) => page.screenshot({ path: resolve(OUT, name), fullPage: false });
const data = (page, key) => page.evaluate((name) => document.querySelector(".bd-app")?.dataset[name], key);
const pieceX = (page) => data(page, "x").then(Number);
const pieceRotation = (page) => data(page, "rotation").then(Number);
const pieceY = (page) => data(page, "y").then(Number);
const score = (page) => data(page, "score").then(Number);

const consoleErrors = [];
const badResponses = [];
const requests = [];
function watch(page) {
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
}

const browser = await chromium.launch({
  headless: true,
  ...(BROWSER_PATH ? { executablePath: BROWSER_PATH } : {}),
});
async function newContext(options = {}) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    window.__bdIntervals = new Set();
    const nativeSet = window.setInterval.bind(window);
    const nativeClear = window.clearInterval.bind(window);
    window.setInterval = (...args) => {
      const id = nativeSet(...args);
      window.__bdIntervals.add(id);
      return id;
    };
    window.clearInterval = (id) => {
      window.__bdIntervals.delete(id);
      return nativeClear(id);
    };
  });
  return context;
}
async function openHarness(page) {
  await page.goto(`${BASE}/__block-drop-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__bdReady === true, null, { timeout: 8000 });
}

try {
  log("mount contract, 10x20 board and live HUD");
  const desktop = await newContext({ viewport: { width: 1100, height: 820 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__bdHandle;
    return {
      canClose: typeof handle?.canClose,
      focus: typeof handle?.focus,
      dispose: typeof handle?.dispose,
      cells: document.querySelectorAll(".bd-cell").length,
      preview: document.querySelectorAll(".bd-preview-cell").length,
      pad: document.querySelectorAll(".bd-pad-btn").length,
      windowId: document.querySelector(".bd-app")?.dataset.windowId,
    };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
     `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok(shape.cells === 200, "the well renders exactly 200 cells");
  ok(shape.preview === 16, "the next-piece preview renders 16 cells");
  ok(shape.pad >= 5, "five or more touch controls are present");
  ok(shape.windowId === "block-drop-test", "the surface carries the window id");
  ok((await data(page, "phase")) === "playing", "the game starts live");
  ok((await page.locator(".bd-score").innerText()).trim().length > 0, "score HUD is readable");
  await shot(page, "block-drop-browser-desktop.png");

  log("keyboard: move, rotate, soft drop and hard drop");
  await page.locator(".bd-stage").focus();
  const x0 = await pieceX(page);
  await page.keyboard.press("ArrowLeft");
  ok((await pieceX(page)) === x0 - 1, "ArrowLeft moves the piece one column left");
  await page.keyboard.press("ArrowRight");
  ok((await pieceX(page)) === x0, "ArrowRight moves it back");
  const r0 = await pieceRotation(page);
  await page.keyboard.press("ArrowUp");
  ok((await pieceRotation(page)) === (r0 + 1) % 4, "ArrowUp rotates clockwise");
  await page.keyboard.press("KeyZ");
  ok((await pieceRotation(page)) === r0, "Z rotates counterclockwise");
  const y0 = await pieceY(page);
  const s0 = await score(page);
  await page.keyboard.press("ArrowDown");
  ok((await pieceY(page)) > y0 && (await score(page)) === s0 + 1,
     "ArrowDown soft-drops one row and awards one point");
  await page.keyboard.press("Space");
  const locked = await page.locator(".bd-cell--locked").count();
  ok(locked >= 4 && (await score(page)) > s0 + 1, "Space hard-drops, locks four cells and scores the fall");
  ok(Number.isFinite(await pieceY(page)), "a fresh piece is live after the lock");

  log("pause freezes the loop, resume restarts it, restart clears the board");
  await page.locator(".bd-pause").click();
  ok((await data(page, "phase")) === "paused", "Pause switches to the paused phase");
  ok((await page.evaluate(() => window.__bdIntervals.size)) === 0,
     "pausing clears the gravity interval");
  const pausedX = await pieceX(page);
  await page.keyboard.press("ArrowLeft");
  ok((await pieceX(page)) === pausedX, "no movement while paused");
  await page.locator(".bd-pause").click();
  ok((await data(page, "phase")) === "playing", "Resume returns to play");
  ok((await page.evaluate(() => window.__bdIntervals.size)) === 1,
     "resuming starts exactly one gravity interval");
  await page.locator(".bd-restart").click();
  ok((await score(page)) === 0 && (await data(page, "lines")) === "0", "New game clears score and lines");
  ok((await page.locator(".bd-cell--locked").count()) === 0, "New game clears the well");

  log("touch layout at 390x844 with 44px controls");
  const phone = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const sizes = await mp.locator(".bd-pad-btn, .bd-pause, .bd-restart").evaluateAll(
    (nodes) => nodes.filter((node) => node.getClientRects().length > 0).map((node) => node.getBoundingClientRect().height));
  ok(sizes.length >= 7 && sizes.every((height) => height >= 44),
     `compact controls are at least 44px (min ${Math.min(...sizes).toFixed(1)})`);
  ok(await mp.locator(".bd-stage").isVisible(), "the well is visible in portrait");
  const portraitFit = await mp.evaluate(() => {
    const app = document.querySelector(".bd-app");
    const edges = [...document.querySelectorAll(".bd-stage, .bd-side, .bd-badge, .bd-pad-btn, .bd-pause, .bd-restart")];
    return app.scrollWidth <= app.clientWidth + 1 && edges.every((node) => {
      const box = node.getBoundingClientRect();
      return box.left >= -1 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1;
    });
  });
  ok(portraitFit, "the well, preview and controls fit inside 390x844 without clipping");
  const tx0 = await pieceX(mp);
  await mp.locator('.bd-pad-btn[data-action="left"]').tap();
  ok((await pieceX(mp)) === tx0 - 1, "touch Left moves the piece");
  const tr0 = await pieceRotation(mp);
  await mp.locator('.bd-pad-btn[data-action="rotate"]').tap();
  ok((await pieceRotation(mp)) === (tr0 + 1) % 4, "touch Rotate rotates the piece");
  const ty0 = await pieceY(mp);
  await mp.locator('.bd-pad-btn[data-action="soft"]').tap();
  ok((await pieceY(mp)) > ty0, "touch Soft drop advances the piece");
  await shot(mp, "block-drop-browser-390x844.png");

  log("landscape layout at 844x390");
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.waitForTimeout(120);
  ok(await mp.locator(".bd-stage").isVisible(), "the well stays visible in short landscape");
  const landscapeFit = await mp.evaluate(() => {
    const nodes = [...document.querySelectorAll(".bd-stage, .bd-pad-btn, .bd-pause, .bd-restart")];
    return nodes.every((node) => {
      const box = node.getBoundingClientRect();
      return box.top >= -1 && box.bottom <= window.innerHeight + 1;
    });
  });
  ok(landscapeFit, "the well and every control fit fully inside 844x390");
  await shot(mp, "block-drop-browser-844x390.png");
  await phone.close();

  log("dispose and abort clear every timer and remove the surface");
  const beforeAbort = await page.evaluate(() => window.__bdIntervals.size);
  ok(beforeAbort === 1, `one interval is live before abort (${beforeAbort})`);
  await page.evaluate(() => window.__bdAbort.abort());
  ok((await page.locator("#app .bd-app").count()) === 0, "abort removes the app surface");
  ok((await page.evaluate(() => window.__bdIntervals.size)) === 0, "abort clears the gravity interval");
  await page.evaluate(() => window.__bdHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok((await page.evaluate(() => window.__bdHandle.canClose())) === true, "canClose stays true after dispose");

  log("zero external requests, console errors and failed responses");
  const external = requests.filter((url) => !url.startsWith(BASE) && !url.startsWith("data:"));
  ok(external.length === 0, `zero external requests (${external.join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  log("ALL BLOCK DROP BROWSER CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`BLOCK DROP BROWSER CHECK FAILED: ${error.message}`);
  if (consoleErrors.length) console.error(`console/page errors: ${consoleErrors.join(" | ")}`);
  if (badResponses.length) console.error(`failed responses: ${badResponses.join(" | ")}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
