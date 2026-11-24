/* Focused Game of Life UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/browser/game-of-life-ui.mjs [--port=8868] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8868 and mounts the production app module in a
   minimal harness because the shell registry is owned by another lane. The real
   engine drives every assertion; Math.random is made deterministic before load. */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8868"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks fail fast when the lane's files are missing. */
const modulePath = resolve(ROOT, "findows/js/apps/game-of-life.mjs");
const cssPath = resolve(ROOT, "findows/styles/game-of-life.css");
const iconPath = resolve(ROOT, "findows/assets/icon-game-of-life.svg");
const enginePath = resolve(ROOT, "findows/js/apps/game-of-life-engine.mjs");
if (!existsSync(enginePath)) throw new Error("findows/js/apps/game-of-life-engine.mjs must exist");
if (!existsSync(modulePath)) throw new Error("findows/js/apps/game-of-life.mjs must exist");
if (!existsSync(cssPath)) throw new Error("findows/styles/game-of-life.css must exist");
if (!existsSync(iconPath)) throw new Error("findows/assets/icon-game-of-life.svg must exist");
const moduleSource = readFileSync(modulePath, "utf8");
const cssSource = readFileSync(cssPath, "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("game-of-life.mjs must export async function mount()");
}
if (!/from\s+["']\.\/game-of-life-engine\.mjs["']/.test(moduleSource)) {
  throw new Error("game-of-life.mjs must import the real game-of-life-engine.mjs");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("game-of-life.mjs must not register window/document listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("game-of-life.mjs must not use markup injection or dynamic code");
}
if (/\b(fetch\s*\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon)/.test(moduleSource)) {
  throw new Error("game-of-life.mjs must make no network requests");
}
if (/(^|\n)\s*(html|body|\*|:root)\s*\{/.test(cssSource)) {
  throw new Error("game-of-life.css must not style global selectors");
}
if (!/\.gol-app\s*\{/.test(cssSource)) throw new Error("game-of-life.css must define .gol-app styles");
console.log("static checks: mount export, real engine import, icon, app-scoped CSS, no global listeners, no injection, no network PASS");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

/* Instrument the timer so cleanup is observable, and fix RNG for randomize. */
const HARNESS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Game of Life UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/game-of-life.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{padding:12px}
  .harness-host{width:min(760px,calc(100vw - 24px));height:min(680px,calc(100vh - 84px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  @media (max-width:600px){
    .harness-host{width:calc(100vw - 20px);height:min(680px,calc(100vh - 84px))}
  }
  @media (max-height:499px){
    .harness-bar{display:none}
    .harness-shell{padding:6px}
    .harness-host{width:calc(100vw - 12px);height:calc(100vh - 12px)}
  }
</style>
<script>
  (function () {
    var realSet = window.setInterval.bind(window);
    var realClear = window.clearInterval.bind(window);
    window.__activeIntervals = new Set();
    window.setInterval = function (fn, ms) {
      var id = realSet(fn, ms); window.__activeIntervals.add(id); return id;
    };
    window.clearInterval = function (id) {
      window.__activeIntervals.delete(id); return realClear(id);
    };
    var randomIndex = 0;
    Math.random = function () { return (randomIndex++ % 10) / 10; };
  })();
</script>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar">
    <button id="outside" type="button">Outside control</button>
    <span>Focus here to prove the Game of Life keyboard is scoped</span>
  </div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { mount } from "/findows/js/apps/game-of-life.mjs";
  const controller = new AbortController();
  window.__golAbort = controller;
  window.__golHandle = await mount({
    container: document.getElementById("app"),
    windowId: "game-of-life-ui-test",
    fileId: null,
    services: {},
    signal: controller.signal,
  });
  window.__golReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__game-of-life-ui-harness.html") {
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
console.log(`game-of-life UI harness serving ${ROOT} at ${BASE}`);

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
    if (!url.startsWith(BASE) && !url.startsWith("data:")) externalRequests.push(url);
  });
}

async function openHarness(page) {
  await page.goto(`${BASE}/__game-of-life-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__golReady === true, null, { timeout: 5000 });
}
const cell = (page, index) => page.locator(`.gol-cell[data-index="${index}"]`);
const generation = (page) => page.locator(".gol-generation").innerText();
const population = (page) => page.locator(".gol-population").innerText();
const running = (page) => page.locator(".gol-app").getAttribute("data-running");
const aliveIndices = (page) => page.locator(".gol-cell--alive").evaluateAll((nodes) =>
  nodes.map((node) => Number(node.dataset.index)).sort((a, b) => a - b));
const activeIntervals = (page) => page.evaluate(() => window.__activeIntervals.size);

const GLIDER_START = [44, 65, 83, 84, 85];
const GLIDER_AFTER_4 = [65, 86, 104, 105, 106];

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, 20x14 grid and initial controls");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__golHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await page.locator(".gol-app").count()) === 1 &&
     (await page.locator(".gol-app").getAttribute("data-window-id")) === "game-of-life-ui-test",
    "the app root is mounted with its window id");
  ok((await page.locator(".gol-cell").count()) === 280, "the board has exactly 20 × 14 = 280 cells");
  ok((await generation(page)) === "0" && (await population(page)) === "0" && (await running(page)) === "false",
    "a fresh world is generation 0, empty and paused");
  ok((await page.locator(".gol-play").getAttribute("aria-pressed")) === "false" &&
     (await page.locator(".gol-wrap").getAttribute("aria-pressed")) === "false",
    "play and wrap start off with accessible pressed states");
  ok((await page.locator(".gol-preset option").count()) === 9 &&
     (await page.locator(".gol-speed option").count()) === 3,
    "preset and speed selects are populated");
  ok((await page.locator(".gol-message").getAttribute("role")) === "status" &&
     (await page.locator(".gol-message").getAttribute("aria-live")) === "polite",
    "status message is a polite live region");
  await shot(page, "game-of-life-ui-desktop-dark.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(180);
  await shot(page, "game-of-life-ui-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  log("ACCEPTANCE: glider shifts one row/column after four steps");
  await page.locator(".gol-preset").selectOption("glider");
  ok(JSON.stringify(await aliveIndices(page)) === JSON.stringify(GLIDER_START) &&
     (await population(page)) === "5" && (await generation(page)) === "0",
    "glider preset loads five cells at generation 0");
  ok((await cell(page, 44).getAttribute("aria-label")).includes("alive"), "a live cell is announced as alive");
  for (let i = 0; i < 4; i += 1) await page.locator(".gol-step").click();
  ok(JSON.stringify(await aliveIndices(page)) === JSON.stringify(GLIDER_AFTER_4),
    "the same glider shape sits one row down and one column right after four steps");
  ok((await generation(page)) === "4" && (await population(page)) === "5",
    "generation and population track the stepped world");
  await shot(page, "game-of-life-ui-glider-stepped.png");
  await cell(page, 65).focus();
  await page.keyboard.press(".");
  ok((await generation(page)) === "5", "the period key steps from the keyboard too");

  log("play/pause and speed change own exactly one timer");
  await page.locator(".gol-clear").click();
  await page.locator(".gol-speed").selectOption("600");
  await page.locator(".gol-play").click();
  ok((await running(page)) === "true" && (await activeIntervals(page)) === 1 &&
     (await page.locator(".gol-play").getAttribute("aria-pressed")) === "true",
    "play starts one interval and exposes running state");
  await page.waitForTimeout(720);
  ok(Number(await generation(page)) >= 1, "the generation clock advances while playing");
  await page.locator(".gol-play").click();
  const pausedAt = await generation(page);
  ok((await running(page)) === "false" && (await activeIntervals(page)) === 0,
    "pause clears the timer");
  await page.waitForTimeout(420);
  ok((await generation(page)) === pausedAt, "no generation advances after pause");
  await page.locator(".gol-play").click();
  await page.locator(".gol-speed").selectOption("90");
  ok((await running(page)) === "true" && (await activeIntervals(page)) === 1,
    "changing speed while running restarts a single timer");
  await page.locator(".gol-clear").click();
  ok((await running(page)) === "false" && (await activeIntervals(page)) === 0 &&
     (await generation(page)) === "0", "clear stops the timer and resets the clock");

  log("wrap toggle changes edge births; randomize is deterministic");
  await page.locator(".gol-wrap").click();
  ok((await page.locator(".gol-wrap").getAttribute("aria-pressed")) === "true" &&
     (await page.locator(".gol-app").getAttribute("data-wrap")) === "true",
    "wrap is on with an accessible pressed state");
  for (const index of [100, 139, 80]) await cell(page, index).click();
  await page.locator(".gol-step").click();
  ok((await cell(page, 119).getAttribute("aria-label")).includes("alive"),
    "with wrap, three edge neighbors birth a cell across the seam");
  await shot(page, "game-of-life-ui-wrap-on.png");
  await page.locator(".gol-clear").click();
  await page.locator(".gol-wrap").click();
  for (const index of [100, 139, 80]) await cell(page, index).click();
  await page.locator(".gol-step").click();
  ok((await cell(page, 119).getAttribute("aria-label")).includes("dead"),
    "without wrap, the same bounded edge cell stays dead");
  await page.locator(".gol-random").click();
  ok(Number(await population(page)) > 0 && Number(await population(page)) < 280 &&
     (await generation(page)) === "0", "randomize fills part of the world and resets the clock");
  await page.locator(".gol-clear").click();
  ok((await population(page)) === "0", "clear empties the world");

  log("keyboard editing, presets and shortcuts stay scoped to the app");
  await cell(page, 42).focus();
  await page.keyboard.press("ArrowRight");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "43",
    "ArrowRight moves focus one column right");
  await page.keyboard.press("ArrowDown");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "63",
    "ArrowDown moves focus one row down");
  await page.keyboard.press("Home");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "60",
    "Home moves to the first column of the row");
  await page.keyboard.press("End");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "79",
    "End moves to the last column of the row");
  await cell(page, 42).focus();
  await page.keyboard.press("Enter");
  ok((await cell(page, 42).getAttribute("aria-label")).includes("alive"), "Enter toggles the focused cell alive");
  await page.keyboard.press("Space");
  ok((await cell(page, 42).getAttribute("aria-label")).includes("dead"), "Space toggles it back once");
  await page.keyboard.press("g");
  ok((await population(page)) === "5", "G loads the glider preset");
  await page.keyboard.press(".");
  ok((await generation(page)) === "1", "period steps one generation");
  await page.keyboard.press("c");
  ok((await population(page)) === "0" && (await generation(page)) === "0", "C clears the world");
  await page.keyboard.press("r");
  ok(Number(await population(page)) > 0, "R randomizes the world");
  await page.keyboard.press("p");
  ok((await running(page)) === "true", "P starts playback");
  await page.keyboard.press("p");
  ok((await running(page)) === "false" && (await activeIntervals(page)) === 0, "P pauses playback");
  await page.locator(".gol-random").click();
  const beforeSelect = await population(page);
  await page.locator(".gol-preset").focus();
  await page.keyboard.press("c");
  ok((await population(page)) === beforeSelect, "shortcuts are ignored while a select has focus");

  log("typing outside the app cannot reach it");
  await page.locator("#outside").focus();
  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await page.keyboard.press("p");
  await page.keyboard.press(".");
  ok((await running(page)) === "false" && (await population(page)) === beforeSelect &&
     Number(await generation(page)) === 0, "outside focus receives no Game of Life shortcuts");

  log("390x844 touch layout and 844x390 landscape layout");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const compact = await mp.evaluate(() => {
    const board = document.querySelector(".gol-board").getBoundingClientRect();
    const host = document.querySelector(".harness-host").getBoundingClientRect();
    const sizes = [...document.querySelectorAll(".gol-cell")].map((node) => node.getBoundingClientRect().width);
    return { boardWidth: board.width, hostWidth: host.width, boardLeft: board.left, hostLeft: host.left,
      min: Math.min(...sizes), max: Math.max(...sizes) };
  });
  ok(compact.boardWidth <= compact.hostWidth && compact.boardLeft >= compact.hostLeft - 1 && compact.min >= 14,
    `compact board fits the 390px host with usable cells (${JSON.stringify(compact)})`);
  await cell(mp, 42).tap();
  ok((await cell(mp, 42).getAttribute("aria-label")).includes("alive"),
    "a plain tap edits a cell, no long press needed");
  await shot(mp, "game-of-life-ui-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.waitForTimeout(80);
  const landscape = await mp.evaluate(() => {
    const board = document.querySelector(".gol-board").getBoundingClientRect();
    const host = document.querySelector(".harness-host").getBoundingClientRect();
    const sizes = [...document.querySelectorAll(".gol-cell")].map((node) => node.getBoundingClientRect().height);
    return { boardBottom: board.bottom, hostBottom: host.bottom, min: Math.min(...sizes) };
  });
  ok(landscape.boardBottom <= landscape.hostBottom + 1 && landscape.min >= 12,
    `short landscape keeps the whole board usable (${JSON.stringify(landscape)})`);
  await shot(mp, "game-of-life-ui-landscape-844x390.png");
  await phone.close();

  log("dispose clears a running timer; no external requests or errors");
  await page.locator(".gol-play").click();
  ok((await activeIntervals(page)) === 1, "playback is running before dispose");
  await page.evaluate(() => window.__golHandle.dispose());
  ok((await activeIntervals(page)) === 0 && (await page.locator(".gol-app").count()) === 0,
    "dispose clears the timer and removes the surface");
  await page.evaluate(() => window.__golHandle.dispose());
  ok(true, "a second dispose() is safe");
  await page.evaluate(() => window.__golAbort.abort());
  ok(true, "aborting after dispose is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);

  log("ALL GAME OF LIFE UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`GAME OF LIFE UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
