/* Focused Nonogram UI evidence. Dev-only; never shipped as site runtime.
   Usage: FINDOWS_PLAYWRIGHT_MODULE=/path/to/playwright node tests/findows/nonogram-browser.mjs
          [--port=8866] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8866 and mounts the production module with a
   minimal injected services object. The shell registry is owned by another lane. */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8866"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/features/nonogram-evidence"));
const playwrightModule = arg("playwright", "") || process.env.FINDOWS_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || "";
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks: fail fast when a lane file is missing or unsafe. */
const modulePath = resolve(ROOT, "findows/js/apps/nonogram.mjs");
const cssPath = resolve(ROOT, "findows/styles/nonogram.css");
const iconPath = resolve(ROOT, "findows/assets/icon-nonogram.svg");
const enginePath = resolve(ROOT, "findows/js/apps/nonogram-engine.mjs");
if (!existsSync(enginePath)) throw new Error("findows/js/apps/nonogram-engine.mjs must exist");
if (!existsSync(modulePath)) throw new Error("findows/js/apps/nonogram.mjs must exist");
if (!existsSync(cssPath)) throw new Error("findows/styles/nonogram.css must exist");
if (!existsSync(iconPath)) throw new Error("findows/assets/icon-nonogram.svg must exist");
const moduleSource = readFileSync(modulePath, "utf8");
const cssSource = readFileSync(cssPath, "utf8");
const iconSource = readFileSync(iconPath, "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("nonogram.mjs must export async function mount()");
}
if (!/from\s+["']\.\/nonogram-engine\.mjs["']/.test(moduleSource)) {
  throw new Error("nonogram.mjs must import the real ./nonogram-engine.mjs");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("nonogram.mjs must not register document/window listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("nonogram.mjs must not use markup injection or dynamic code");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{"))
  .map((line) => line.slice(0, -1).trim())
  .filter((selector) => !selector.startsWith(".ng-") &&
    !selector.startsWith("#fw-desktop[data-theme=") &&
    !selector.startsWith("@") &&
    !/^(from|to|\d+(?:\.\d+)?%)$/.test(selector));
if (badSelectors.length) throw new Error(`nonogram.css has unscoped selectors: ${badSelectors.join(" | ")}`);
if (!/\.ng-app\s*\{/.test(cssSource)) throw new Error("nonogram.css must define .ng-app styles");
if (!iconSource.trimStart().startsWith("<svg") || !iconSource.includes('viewBox="0 0 64 64"') ||
    /<script|onload=|href="https?:/i.test(iconSource)) {
  throw new Error("icon-nonogram.svg must be a local, original 64×64 SVG without scripts");
}
console.log("static checks: mount export, real engine import, icon, no global listeners, no dynamic code, app-scoped CSS PASS");

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
<title>Nonogram UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/nonogram.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{padding:12px}
  .harness-host{width:min(720px,calc(100vw - 24px));height:min(620px,calc(100vh - 84px));margin:0 auto;
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
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar"><button id="outside" type="button">Outside control</button><span>Nonogram shortcuts are scoped to the app</span></div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { mount } from "/findows/js/apps/nonogram.mjs";
  import { PUZZLE } from "/findows/js/apps/nonogram-engine.mjs";
  const controller = new AbortController();
  window.__ngAbort = controller;
  window.__ngSolution = PUZZLE.solution;
  window.__ngHandle = await mount({
    container: document.getElementById("app"),
    windowId: "nonogram-ui-test",
    fileId: null,
    services: { setDirty() {}, openApp() {}, bindDocument() {} },
    signal: controller.signal,
  });
  window.__ngReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__nonogram-ui-harness.html") {
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
console.log(`nonogram UI harness serving ${ROOT} at ${BASE}`);

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
    if (!request.url().startsWith(BASE + "/") && !request.url().startsWith("data:")) {
      externalRequests.push(request.url());
    }
  });
}

