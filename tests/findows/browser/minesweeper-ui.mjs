/* Focused Minesweeper UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/browser/minesweeper-ui.mjs [--port=8806] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8806 and mounts the production app module in a
   minimal harness because the shell registry is owned by another lane. Mines are
   deterministic: Math.random is overridden before the module loads so the first
   reveal at index 40 places a barrier of mines on row 7 plus index 0. */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8806"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks run before the browser so a missing app fails fast. */
const modulePath = resolve(ROOT, "findows/js/apps/minesweeper.mjs");
const cssPath = resolve(ROOT, "findows/styles/minesweeper.css");
const iconPath = resolve(ROOT, "findows/assets/icon-minesweeper.svg");
const enginePath = resolve(ROOT, "findows/js/apps/minesweeper-engine.mjs");
if (!existsSync(enginePath)) throw new Error("the real minesweeper-engine.mjs must exist");
if (!existsSync(iconPath)) throw new Error("findows/assets/icon-minesweeper.svg must exist");
const moduleSource = readFileSync(modulePath, "utf8");
const cssSource = readFileSync(cssPath, "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("minesweeper.mjs must export async function mount()");
}
if (!/from\s+["']\.\/minesweeper-engine\.mjs["']/.test(moduleSource)) {
  throw new Error("minesweeper.mjs must import the real minesweeper-engine.mjs");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("minesweeper.mjs must not register window/document listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("minesweeper.mjs must not use markup injection or dynamic code");
}
if (/addEventListener\s*\(\s*["']touch(start|move|end|cancel)["']|longPress|LONG_PRESS/.test(moduleSource)) {
  throw new Error("minesweeper.mjs must use a no-long-press flag mode instead of touch timers");
}
if (/(^|\n)\s*(html|body|\*|:root)\s*\{/.test(cssSource)) {
  throw new Error("minesweeper.css must not style global selectors");
}
if (!/\.ms-app\s*\{/.test(cssSource)) throw new Error("minesweeper.css must define .ms-app styles");
console.log("static checks: mount export, real engine import, icon, no global listeners, no long press, app-scoped CSS PASS");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

/* Math.random is replaced before the module script runs. The first reveal is the
   centre cell (index 40), so eligible cells are 0-29, 33-38, 42-47, 51-80.
   These values pick index 0 and the whole row 7 (63-71) as the ten mines. */
const HARNESS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Minesweeper UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/minesweeper.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{padding:12px}
  .harness-host{width:min(760px,calc(100vw - 24px));height:min(620px,calc(100vh - 84px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  @media (max-width:600px){
    .harness-host{width:calc(100vw - 20px);height:min(620px,calc(100vh - 84px))}
  }
  @media (max-height:499px){
    .harness-bar{display:none}
    .harness-shell{padding:6px}
    .harness-host{width:calc(100vw - 12px);height:calc(100vh - 12px)}
  }
</style>
<script>
  (function () {
    var eligiblePositions = [0, 54, 55, 56, 57, 58, 59, 60, 61, 62];
    var values = eligiblePositions.map(function (position) { return (position + 0.5) / 72; });
    window.__rngValues = values;
    window.__rngIndex = 0;
    Math.random = function () {
      return window.__rngValues[window.__rngIndex++ % 10];
    };
  })();
</script>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar">
    <button id="outside" type="button">Outside control</button>
    <span>Focus here to prove the Minesweeper keyboard is scoped</span>
  </div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { mount } from "/findows/js/apps/minesweeper.mjs";
  const controller = new AbortController();
  window.__msAbort = controller;
  window.__msHandle = await mount({
    container: document.getElementById("app"),
    windowId: "minesweeper-ui-test",
    fileId: null,
    services: {},
    signal: controller.signal,
  });
  window.__msReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__minesweeper-ui-harness.html") {
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
console.log(`minesweeper UI harness serving ${ROOT} at ${BASE}`);

let step = 0;
const log = (message) => console.log(`[${String(++step).padStart(2, "0")}] ${message}`);
const ok = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`      PASS ${message}`);
};
const shot = (page, name) => page.screenshot({ path: resolve(OUT, name), fullPage: false });

const consoleErrors = [];
const badResponses = [];
function watch(page) {
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
}

async function openHarness(page) {
  await page.goto(`${BASE}/__minesweeper-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__msReady === true, null, { timeout: 5000 });
}
const cell = (page, index) => page.locator(`.ms-cell[data-index="${index}"]`);
const phase = (page) => page.locator(".ms-app").getAttribute("data-phase");
const message = (page) => page.locator(".ms-message").innerText();
const counter = (page) => page.locator(".ms-counter").innerText();
const clickCell = (page, index) => cell(page, index).click();
const resetRng = (page) => page.evaluate(() => { window.__rngIndex = 0; });
const revealedCount = (page) => page.locator(".ms-cell--open, .ms-cell--mine").count();

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, beginner board and hidden-info labels");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__msHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await page.locator(".ms-app").count()) === 1 &&
     (await page.locator(".ms-app").getAttribute("data-window-id")) === "minesweeper-ui-test",
    "the app root is mounted with its window id");
  ok((await page.locator(".ms-cell").count()) === 81, "board has exactly 81 cells (beginner 9x9)");
  ok((await page.locator(".ms-reset").innerText()).includes("New game"), "reset control is labelled New game");
  ok((await page.locator(".ms-mode").getAttribute("aria-pressed")) === "false" &&
     (await page.locator(".ms-mode").innerText()).includes("Flag"),
    "flag-mode toggle starts off with an accessible pressed state");
  ok((await page.locator(".ms-message").getAttribute("role")) === "status" &&
     (await page.locator(".ms-message").getAttribute("aria-live")) === "polite",
    "message is a polite live status region");
  ok((await counter(page)) === "10 mines left" && (await phase(page)) === "ready",
    "ready board shows 10 mines left");
  const initialLabels = await page.locator(".ms-cell").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
  ok(initialLabels.every((label) => /^Row \d+, column \d+, hidden\./.test(label || "") && !/mine|adjacent/i.test(label || "")),
    "every hidden cell is labelled hidden with no mine information leaked");
  ok((await page.locator(".ms-cell--mine").count()) === 0 &&
     (await page.locator(".ms-cell").evaluateAll((nodes) => nodes.every((n) => !/\d/.test(n.textContent || "")))),
    "no mine styling or numbers appear before the first reveal");
  await shot(page, "minesweeper-ui-desktop-dark.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(180);
  await shot(page, "minesweeper-ui-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  log("safe first reveal and continuous mine redaction");
  await resetRng(page);
  await clickCell(page, 40);
  const firstReveal = { phase: await phase(page), message: await message(page),
    open: await page.locator(".ms-cell--open").count(), rng: await page.evaluate(() => window.__rngIndex) };
  ok(firstReveal.phase === "playing" && !firstReveal.message.includes("Boom") && firstReveal.open > 0,
    `first reveal is safe and opens a region (${JSON.stringify(firstReveal)})`);
  ok((await cell(page, 40).getAttribute("aria-label")) === "Row 5, column 5, empty.",
    "first revealed cell has adjacent zero and is announced as empty");
  const playingLabels = await page.locator(".ms-cell:not(.ms-cell--open)").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
  ok(playingLabels.every((label) => !/mine/i.test(label || "")),
    "hidden cells never mention mines while playing");
  ok((await page.locator(".ms-cell--mine").count()) === 0 && (await counter(page)) === "10 mines left",
    "no mine is exposed by the renderer during play");

  log("no-long-press touch flag mode, right-click and F shortcut");
  await page.locator(".ms-mode").click();
  ok((await page.locator(".ms-mode").getAttribute("aria-pressed")) === "true" &&
     (await page.locator(".ms-app").getAttribute("class")).includes("ms-app--flag-mode"),
    "flag mode is on and exposed with aria-pressed");
  await clickCell(page, 80);
  ok((await cell(page, 80).getAttribute("aria-pressed")) === "true" &&
     (await cell(page, 80).getAttribute("aria-label")).includes("flagged") &&
     (await counter(page)) === "9 mines left",
    "a plain tap in flag mode flags a cell without any long press");
  await clickCell(page, 80);
  ok((await cell(page, 80).getAttribute("aria-pressed")) === "false" &&
     (await counter(page)) === "10 mines left",
    "a second plain tap removes the flag");
  await page.locator(".ms-mode").click();
  ok((await page.locator(".ms-mode").getAttribute("aria-pressed")) === "false", "flag mode can be turned off");
  await cell(page, 79).click({ button: "right" });
  ok((await cell(page, 79).getAttribute("aria-label")).includes("flagged"), "right-click flags a cell for pointer users");
  await cell(page, 79).focus();
  await page.keyboard.press("f");
  ok((await cell(page, 79).getAttribute("aria-label")).includes("hidden") &&
     (await counter(page)) === "10 mines left",
    "F unflags the focused cell, matching the pointer action");
  await shot(page, "minesweeper-ui-flagged.png");

  log("arrow-key focus, native activation and terminal-safe shortcuts");
  await cell(page, 40).focus();
  const arrowBefore = await page.evaluate(() => ({ tag: document.activeElement?.tagName,
    index: document.activeElement?.dataset?.index, cls: document.activeElement?.className }));
  await page.keyboard.press("ArrowRight");
  const arrowAfter = await page.evaluate(() => ({ tag: document.activeElement?.tagName,
    index: document.activeElement?.dataset?.index, cls: document.activeElement?.className }));
  ok(arrowAfter.index === "41", `ArrowRight moves focus one column right (${JSON.stringify({ arrowBefore, arrowAfter })})`);
  await page.keyboard.press("ArrowDown");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "50", "ArrowDown moves focus one row down");
  await page.keyboard.press("ArrowLeft");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "49", "ArrowLeft moves focus one column left");
  await page.keyboard.press("ArrowUp");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "40", "ArrowUp moves focus one row up");
  await page.keyboard.press("Home");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "36", "Home moves to the first column of the row");
  await page.keyboard.press("End");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "44", "End moves to the last column of the row");
  const beforeChord = await revealedCount(page);
  await page.keyboard.press("c");
  ok((await revealedCount(page)) === beforeChord, "C is a no-op until a numbered cell has matching flags");
  await page.keyboard.press("r");
  ok((await phase(page)) === "ready" && (await counter(page)) === "10 mines left" &&
     (await page.locator(".ms-cell--open").count()) === 0,
    "R restarts a fresh board");
  await resetRng(page);
  await clickCell(page, 40);
  await cell(page, 41).focus();
  await page.keyboard.press("Enter");
  ok((await cell(page, 41).getAttribute("aria-label")).includes("hidden") === false,
    "Enter activates the focused cell once through native button activation");
  await cell(page, 42).focus();
  await page.keyboard.press("Space");
  ok((await cell(page, 42).getAttribute("aria-label")).includes("hidden") === false,
    "Space activates the focused cell once without double handling");

  log("typing outside the app cannot reach it");
  const beforeOutside = await page.locator(".ms-cell").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")).join("|"));
  await page.locator("#outside").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("f");
  await page.keyboard.press("r");
  const afterOutside = await page.locator(".ms-cell").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")).join("|"));
  ok(beforeOutside === afterOutside && (await phase(page)) === "playing",
    "outside focus receives no Minesweeper keyboard shortcuts");

  log("loss exposes mines, marks wrong flags and locks play");
  await page.locator(".ms-reset").click();
  await cell(page, 80).click({ button: "right" });
  await resetRng(page);
  await clickCell(page, 40);
  await clickCell(page, 63);
  ok((await phase(page)) === "lost" && (await message(page)).includes("Boom"),
    "revealing a mine loses and announces Boom");
  ok((await page.locator(".ms-cell--mine").count()) === 10 &&
     (await cell(page, 63).getAttribute("aria-label")).includes("mine"),
    "loss reveals all ten mines in the labels and visuals");
  ok((await cell(page, 80).getAttribute("aria-label")).includes("wrong flag") &&
     (await cell(page, 80).getAttribute("class")).includes("ms-cell--wrong"),
    "a flag on a safe cell is marked as a wrong flag");
  const lostRevealed = await revealedCount(page);
  await clickCell(page, 41);
  ok((await revealedCount(page)) === lostRevealed && (await phase(page)) === "lost",
    "play is locked after a loss until restart");
  await shot(page, "minesweeper-ui-lost.png");

  log("win clears every safe cell and locks play");
  await page.locator(".ms-reset").click();
  await resetRng(page);
  await clickCell(page, 40);
  for (let i = 10; i < 81; i += 1) {
    if (i >= 63 && i <= 71) continue; // the deterministic mine barrier
    await clickCell(page, i);
  }
  ok((await phase(page)) === "won" && (await message(page)).includes("won"),
    "revealing all 71 safe cells wins and announces the result");
  ok((await page.locator(".ms-cell--open").count()) === 71 &&
     (await page.locator(".ms-cell--mine").count()) === 10,
    "win exposes all safe cells and all mines");
  const wonRevealed = await revealedCount(page);
  await clickCell(page, 63);
  ok((await revealedCount(page)) === wonRevealed && (await phase(page)) === "won",
    "play is locked after a win until restart");
  await shot(page, "minesweeper-ui-won.png");

  log("compact touch layout");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const compact = await mp.evaluate(() => {
    const board = document.querySelector(".ms-board").getBoundingClientRect();
    const wrap = document.querySelector(".ms-board-wrap");
    const sizes = [...document.querySelectorAll(".ms-cell")].map((n) => n.getBoundingClientRect().width);
    return { boardWidth: board.width, boardHeight: board.height, min: Math.min(...sizes),
      wrapHeight: wrap.clientHeight, scrollable: wrap.scrollWidth > wrap.clientWidth };
  });
  ok(compact.min >= 44 && compact.boardHeight >= 400 && compact.wrapHeight >= 400,
    `compact board uses touch-sized cells and stays fully laid out (${JSON.stringify(compact)})`);
  await mp.locator(".ms-mode").tap();
  await cell(mp, 40).tap();
  ok((await cell(mp, 40).getAttribute("aria-pressed")) === "true",
    "touch flag mode flags a cell with a plain tap, no long press");
  await shot(mp, "minesweeper-ui-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.waitForTimeout(80);
  const landscape = await mp.evaluate(() => {
    const board = document.querySelector(".ms-board").getBoundingClientRect();
    const wrap = document.querySelector(".ms-board-wrap");
    const app = document.querySelector(".ms-app");
    const sizes = [...document.querySelectorAll(".ms-cell")].map((n) => n.getBoundingClientRect().width);
    return { boardHeight: board.height, min: Math.min(...sizes), wrapHeight: wrap.clientHeight,
      appScrolls: app.scrollHeight > app.clientHeight };
  });
  ok(landscape.min >= 44 && landscape.boardHeight >= 400 && landscape.wrapHeight >= 400 && landscape.appScrolls,
    `short landscape keeps a full touch-sized board in a scrollable app (${JSON.stringify(landscape)})`);
  await shot(mp, "minesweeper-ui-landscape-844x390.png");
  await phone.close();

  log("dispose through signal and idempotent handle.dispose");
  await page.evaluate(() => window.__msAbort.abort());
  ok((await page.locator(".ms-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__msHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL MINESWEEPER UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`MINESWEEPER UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
