/* Focused Sokoban UI evidence. Dev-only; never shipped as site runtime.
   Usage: FINDOWS_PLAYWRIGHT_MODULE=/path/to/playwright node tests/findows/sokoban-ui.mjs \
            [--port=8865] [--out=DIR] [--playwright=PATH]

   Serves this worktree on 127.0.0.1:8865 and mounts the production module in a
   minimal harness because the shell registry is owned by another lane. All
   levels are deterministic: no randomness, no storage, no network. */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8865"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE || process.env.FINDOWS_PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

/* Static contract checks run before the browser so a missing app fails fast. */
const modulePath = resolve(ROOT, "findows/js/apps/sokoban.mjs");
const cssPath = resolve(ROOT, "findows/styles/sokoban.css");
const iconPath = resolve(ROOT, "findows/assets/icon-sokoban.svg");
const enginePath = resolve(ROOT, "findows/js/apps/sokoban-engine.mjs");
if (!existsSync(enginePath)) throw new Error("findows/js/apps/sokoban-engine.mjs must exist");
if (!existsSync(modulePath)) throw new Error("findows/js/apps/sokoban.mjs must exist");
if (!existsSync(cssPath)) throw new Error("findows/styles/sokoban.css must exist");
if (!existsSync(iconPath)) throw new Error("findows/assets/icon-sokoban.svg must exist");
const moduleSource = readFileSync(modulePath, "utf8");
const cssSource = readFileSync(cssPath, "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("sokoban.mjs must export async function mount()");
}
if (!/from\s+["']\.\/sokoban-engine\.mjs["']/.test(moduleSource)) {
  throw new Error("sokoban.mjs must import the real sokoban-engine.mjs");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("sokoban.mjs must not register window/document listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("sokoban.mjs must not use markup injection or dynamic code");
}
if (/\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)\b/.test(moduleSource)) {
  throw new Error("sokoban.mjs must not make network requests");
}
if (/(^|\n)\s*(html|body|\*|:root)\s*\{/.test(cssSource)) {
  throw new Error("sokoban.css must not style global selectors");
}
if (!/\.sk-app\s*\{/.test(cssSource)) throw new Error("sokoban.css must define .sk-app styles");
console.log("static checks: mount export, real engine import, icon, no global listeners, no markup/dynamic code, no network, app-scoped CSS PASS");

const { chromium } = loadPlaywright();

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
<title>Sokoban UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/sokoban.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{padding:12px}
  .harness-host{width:min(880px,calc(100vw - 24px));height:min(700px,calc(100vh - 84px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  @media (max-width:600px){
    .harness-bar{display:none}
    .harness-shell{padding:8px}
    .harness-host{width:calc(100vw - 16px);height:calc(100vh - 16px)}
  }
  @media (max-height:499px){
    .harness-bar{display:none}
    .harness-shell{padding:6px}
    .harness-host{width:calc(100vw - 12px);height:calc(100vh - 12px)}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar">
    <button id="outside" type="button">Outside control</button>
    <span>Focus here to prove the Sokoban keyboard is scoped</span>
  </div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { mount } from "/findows/js/apps/sokoban.mjs";
  import { LEVELS } from "/findows/js/apps/sokoban-engine.mjs";
  window.__skLevels = LEVELS;
  const controller = new AbortController();
  window.__skAbort = controller;
  window.__skHandle = await mount({
    container: document.getElementById("app"),
    windowId: "sokoban-ui-test",
    fileId: null,
    services: {},
    signal: controller.signal,
  });
  window.__skReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__sokoban-ui-harness.html") {
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
console.log(`sokoban UI harness serving ${ROOT} at ${BASE}`);

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
    if (!url.startsWith(BASE) && !url.startsWith("about:") && !url.startsWith("data:")) {
      externalRequests.push(url);
    }
  });
}

async function openHarness(page) {
  await page.goto(`${BASE}/__sokoban-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__skReady === true, null, { timeout: 5000 });
}

const phase = (page) => page.locator(".sk-app").getAttribute("data-phase");
const message = (page) => page.locator(".sk-message").innerText();
const stat = (page, name) => page.locator(`.sk-stat-value[data-stat="${name}"]`).innerText();
const cell = (page, row, col) => page.locator(`.sk-cell[data-row="${row}"][data-col="${col}"]`);
const levelChip = (page, index) => page.locator(`.sk-level[data-level="${index}"]`);
const focusApp = (page) => page.locator(".sk-restart").focus();

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, first level and accessible board");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__skHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose,
      levelCount: window.__skLevels.length, rows: window.__skLevels[0].rows.length,
      cols: window.__skLevels[0].rows[0].length, par: window.__skLevels[0].par };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await page.locator(".sk-app").count()) === 1 &&
     (await page.locator(".sk-app").getAttribute("data-window-id")) === "sokoban-ui-test",
    "the app root is mounted with its window id");
  ok((await page.locator(".sk-level").count()) === shape.levelCount &&
     (await stat(page, "level")) === `1 / ${shape.levelCount}`,
    `level chips and counter describe all ${shape.levelCount} levels`);
  ok((await page.locator(".sk-cell").count()) === shape.rows * shape.cols,
    `board has ${shape.rows * shape.cols} cells from the authored level rows`);
  ok((await page.locator(".sk-subtitle").innerText()).includes("First Push") &&
     (await stat(page, "par")) === String(shape.par) &&
     (await stat(page, "moves")) === "0" && (await stat(page, "pushes")) === "0",
    "first level name, par and zeroed counters are rendered");
  ok((await phase(page)) === "playing" &&
     (await page.locator(".sk-message").getAttribute("role")) === "status" &&
     (await page.locator(".sk-message").getAttribute("aria-live")) === "polite",
    "ready phase and a polite live status region");
  ok((await page.locator(".sk-cell--wall").count()) > 0 &&
     (await page.locator(".sk-cell--box").count()) === 1 &&
     (await page.locator(".sk-cell--goal").count()) === 1 &&
     (await page.locator(".sk-cell--player").count()) === 1,
    "walls, one box, one goal and one worker are rendered from the engine snapshot");
  ok((await page.locator(".sk-board").getAttribute("aria-label")).includes("First Push") &&
     (await page.locator(".sk-cell").first().getAttribute("aria-hidden")) === "true",
    "board has an accessible label while decorative cells are hidden");
  ok((await page.locator(".sk-up").getAttribute("aria-label")) === "Move up" &&
     (await page.locator(".sk-undo").getAttribute("aria-keyshortcuts")) === "Z",
    "touch pad and controls expose keyboard hints");
  await shot(page, "sokoban-ui-desktop-dark.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(180);
  await shot(page, "sokoban-ui-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  log("keyboard solution, win detection and progress state");
  await focusApp(page);
  const beforeArrows = await stat(page, "moves");
  await page.keyboard.press("Control+ArrowUp");
  ok((await stat(page, "moves")) === beforeArrows, "modified arrow keys are ignored");
  await page.keyboard.press("ArrowUp");
  ok((await stat(page, "moves")) === "1" && (await stat(page, "pushes")) === "1",
    "ArrowUp pushes the box one tile and counts the move and push");
  await page.keyboard.press("ArrowUp");
  ok((await phase(page)) === "won" && (await message(page)).includes("Solved!") &&
     (await stat(page, "moves")) === String(shape.par),
    `second push wins, announces the solve and matches par ${shape.par}`);
  ok((await page.locator(".sk-cell--box-goal").count()) === 1 &&
     (await page.locator(".sk-next").isEnabled()) === true &&
     (await levelChip(page, 0).getAttribute("class")).includes("sk-level--done"),
    "box-on-goal styling, Next level and completed chip appear after the win");
  await shot(page, "sokoban-ui-solved.png");
  const wonState = await page.locator(".sk-board").getAttribute("aria-label");
  await page.keyboard.press("ArrowDown");
  ok((await stat(page, "moves")) === String(shape.par) &&
     (await page.locator(".sk-board").getAttribute("aria-label")) === wonState,
    "play is locked after a win until undo, restart or Next level");

  log("undo, restart, control clicks and blocked movement");
  await page.keyboard.press("z");
  ok((await phase(page)) === "playing" && (await stat(page, "moves")) === "1" &&
     (await stat(page, "pushes")) === "1",
    "Z undoes the winning push and reopens the level");
  await page.locator(".sk-undo").click();
  ok((await stat(page, "moves")) === "0" && (await stat(page, "pushes")) === "0" &&
     (await page.locator(".sk-undo").isDisabled()) === true,
    "the Undo button restores the start and disables itself at zero moves");
  await page.keyboard.press("z");
  ok((await stat(page, "moves")) === "0", "extra undo is a safe no-op");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("r");
  ok((await stat(page, "moves")) === "0" && (await stat(page, "pushes")) === "0" &&
     (await phase(page)) === "playing" && (await message(page)).includes("restarted"),
    "R restarts the level and announces the reset");

  const playerBefore = await page.evaluate(() => {
    const node = document.querySelector(".sk-cell--player");
    return { row: Number(node.dataset.row), col: Number(node.dataset.col) };
  });
  await cell(page, playerBefore.row, playerBefore.col + 1).click();
  ok((await stat(page, "moves")) === "1", "clicking a neighbouring tile moves the worker");
  await cell(page, playerBefore.row + 2, playerBefore.col).click();
  ok((await stat(page, "moves")) === "1" && (await message(page)).includes("next to"),
    "clicking a distant tile does nothing and explains the input");
  await page.evaluate(() => { document.getElementById("outside").focus(); });
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("z");
  await page.keyboard.press("r");
  ok((await stat(page, "moves")) === "1" && (await phase(page)) === "playing",
    "typing outside the app never reaches its keyboard handlers");

  log("level progression and revisit");
  await page.locator(".sk-restart").click();
  await focusApp(page);
  for (let i = 0; i < shape.par; i += 1) await page.keyboard.press("ArrowUp");
  await page.locator(".sk-next").click();
  ok((await stat(page, "level")) === `2 / ${shape.levelCount}` &&
     (await page.locator(".sk-subtitle").innerText()).includes("Double Delivery") &&
     (await stat(page, "moves")) === "0",
    "Next level loads level 2 with fresh counters");
  ok((await levelChip(page, 0).getAttribute("class")).includes("sk-level--done") &&
     (await levelChip(page, 1).getAttribute("aria-current")) === "step" &&
     (await levelChip(page, 2).isDisabled()) === true,
    "completed/current/locked chips reflect progression");
  await levelChip(page, 0).click();
  ok((await stat(page, "level")) === `1 / ${shape.levelCount}` &&
     (await levelChip(page, 1).isDisabled()) === false,
    "a solved level can be revisited without losing the unlock");
  await page.evaluate(async () => {
    const game = window.__skHandle;
    void game;
  });
  await shot(page, "sokoban-ui-level-revisit.png");

  log("touch pad and compact 390x844 layout");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const compact = await mp.evaluate(() => {
    const board = document.querySelector(".sk-board").getBoundingClientRect();
    const host = document.querySelector(".harness-host").getBoundingClientRect();
    const pad = document.querySelector(".sk-pad").getBoundingClientRect();
    const sizes = [...document.querySelectorAll(".sk-cell")].map((n) => n.getBoundingClientRect().width);
    return { boardWidth: board.width, hostWidth: host.width, boardLeft: board.left, hostLeft: host.left,
      padBottom: pad.bottom, hostBottom: host.bottom, min: Math.min(...sizes) };
  });
  ok(compact.boardWidth <= compact.hostWidth && compact.boardLeft >= compact.hostLeft - 1 && compact.min >= 22,
    `compact board fits the 390px host with usable cells (${JSON.stringify(compact)})`);
  ok(compact.padBottom <= compact.hostBottom + 1, "touch pad stays inside the compact host");
  await mp.locator(".sk-up").tap();
  ok((await stat(mp, "moves")) === "1", "a D-pad tap pushes once on touch");
  await mp.locator(".sk-up").tap();
  ok((await phase(mp)) === "won" && (await message(mp)).includes("Solved!"),
    "two touch taps solve the first level");
  await shot(mp, "sokoban-ui-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.waitForTimeout(100);
  const landscape = await mp.evaluate(() => {
    const board = document.querySelector(".sk-board").getBoundingClientRect();
    const pad = document.querySelector(".sk-pad").getBoundingClientRect();
    const host = document.querySelector(".harness-host").getBoundingClientRect();
    const sizes = [...document.querySelectorAll(".sk-cell")].map((n) => n.getBoundingClientRect().width);
    return { boardBottom: board.bottom, padBottom: pad.bottom, hostBottom: host.bottom,
      boardRight: board.right, padLeft: pad.left, min: Math.min(...sizes) };
  });
  ok(landscape.boardBottom <= landscape.hostBottom + 1 && landscape.padBottom <= landscape.hostBottom + 1 &&
     landscape.min >= 18,
    `short landscape keeps board and pad inside the host (${JSON.stringify(landscape)})`);
  await shot(mp, "sokoban-ui-landscape-844x390.png");
  await phone.close();

  log("dispose through signal, idempotent handle and zero external traffic");
  await page.evaluate(() => window.__skAbort.abort());
  ok((await page.locator(".sk-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__skHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);

  log("ALL SOKOBAN UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`SOKOBAN UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
