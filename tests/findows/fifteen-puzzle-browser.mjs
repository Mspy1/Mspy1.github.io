/* Focused Fifteen Puzzle UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/fifteen-puzzle-browser.mjs [--port=8867] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8867 and mounts the production module with a
   minimal injected services object because the shell registry is parent-owned. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";
import { isSolvable, SOLVED_TILES } from "../../findows/js/apps/fifteen-puzzle-engine.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8867"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.FINDOWS_PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const ONE_MOVE_AWAY = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 13, 14, 15, 12,
]);
/** Documented F6 repro: permutation-shaped but parity-impossible. */
const UNSOLVABLE = Object.freeze([
  2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0,
]);

/* Static contract checks before the browser: fail fast on a missing lane. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/fifteen-puzzle.mjs"), "utf8");
const engineSource = readFileSync(resolve(ROOT, "findows/js/apps/fifteen-puzzle-engine.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/fifteen-puzzle.css"), "utf8");
const iconSource = readFileSync(resolve(ROOT, "findows/assets/icon-fifteen-puzzle.svg"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("fifteen-puzzle.mjs must export async function mount()");
}
for (const needed of ["fifteen-puzzle-engine.mjs", "moveTile", "moveBlank", "touchstart", "touchend"]) {
  if (!moduleSource.includes(needed)) throw new Error(`fifteen-puzzle.mjs is missing ${needed}`);
}
for (const banned of ["innerHTML", "outerHTML", "eval(", "new Function(", "fetch(", "XMLHttpRequest"]) {
  if (moduleSource.includes(banned) || engineSource.includes(banned)) {
    throw new Error(`module/engine must not use ${banned}`);
  }
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("fifteen-puzzle.mjs must not register document/window listeners");
}
if (!/clearInterval\s*\(/.test(moduleSource)) {
  throw new Error("fifteen-puzzle.mjs must clear its interval on win/dispose");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".fp-") && !line.startsWith("@") &&
    !/^(from|to|\d+(?:\.\d+)?%)$/.test(line.slice(0, -1).trim()));
if (badSelectors.length) throw new Error(`fifteen-puzzle.css has unscoped selectors: ${badSelectors.join(" | ")}`);
if (!iconSource.trimStart().startsWith("<svg") || !iconSource.includes('viewBox="0 0 64 64"') ||
    /<script|onload=|href="https?:/i.test(iconSource)) {
  throw new Error("icon-fifteen-puzzle.svg must be a local, original 64×64 SVG without scripts");
}
console.log("static checks: mount export, engine wiring, no markup/dynamic-code/network, no global listeners, interval cleanup, scoped CSS, local icon PASS");

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
<title>Fifteen Puzzle UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/fifteen-puzzle.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-shell{padding:12px}
  .fp-host{width:min(560px,calc(100vw - 24px));height:min(620px,calc(100vh - 36px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  #app2{margin-top:12px}
  @media (max-width:600px),(max-height:499px){
    .fp-host{width:calc(100vw - 20px);height:min(620px,calc(100vh - 20px))}
    #app2{margin-top:8px}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-shell">
    <div id="app" class="fp-host"></div>
    <div id="app2" class="fp-host" hidden></div>
  </div>
</div>
<script type="module">
  // Instrument from here on so only the app under test is tracked, not the test runner.
  window.__fpTimers = new Set();
  const nativeSet = window.setInterval.bind(window);
  const nativeClear = window.clearInterval.bind(window);
  window.setInterval = (...args) => {
    const id = nativeSet(...args);
    window.__fpTimers.add(id);
    return id;
  };
  window.clearInterval = (id) => {
    window.__fpTimers.delete(id);
    return nativeClear(id);
  };
  window.__fpListeners = [];
  const nativeAdd = EventTarget.prototype.addEventListener;
  const nativeRemove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    window.__fpListeners.push({ target: this, type, fn });
    return nativeAdd.call(this, type, fn, options);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, options) {
    window.__fpListeners = window.__fpListeners.filter(
      (entry) => !(entry.target === this && entry.type === type && entry.fn === fn));
    return nativeRemove.call(this, type, fn, options);
  };
  // Ignore the test runner's own document/window instrumentation.
  const isRunnerListener = (entry) => {
    const source = String(entry.fn);
    return source.includes("_hitTargetInterceptor") || source.includes("__playwright") ||
      source.includes("seenEvent") || String(entry.type).startsWith("__playwright");
  };
  window.__fpLiveListeners = () => window.__fpListeners.filter((entry) =>
    entry.target instanceof Element && entry.target.isConnected === true &&
    Boolean(entry.target.closest(".fp-app")) && !isRunnerListener(entry)).length;
  window.__fpGlobalListeners = () => window.__fpListeners.filter((entry) =>
    (entry.target === window || entry.target === document) && !isRunnerListener(entry)).length;

  const { mount } = await import("/findows/js/apps/fifteen-puzzle.mjs");
  const controller = new AbortController();
  window.__fpAbort = controller;
  window.__fpHandle = await mount({
    container: document.getElementById("app"),
    windowId: "fifteen-puzzle-ui-test",
    fileId: null,
    services: {},
    signal: controller.signal,
  });
  window.__fpMount = (options = {}) => {
    document.getElementById("app2").hidden = false;
    return mount({
      container: document.getElementById("app2"),
      windowId: "fifteen-puzzle-ui-second",
      fileId: null,
      services: {},
      signal: new AbortController().signal,
      ...options,
    });
  };
  window.__fpReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__fifteen-puzzle-harness.html") {
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
console.log(`fifteen-puzzle UI harness serving ${ROOT} at ${BASE}`);

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
    if (!request.url().startsWith(BASE)) externalRequests.push(request.url());
  });
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true });
async function newContext(options = {}) {
  return browser.newContext(options);
}
async function openHarness(page) {
  await page.goto(`${BASE}/__fifteen-puzzle-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__fpReady === true, null, { timeout: 5000 });
}
const text = (page, selector) => page.locator(selector).innerText();
async function readBoard(page, root = "#app") {
  return page.evaluate((root) => Array.from(document.querySelectorAll(`${root} .fp-tile`))
    .map((button) => button.textContent.trim() === "" ? 0 : Number(button.textContent.trim())), root);
}
function blankIndex(tiles) { return tiles.indexOf(0); }
function neighborsOf(index) {
  const row = Math.floor(index / 4);
  const col = index % 4;
  const result = [];
  if (row > 0) result.push(index - 4);
  if (row < 3) result.push(index + 4);
  if (col > 0) result.push(index - 1);
  if (col < 3) result.push(index + 1);
  return result;
}
function legalTile(tiles) { return neighborsOf(blankIndex(tiles))[0]; }
function legalDirection(tiles) {
  const index = blankIndex(tiles);
  const row = Math.floor(index / 4);
  const col = index % 4;
  if (row < 3) return "down";
  if (row > 0) return "up";
  if (col < 3) return "right";
  return "left";
}
const ARROW = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
const parseMoves = (value) => Number(String(value).trim().match(/^(\d+)/)[1]);

try {
  log("mount contract, solvable shuffled board and 4-column layout");
  const desktop = await newContext({ viewport: { width: 1280, height: 860 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__fpHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
     `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  const initial = await readBoard(page);
  ok(initial.length === 16 && [...initial].sort((a, b) => a - b).every((value, index) => value === index),
     `16 tiles hold exactly 0..15 (${initial.join(",")})`);
  ok(isSolvable(initial), "the shuffled board is solvable by the engine's parity rule");
  ok((await page.locator("#app .fp-tile").count()) === 16, "the board renders 16 tile buttons");
  const tracks = await page.locator("#app .fp-board").evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  ok(tracks === 4, `board has four equal grid columns (${tracks})`);
  ok((await text(page, "#app .fp-moves")) === "0 moves" && (await text(page, "#app .fp-timer")) === "0:00",
     "move counter and timer start at zero");
  ok((await page.evaluate(() => window.__fpGlobalListeners())) === 0, "no app-owned document/window listeners were registered");
  await shot(page, "fifteen-puzzle-desktop.png");

  log("tile click slides into the gap, counts a move and starts the timer");
  const target = legalTile(initial);
  await page.click(`#app .fp-tile[data-index="${target}"]`);
  const afterClick = await readBoard(page);
  ok(parseMoves(await text(page, "#app .fp-moves")) === 1, "one legal click counts exactly one move");
  ok(afterClick[target] === 0 && afterClick[blankIndex(initial)] === initial[target],
     "the clicked tile and the gap swapped positions in the DOM");
  ok((await text(page, "#app .fp-status")).includes("1 move"), "the status announces the move count");
  ok((await page.evaluate(() => window.__fpTimers.size)) === 1, "the timer interval is running after the first move");
  const newBlank = blankIndex(afterClick);
  const nonAdjacent = Array.from({ length: 16 }, (_, index) => index)
    .find((index) => index !== newBlank && !neighborsOf(newBlank).includes(index));
  await page.click(`#app .fp-tile[data-index="${nonAdjacent}"]`);
  ok(parseMoves(await text(page, "#app .fp-moves")) === 1, "a non-adjacent tile is an ignored no-op");
  await shot(page, "fifteen-puzzle-playing.png");

  log("keyboard arrows move the gap, Enter activates a tile and R restarts");
  const beforeArrow = await readBoard(page);
  await page.locator(`#app .fp-tile[data-index="${blankIndex(beforeArrow)}"]`).focus();
  await page.keyboard.press(ARROW[legalDirection(beforeArrow)]);
  ok(parseMoves(await text(page, "#app .fp-moves")) === 2, "an arrow key slides the gap and counts a move");
  const beforeEnter = await readBoard(page);
  await page.locator(`#app .fp-tile[data-index="${legalTile(beforeEnter)}"]`).focus();
  await page.keyboard.press("Enter");
  ok(parseMoves(await text(page, "#app .fp-moves")) === 3, "Enter activates the focused tile");
  await page.keyboard.press("r");
  ok((await text(page, "#app .fp-moves")) === "0 moves" && (await text(page, "#app .fp-timer")) === "0:00" &&
     (await page.evaluate(() => window.__fpTimers.size)) === 0,
     "R restarts the game and clears both move count and timer");

  log("win detection fires at the ordered state and freezes further play");
  await page.evaluate(() => document.getElementById("app2").hidden = false);
  await page.evaluate(async (tiles) => { window.__fpSecond = await window.__fpMount({ tiles }); }, [...ONE_MOVE_AWAY]);
  await page.waitForFunction(() => Boolean(window.__fpSecond), null, { timeout: 5000 });
  ok((await page.locator("#app2 .fp-app").getAttribute("data-phase")) === "playing", "a one-move board starts in playing phase");
  await page.click('#app2 .fp-tile[data-index="15"]');
  ok((await page.locator("#app2 .fp-app").getAttribute("data-phase")) === "won", "sliding tile 12 home wins the game");
  ok((await text(page, "#app2 .fp-status")).includes("Solved in 1 move"),
     `the win banner reports the result (${await text(page, "#app2 .fp-status")})`);
  ok((await text(page, "#app2 .fp-moves")) === "1 move" &&
     (await page.evaluate(() => window.__fpTimers.size)) === 0,
     "winning stops the timer and keeps the final move count");
  const wonBoard = await readBoard(page, "#app2");
  await page.click('#app2 .fp-tile[data-index="0"]');
  ok(JSON.stringify(await readBoard(page, "#app2")) === JSON.stringify(wonBoard) &&
     (await text(page, "#app2 .fp-moves")) === "1 move", "a won board ignores later slides");
  ok(JSON.stringify(wonBoard) === JSON.stringify([...SOLVED_TILES]), "the won board is exactly the ordered goal");
  await shot(page, "fifteen-puzzle-won.png");
  await page.evaluate(() => window.__fpSecond.dispose());

  await page.evaluate(async (tiles) => { window.__fpThird = await window.__fpMount({ tiles }); }, [...SOLVED_TILES]);
  ok((await page.locator("#app2 .fp-app").getAttribute("data-phase")) === "won",
     "an explicitly ordered board is detected as won immediately");
  await page.evaluate(() => window.__fpThird.dispose());

  const rejected = await page.evaluate(async (tiles) => {
    try {
      await window.__fpMount({ tiles });
      return "accepted";
    } catch (error) {
      return error.name;
    }
  }, [...UNSOLVABLE]);
  ok(rejected === "RangeError", `an injected unsolvable board is rejected before mounting (${rejected})`);
  ok((await page.locator("#app2 .fp-app").count()) === 0, "the rejected game installs no UI surface");
  ok((await page.evaluate(() => window.__fpTimers.size)) === 0, "the rejected game starts no timer");
  await page.evaluate(() => document.getElementById("app2").hidden = true);

  log("touch layout at 390×844: tap and swipe both slide tiles");
  const phone = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  ok(await mp.locator("#app .fp-board").isVisible(), "the board is visible on a 390×844 phone");
  const tileHeights = await mp.locator("#app .fp-tile").evaluateAll(
    (nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  ok(Math.min(...tileHeights) >= 44, `touch targets are at least 44px (min ${Math.min(...tileHeights).toFixed(1)})`);
  const phoneBoard = await readBoard(mp);
  await mp.tap(`#app .fp-tile[data-index="${legalTile(phoneBoard)}"]`);
  ok(parseMoves(await text(mp, "#app .fp-moves")) === 1, "tapping a tile slides it on touch devices");
  const beforeSwipe = await readBoard(mp);
  const direction = legalDirection(beforeSwipe);
  const boardBox = await mp.locator("#app .fp-board").boundingBox();
  await mp.evaluate(({ x, y, direction }) => {
    const board = document.querySelector("#app .fp-board");
    const delta = direction === "down" ? [0, 48] : direction === "up" ? [0, -48]
      : direction === "right" ? [48, 0] : [-48, 0];
    const touchAt = (cx, cy) => new Touch({ identifier: 1, target: board, clientX: cx, clientY: cy });
    const start = touchAt(x, y);
    const end = touchAt(x + delta[0], y + delta[1]);
    board.dispatchEvent(new TouchEvent("touchstart", { touches: [start], changedTouches: [start], bubbles: true, cancelable: true }));
    board.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [end], bubbles: true, cancelable: true }));
  }, { x: boardBox.x + boardBox.width / 2, y: boardBox.y + boardBox.height / 2, direction });
  ok(parseMoves(await text(mp, "#app .fp-moves")) === 2, `a swipe toward the gap slides a tile (${direction})`);
  await shot(mp, "fifteen-puzzle-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator("#app .fp-board").isVisible() && await mp.locator("#app .fp-new").isVisible(),
     "short landscape 844×390 keeps the board and New game reachable");
  await shot(mp, "fifteen-puzzle-landscape-844x390.png");
  await phone.close();

  log("dispose clears the interval, listeners and surface; zero external requests");
  const beforeCleanup = await readBoard(page);
  await page.click(`#app .fp-tile[data-index="${legalTile(beforeCleanup)}"]`);
  const beforeDispose = await page.evaluate(() => ({
    timers: window.__fpTimers.size,
    live: window.__fpLiveListeners(),
  }));
  await page.evaluate(() => window.__fpAbort.abort());
  ok((await page.locator("#app .fp-app").count()) === 0, "abort removes the app surface");
  ok((await page.evaluate(() => window.__fpTimers.size)) === 0,
     `abort clears every interval (${beforeDispose.timers} active before)`);
  ok((await page.evaluate(() => window.__fpLiveListeners())) === 0,
     `abort removes every DOM listener (${beforeDispose.live} live before)`);
  await page.evaluate(() => window.__fpHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);
  log("ALL FIFTEEN PUZZLE UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`FIFTEEN PUZZLE UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