async function openHarness(page) {
  await page.goto(`${BASE}/__nonogram-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ngReady === true, null, { timeout: 8000 });
}
const cell = (page, index) => page.locator(`.ng-cell[data-index="${index}"]`);
const phase = (page) => page.locator(".ng-app").getAttribute("data-phase");
const message = (page) => page.locator(".ng-message").innerText();
const mistakes = (page) => page.locator(".ng-mistakes").innerText();
const progress = (page) => page.locator(".ng-progress").innerText();
const solutionIndices = async (page) => page.evaluate(() =>
  window.__ngSolution.flatMap((filled, index) => (filled ? [index] : [])));
const blankIndices = async (page) => page.evaluate(() =>
  window.__ngSolution.flatMap((filled, index) => (filled ? [] : [index])));
const boardSignature = (page) => page.locator(".ng-cell").evaluateAll((nodes) =>
  nodes.map((node) => node.getAttribute("aria-label")).join("|"));

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, clue grid and accessible status");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__ngHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await page.locator(".ng-app").count()) === 1 &&
     (await page.locator(".ng-app").getAttribute("data-window-id")) === "nonogram-ui-test",
    "the app root is mounted with its window id");
  ok((await page.locator(".ng-cell").count()) === 25, "board has exactly 25 cells (5x5)");
  ok((await page.locator(".ng-row-clue").count()) === 5 && (await page.locator(".ng-col-clue").count()) === 5,
    "five row clues and five column clues are rendered");
  const clueText = async (selector) => (await page.locator(selector).allTextContents())
    .map((text) => text.replace(/\s+/g, " ").trim());
  ok(JSON.stringify(await clueText(".ng-row-clue")) === JSON.stringify(["1 1", "5", "5", "3", "1"]),
    `row clues match the bundled puzzle (${JSON.stringify(await clueText(".ng-row-clue"))})`);
  ok(JSON.stringify(await clueText(".ng-col-clue")) === JSON.stringify(["2", "4", "4", "4", "2"]),
    `column clues match the bundled puzzle (${JSON.stringify(await clueText(".ng-col-clue"))})`);
  ok((await page.locator(".ng-message").getAttribute("role")) === "status" &&
     (await page.locator(".ng-message").getAttribute("aria-live")) === "polite",
    "message is a polite live status region");
  ok((await phase(page)) === "playing" && (await mistakes(page)).includes("0") &&
     (await progress(page)).includes("0 / 16"),
    "fresh board reports zero mistakes and zero of sixteen filled");
  ok((await page.locator(".ng-mode").getAttribute("aria-pressed")) === "false" &&
     (await page.locator(".ng-reset").innerText()).toLowerCase().includes("restart"),
    "fill mode is the default and Restart is available");
  const labels = await page.locator(".ng-cell").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
  ok(labels.every((label) => /^Row [1-5], column [1-5], empty\./.test(label || "")),
    "every cell is labelled with its row, column and empty state");
  await shot(page, "nonogram-desktop-dark.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(160);
  await shot(page, "nonogram-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  log("fill, mark, mistakes and mode parity between pointer and keyboard");
  await cell(page, 0).click(); // row 1 col 1 is blank in the heart
  ok((await cell(page, 0).getAttribute("class")).includes("ng-cell--filled") &&
     (await mistakes(page)).includes("1") && (await progress(page)).includes("1 / 16"),
    "filling a wrong cell raises the mistake count and progress");
  ok((await cell(page, 0).getAttribute("aria-label")).includes("filled"),
    "the filled cell is announced as filled");
  await cell(page, 0).click({ button: "right" });
  ok((await cell(page, 0).getAttribute("class")).includes("ng-cell--marked") &&
     (await mistakes(page)).includes("0"),
    "right-click marks the cell and clears the wrong fill");
  await cell(page, 0).focus();
  await page.keyboard.press("f");
  ok((await cell(page, 0).getAttribute("class")).includes("ng-cell--filled"),
    "F fills the focused cell, matching the primary pointer action");
  await page.keyboard.press("m");
  ok((await cell(page, 0).getAttribute("class")).includes("ng-cell--marked"),
    "M marks the focused cell, matching the secondary pointer action");
  await page.locator(".ng-mode").click();
  ok((await page.locator(".ng-mode").getAttribute("aria-pressed")) === "true",
    "Mark mode is exposed with aria-pressed for touch users");
  await cell(page, 24).click();
  ok((await cell(page, 24).getAttribute("class")).includes("ng-cell--marked"),
    "a plain tap in Mark mode places an X without any long press");
  await cell(page, 24).click();
  ok((await cell(page, 24).getAttribute("class")).includes("ng-cell--empty"),
    "a second plain tap removes the X");
  await page.locator(".ng-mode").click();
  await shot(page, "nonogram-marked.png");

  log("roving keyboard focus and scoped shortcuts");
  await cell(page, 6).focus();
  await page.keyboard.press("ArrowRight");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "7", "ArrowRight moves one column right");
  await page.keyboard.press("ArrowDown");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "12", "ArrowDown moves one row down");
  await page.keyboard.press("ArrowLeft");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "11", "ArrowLeft moves one column left");
  await page.keyboard.press("ArrowUp");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "6", "ArrowUp moves one row up");
  await page.keyboard.press("Home");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "5", "Home moves to the row start");
  await page.keyboard.press("End");
  ok((await page.evaluate(() => document.activeElement?.dataset?.index)) === "9", "End moves to the row end");
  await cell(page, 6).focus();
  await page.keyboard.press("Enter");
  ok((await cell(page, 6).getAttribute("class")).includes("ng-cell--filled"),
    "Enter activates the focused cell once through native button behaviour");
  await cell(page, 7).focus();
  await page.keyboard.press("Space");
  ok((await cell(page, 7).getAttribute("class")).includes("ng-cell--filled"),
    "Space activates the focused cell once without double handling");
  const beforeOutside = await boardSignature(page);
  await page.locator("#outside").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("f");
  await page.keyboard.press("m");
  await page.keyboard.press("r");
  ok((await boardSignature(page)) === beforeOutside, "outside focus receives no Nonogram shortcuts");
  await cell(page, 6).focus();
  await page.keyboard.press("r");
  ok((await mistakes(page)).includes("0") && (await progress(page)).includes("0 / 16"),
    "R restarts the puzzle and clears all cells");
  await shot(page, "nonogram-restarted.png");

  log("no false win on wrong marks or wrong fills");
  const filled = await solutionIndices(page);
  const blanks = await blankIndices(page);
  for (let index = 0; index < 25; index += 1) await cell(page, index).click();
  ok((await phase(page)) === "playing" && (await mistakes(page)).includes("9"),
    "filling every cell leaves nine mistakes and never wins");
  await shot(page, "nonogram-mistakes.png");
  await page.locator(".ng-reset").click();
  await page.locator(".ng-mode").click();
  for (const index of filled) await cell(page, index).click();
  for (const index of blanks) await cell(page, index).click();
  ok((await phase(page)) === "playing" && !(await message(page)).toLowerCase().includes("complete"),
    "inverting the board (X on every answer, fill on every blank) is not a win");
  await page.locator(".ng-reset").click();
  await cell(page, filled[0]).click(); // still in Mark mode from the previous step
  await page.locator(".ng-mode").click(); // switch back to Fill mode
  for (const index of filled.slice(1)) await cell(page, index).click();
  ok((await phase(page)) === "playing" && (await progress(page)).includes("15 / 16"),
    "one marked answer with all other answers filled is not a win");
  await cell(page, filled[0]).click();
  ok((await phase(page)) === "won" && (await message(page)).toLowerCase().includes("complete"),
    "filling the final answer completes the picture");
  ok((await mistakes(page)).includes("0") && (await progress(page)).includes("16 / 16"),
    "the win reports a perfect board");
  const wonSignature = await boardSignature(page);
  await cell(page, blanks[0]).click();
  ok((await phase(page)) === "won" && (await boardSignature(page)) === wonSignature,
    "play is locked after a win until restart");
  await shot(page, "nonogram-won.png");
  await page.locator(".ng-reset").click();
  ok((await phase(page)) === "playing" && (await progress(page)).includes("0 / 16"),
    "Restart returns to a fresh playable board");

  log("compact portrait and short landscape layouts with touch input");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const compact = await mp.evaluate(() => {
    const board = document.querySelector(".ng-grid").getBoundingClientRect();
    const host = document.querySelector(".harness-host").getBoundingClientRect();
    const sizes = [...document.querySelectorAll(".ng-cell")].map((node) => node.getBoundingClientRect().width);
    return { boardWidth: board.width, hostWidth: host.width, boardLeft: board.left, hostLeft: host.left,
      min: Math.min(...sizes) };
  });
  ok(compact.boardWidth <= compact.hostWidth && compact.boardLeft >= compact.hostLeft - 1 && compact.min >= 24,
    `the clue grid fits the 390px host with usable cells (${JSON.stringify(compact)})`);
  await mp.locator(".ng-mode").tap();
  await cell(mp, 6).tap();
  ok((await cell(mp, 6).getAttribute("class")).includes("ng-cell--marked"),
    "touch tap in Mark mode places a mark without a long press");
  await shot(mp, "nonogram-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.waitForTimeout(100);
  const landscape = await mp.evaluate(() => {
    const board = document.querySelector(".ng-grid").getBoundingClientRect();
    const host = document.querySelector(".harness-host").getBoundingClientRect();
    const sizes = [...document.querySelectorAll(".ng-cell")].map((node) => node.getBoundingClientRect().width);
    return { boardBottom: board.bottom, hostBottom: host.bottom, min: Math.min(...sizes),
      controlsVisible: document.querySelector(".ng-reset").getClientRects().length > 0 };
  });
  ok(landscape.boardBottom <= landscape.hostBottom + 1 && landscape.min >= 20 && landscape.controlsVisible,
    `short landscape keeps the board and controls reachable (${JSON.stringify(landscape)})`);
  await shot(mp, "nonogram-landscape-844x390.png");
  await phone.close();

  log("focus(), dispose cleanup and zero external traffic");
  await page.evaluate(() => window.__ngHandle.focus());
  ok((await page.evaluate(() => document.activeElement?.classList?.contains("ng-cell"))) === true,
    "handle.focus() puts keyboard focus on a cell");
  await page.evaluate(() => window.__ngAbort.abort());
  ok((await page.locator(".ng-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__ngHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  log("ALL NONOGRAM UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`NONOGRAM UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
