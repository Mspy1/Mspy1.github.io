/* Focused Snake UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/snake-browser.mjs [--port=8862] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8862 and mounts the production module in a
   minimal harness because the shell registry is owned by the parent lane.
   Math.random is pinned to 0 before the module loads so food is always (0,0),
   well away from the snake's opening row; setInterval is spied to prove timer
   teardown. The game clock is slowed through services.snakeTickMs. */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8862"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE || process.env.FINDOWS_PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks run before the browser so a missing app fails fast. */
const modulePath = resolve(ROOT, "findows/js/apps/snake.mjs");
const cssPath = resolve(ROOT, "findows/styles/snake.css");
const iconPath = resolve(ROOT, "findows/assets/icon-snake.svg");
const enginePath = resolve(ROOT, "findows/js/apps/snake-engine.mjs");
if (!existsSync(enginePath)) throw new Error("the real snake-engine.mjs must exist");
if (!existsSync(iconPath)) throw new Error("findows/assets/icon-snake.svg must exist");
if (!existsSync(modulePath)) throw new Error("the real snake.mjs must exist");
const moduleSource = readFileSync(modulePath, "utf8");
const cssSource = readFileSync(cssPath, "utf8");
const iconSource = readFileSync(iconPath, "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("snake.mjs must export async function mount()");
}
if (!/from\s+["']\.\/snake-engine\.mjs["']/.test(moduleSource)) {
  throw new Error("snake.mjs must import the real snake-engine.mjs");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("snake.mjs must not register window/document listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("snake.mjs must not use markup injection or dynamic code");
}
if (/addEventListener\s*\(\s*["']touch(start|move|end|cancel)["']|longPress|LONG_PRESS/.test(moduleSource)) {
  throw new Error("snake.mjs must use a plain direction pad instead of touch timers/long press");
}
if (/(^|\n)\s*(html|body|\*|:root)\s*\{/.test(cssSource)) {
  throw new Error("snake.css must not style global selectors");
}
if (!/\.snake-app\s*\{/.test(cssSource)) throw new Error("snake.css must define .snake-app styles");
if (!/<svg[\s\S]*<\/svg>/.test(iconSource) || /<image|<use\s+href|\bhttp:\/\/www\.(w3|w3c)/.test(iconSource.replace("http://www.w3.org/2000/svg", ""))) {
  throw new Error("icon-snake.svg must be an original inline SVG with no embedded/remote images");
}
console.log("static checks: mount export, real engine import, icon, no global listeners, no long press, app-scoped CSS PASS");

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
<title>Snake UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/snake.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{padding:12px}
  .harness-host{width:min(720px,calc(100vw - 24px));height:min(680px,calc(100vh - 84px));margin:0 auto;
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
    window.__rngValues = [0];
    window.__rngIndex = 0;
    Math.random = function () { return window.__rngValues[window.__rngIndex++ % 1]; };
    window.__intervals = new Set();
    var realSet = window.setInterval.bind(window);
    var realClear = window.clearInterval.bind(window);
    window.setInterval = function (fn, ms) { var id = realSet(fn, ms); window.__intervals.add(id); return id; };
    window.clearInterval = function (id) { window.__intervals.delete(id); return realClear(id); };
  })();
</script>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar">
    <button id="outside" type="button">Outside control</button>
    <span>Focus here to prove the Snake keyboard is scoped</span>
  </div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { mount } from "/findows/js/apps/snake.mjs";
  const controller = new AbortController();
  window.__snakeAbort = controller;
  window.__snakeHandle = await mount({
    container: document.getElementById("app"),
    windowId: "snake-ui-test",
    fileId: null,
    services: { snakeTickMs: 120 },
    signal: controller.signal,
  });
  window.__snakeReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__snake-ui-harness.html") {
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
console.log(`snake UI harness serving ${ROOT} at ${BASE}`);

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
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") externalRequests.push(request.url());
  });
}

async function openHarness(page) {
  await page.goto(`${BASE}/__snake-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__snakeReady === true, null, { timeout: 5000 });
}
const root = (page) => page.locator(".snake-app");
const phase = (page) => root(page).getAttribute("data-phase");
const direction = (page) => root(page).getAttribute("data-direction");
const head = (page) => root(page).getAttribute("data-head");
const tick = async (page) => Number(await root(page).getAttribute("data-tick"));
const score = async (page) => Number(await root(page).getAttribute("data-score"));
const intervals = (page) => page.evaluate(() => window.__intervals.size);

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, grid, pad and scoped layout at desktop size");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__snakeHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await root(page).count()) === 1 &&
     (await root(page).getAttribute("data-window-id")) === "snake-ui-test",
    "the app root is mounted with its window id");
  ok((await page.locator(".snake-cell").count()) === 225, "board is a 15x15 grid (225 cells)");
  ok((await page.locator(".snake-pad button").count()) === 4, "direction pad has four buttons");
  ok((await page.locator(".snake-start").innerText()).includes("Start"), "start control is labelled Start while ready");
  ok((await page.locator(".snake-message").getAttribute("role")) === "status" &&
     (await page.locator(".snake-message").getAttribute("aria-live")) === "polite",
    "message is a polite live status region");
  const readyView = { phase: await phase(page), score: await score(page),
    head: await page.locator(".snake-cell--head").count(),
    food: await page.locator(".snake-cell--food").count(),
    phaseAttr: await root(page).getAttribute("data-phase") };
  ok(readyView.phase === "ready" && readyView.score === 0 && readyView.head === 1 && readyView.food === 1,
    `ready board renders one head and one food with zero score (${JSON.stringify(readyView)})`);
  ok((await page.locator(".snake-heading").innerText()).includes("15 × 15"), "subtitle shows the grid size");
  await shot(page, "snake-ui-desktop-dark.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(180);
  await shot(page, "snake-ui-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  log("keyboard arrows and WASD steer in ready phase; reversals are ignored");
  await root(page).focus();
  await page.keyboard.press("ArrowUp");
  ok((await direction(page)) === "up", "ArrowUp turns the snake up");
  await page.keyboard.press("a");
  ok((await direction(page)) === "left", "A turns the snake left");
  await page.keyboard.press("s");
  ok((await direction(page)) === "down", "S turns the snake down");
  await page.keyboard.press("d");
  ok((await direction(page)) === "right", "D turns the snake right");
  await page.keyboard.press("ArrowDown");
  ok((await direction(page)) === "down", "ArrowDown turns the snake down");
  await page.keyboard.press("w");
  ok((await direction(page)) === "down", "W (opposite of down) is ignored, preventing reversal");

  log("touch direction pad works with plain taps (no long press)");
  await page.locator(".snake-pad-right").click();
  ok((await direction(page)) === "right", "tapping Right turns the snake right");
  await page.locator(".snake-pad-up").click();
  ok((await direction(page)) === "up", "tapping Up turns the snake up");
  await page.locator(".snake-pad-left").click();
  ok((await direction(page)) === "left", "tapping Left turns the snake left");
  await page.locator(".snake-pad-down").click();
  ok((await direction(page)) === "down", "tapping Down turns the snake down");

  log("typing outside the app cannot reach it");
  const beforeOutside = await direction(page);
  await page.locator("#outside").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("w");
  ok((await direction(page)) === beforeOutside, "outside focus receives no Snake keyboard shortcuts");

  log("start, tick, pause and resume drive exactly one timer");
  await page.locator(".snake-start").click();
  ok((await phase(page)) === "playing" && (await intervals(page)) === 1,
    "Start enters playing and creates one clock interval");
  await page.waitForFunction((t) => Number(document.querySelector(".snake-app").dataset.tick) > t, await tick(page), { timeout: 3000 });
  ok((await tick(page)) > 0, "the game clock advances the tick counter");
  const headMoving = await head(page);
  await page.waitForFunction((h) => document.querySelector(".snake-app").dataset.head !== h, headMoving, { timeout: 3000 });
  ok(true, "the snake head advances across the grid");
  await page.keyboard.press("Space");
  ok((await phase(page)) === "paused" && (await intervals(page)) === 0,
    "Space pauses and clears the interval");
  const pausedTick = await tick(page);
  await page.waitForTimeout(400);
  ok((await tick(page)) === pausedTick, "a paused game does not advance");
  await page.keyboard.press("Space");
  ok((await phase(page)) === "playing" && (await intervals(page)) === 1,
    "Space resumes and recreates exactly one interval");
  await shot(page, "snake-ui-playing.png");

  log("wrap toggle avoids a wall death at the edge");
  await page.locator(".snake-wrap").click();
  ok((await page.locator(".snake-wrap").getAttribute("aria-pressed")) === "true" &&
     (await root(page).getAttribute("data-wrap")) === "true", "wrap mode is on and exposed");
  await page.locator(".snake-restart").click();
  await page.locator(".snake-pad-right").click();
  await page.waitForTimeout(1700);
  ok((await phase(page)) === "playing", "with wrap on the snake survives crossing the right edge");
  await page.locator(".snake-wrap").click();
  ok((await root(page).getAttribute("data-wrap")) === "false", "wrap mode can be turned off");

  log("wall death locks play until restart");
  await page.locator(".snake-restart").click();
  await page.locator(".snake-pad-right").click();
  await page.waitForFunction(() => document.querySelector(".snake-app").dataset.phase === "over", null, { timeout: 6000 });
  ok((await phase(page)) === "over" && (await intervals(page)) === 0,
    "reaching the wall ends the game and stops the timer");
  ok((await page.locator(".snake-message").innerText()).toLowerCase().includes("wall"),
    "game over announces the wall collision");
  const overHead = await head(page);
  const overScore = await score(page);
  await page.keyboard.press("ArrowUp");
  await page.locator(".snake-pad-left").click();
  await page.waitForTimeout(200);
  ok((await phase(page)) === "over" && (await head(page)) === overHead && (await score(page)) === overScore,
    "steering is locked after game over until restart");
  await shot(page, "snake-ui-over.png");
  await page.keyboard.press("r");
  ok((await phase(page)) === "playing" && (await score(page)) === 0,
    "R restarts a fresh zero-score game from the terminal state");
  await page.locator(".snake-restart").click();
  ok((await phase(page)) === "playing" && (await score(page)) === 0,
    "the Restart button starts a fresh zero-score game too");

  log("compact touch layout at 390x844 and 844x390");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const compact = await mp.evaluate(() => {
    const board = document.querySelector(".snake-board").getBoundingClientRect();
    const host = document.querySelector(".harness-host").getBoundingClientRect();
    const pad = document.querySelector(".snake-pad").getBoundingClientRect();
    const cells = [...document.querySelectorAll(".snake-cell")].map((n) => n.getBoundingClientRect().width);
    return { boardLeft: board.left, boardRight: board.right, boardTop: board.top, boardBottom: board.bottom,
      hostLeft: host.left, hostRight: host.right, hostTop: host.top, hostBottom: host.bottom,
      padBottom: pad.bottom, min: Math.min(...cells) };
  });
  ok(compact.boardLeft >= compact.hostLeft - 1 && compact.boardRight <= compact.hostRight + 1 &&
     compact.boardTop >= compact.hostTop - 1 && compact.boardBottom <= compact.hostBottom + 1 && compact.min >= 12,
    `390x844 board fits the host with usable cells (${JSON.stringify(compact)})`);
  await mp.locator(".snake-pad-up").tap();
  ok((await direction(mp)) === "up", "touch pad works in the compact 390px layout");
  await shot(mp, "snake-ui-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.waitForTimeout(120);
  const landscape = await mp.evaluate(() => {
    const board = document.querySelector(".snake-board").getBoundingClientRect();
    const host = document.querySelector(".harness-host").getBoundingClientRect();
    const pad = document.querySelector(".snake-pad").getBoundingClientRect();
    const cells = [...document.querySelectorAll(".snake-cell")].map((n) => n.getBoundingClientRect().width);
    return { boardBottom: board.bottom, boardRight: board.right, hostBottom: host.bottom, hostRight: host.right,
      padBottom: pad.bottom, min: Math.min(...cells) };
  });
  ok(landscape.boardBottom <= landscape.hostBottom + 1 && landscape.boardRight <= landscape.hostRight + 1 &&
     landscape.padBottom <= landscape.hostBottom + 1 && landscape.min >= 10,
    `844x390 landscape keeps board and pad usable (${JSON.stringify(landscape)})`);
  await shot(mp, "snake-ui-landscape-844x390.png");
  await phone.close();

  log("dispose through signal, idempotent handle.dispose and zero external traffic");
  await page.evaluate(() => window.__snakeAbort.abort());
  ok((await root(page).count()) === 0 && (await intervals(page)) === 0,
    "abort removes the app surface and clears every interval");
  await page.evaluate(() => window.__snakeHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL SNAKE UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`SNAKE UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
