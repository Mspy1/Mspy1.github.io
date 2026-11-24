/* Focused Mastermind UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/mastermind-browser.mjs [--port=8864] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8864 and mounts the production app module in a
   minimal harness because the shell registry is owned by the parent lane.
   Math.random is replaced before the module loads: the first secret is
   [0,1,2,3] (Red, Blue, Green, Yellow) and after a reset it is [4,5,0,1]. */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8864"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/features/mastermind-evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE || process.env.FINDOWS_PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks run before the browser so a missing app fails fast. */
const modulePath = resolve(ROOT, "findows/js/apps/mastermind.mjs");
const cssPath = resolve(ROOT, "findows/styles/mastermind.css");
const iconPath = resolve(ROOT, "findows/assets/icon-mastermind.svg");
const enginePath = resolve(ROOT, "findows/js/apps/mastermind-engine.mjs");
if (!existsSync(enginePath)) throw new Error("the real mastermind-engine.mjs must exist");
if (!existsSync(iconPath)) throw new Error("findows/assets/icon-mastermind.svg must exist");
if (!existsSync(modulePath)) throw new Error("the real mastermind.mjs must exist");
if (!existsSync(cssPath)) throw new Error("findows/styles/mastermind.css must exist");
const moduleSource = readFileSync(modulePath, "utf8");
const cssSource = readFileSync(cssPath, "utf8");
const iconSource = readFileSync(iconPath, "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("mastermind.mjs must export async function mount()");
}
if (!/from\s+["']\.\/mastermind-engine\.mjs["']/.test(moduleSource)) {
  throw new Error("mastermind.mjs must import the real mastermind-engine.mjs");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("mastermind.mjs must not register window/document listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("mastermind.mjs must not use markup injection or dynamic code");
}
if (/addEventListener\s*\(\s*["']touch(start|move|end|cancel)["']/.test(moduleSource)) {
  throw new Error("mastermind.mjs must rely on plain clicks/taps, not touch timers");
}
if (/(^|\n)\s*(html|body|\*|:root)\s*\{/.test(cssSource)) {
  throw new Error("mastermind.css must not style global selectors");
}
if (!/\.mm-app\s*\{/.test(cssSource)) throw new Error("mastermind.css must define .mm-app styles");
if (!/<svg[\s\S]*<\/svg>/.test(iconSource) ||
    /<image|<use\s+href|\bhttp:\/\/www\.(w3|w3c)/.test(iconSource.replace("http://www.w3.org/2000/svg", ""))) {
  throw new Error("icon-mastermind.svg must be an original inline SVG with no embedded/remote images");
}
console.log("static checks: mount export, real engine import, icon, no global listeners, no markup injection, app-scoped CSS PASS");

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
<title>Mastermind UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/mastermind.css">
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
    var colours = [0.08, 0.25, 0.42, 0.58, 0.75, 0.92];
    window.__rngValues = colours;
    window.__rngIndex = 0;
    Math.random = function () {
      return window.__rngValues[window.__rngIndex++ % window.__rngValues.length];
    };
  })();
</script>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar">
    <button id="outside" type="button">Outside control</button>
    <span>Focus here to prove the Mastermind keyboard is scoped</span>
  </div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { mount } from "/findows/js/apps/mastermind.mjs";
  const controller = new AbortController();
  window.__mmAbort = controller;
  window.__mmHandle = await mount({
    container: document.getElementById("app"),
    windowId: "mastermind-ui-test",
    fileId: null,
    services: {},
    signal: controller.signal,
  });
  window.__mmReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__mastermind-ui-harness.html") {
      response.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
      response.end(HARNESS_HTML);
      return;
    }
    if (url.pathname === "/favicon.ico") {
      response.writeHead(200, { "content-type": "image/x-icon", "cache-control": "no-store" });
      response.end();
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
console.log(`mastermind UI harness serving ${ROOT} at ${BASE}`);

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

async function openHarness(page) {
  await page.goto(`${BASE}/__mastermind-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__mmReady === true, null, { timeout: 5000 });
}
const phase = (page) => page.locator(".mm-app").getAttribute("data-phase");
const message = (page) => page.locator(".mm-message").innerText();
const counter = (page) => page.locator(".mm-counter").innerText();
const slot = (page, index) => page.locator(`.mm-slot[data-index="${index}"]`);
const palette = (page, value) => page.locator(`.mm-color[data-value="${value}"]`);
const historyCount = (page) => page.locator(".mm-history-row").count();

/** Fill the current guess with the given colour values using keyboard digits. */
async function typeGuess(page, values) {
  await slot(page, 0).focus();
  for (const value of values) await page.keyboard.press(String(value + 1));
}

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, fixed board dimensions and hidden secret");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__mmHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await page.locator(".mm-app").count()) === 1 &&
     (await page.locator(".mm-app").getAttribute("data-window-id")) === "mastermind-ui-test",
    "the app root is mounted with its window id");
  ok((await page.locator(".mm-slot").count()) === 4 && (await page.locator(".mm-color").count()) === 6,
    "board has four guess slots and six colour choices");
  ok((await counter(page)).includes("10") && (await phase(page)) === "playing",
    "a fresh game shows ten guesses left");
  ok((await page.locator(".mm-submit").isDisabled()) === true,
    "submit is disabled until all four slots are filled");
  ok((await page.locator(".mm-message").getAttribute("role")) === "status" &&
     (await page.locator(".mm-message").getAttribute("aria-live")) === "polite",
    "message is a polite live status region");
  ok((await page.locator(".mm-secret").count()) === 0,
    "the secret is not rendered during play");
  const initialSlots = await page.locator(".mm-slot").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
  ok(initialSlots.every((label) => /Slot [1-4], empty/i.test(label || "")),
    "every slot starts empty and is labelled for assistive tech");
  await shot(page, "mastermind-desktop-dark.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(120);
  await shot(page, "mastermind-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  log("keyboard entry, native submit and exact feedback");
  await typeGuess(page, [0, 1, 2, 3]);
  const filled = await page.locator(".mm-slot").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
  ok(filled.every((label) => /Slot [1-4], (Red|Blue|Green|Yellow)/i.test(label || "")),
    `digits 1-4 fill slots with named colours (${JSON.stringify(filled)})`);
  ok((await page.locator(".mm-submit").isEnabled()) === true, "submit enables when all slots are filled");
  await page.keyboard.press("Enter");
  ok((await phase(page)) === "won" && (await message(page)).toLowerCase().includes("won"),
    "submitting the exact code wins and announces the result");
  ok((await historyCount(page)) === 1 &&
     (await page.locator(".mm-history-row").first().innerText()).includes("4 exact"),
    "the guess history shows four exact hits");
  ok((await page.locator(".mm-secret").count()) === 1 &&
     (await page.locator(".mm-secret").innerText()).includes("Red"),
    "the secret is revealed only after the game ends");
  const lockedSlots = await page.locator(".mm-slot").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
  await slot(page, 0).focus();
  await page.keyboard.press("1");
  ok(JSON.stringify(await page.locator(".mm-slot").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")))) === JSON.stringify(lockedSlots),
    "keyboard input is locked after a win");
  await shot(page, "mastermind-won.png");

  log("new game resets and uses the next deterministic secret");
  await page.locator(".mm-reset").click();
  ok((await phase(page)) === "playing" && (await counter(page)).includes("10") &&
     (await historyCount(page)) === 0 && (await page.locator(".mm-secret").count()) === 0,
    "New game clears history, slots and the revealed secret");
  await typeGuess(page, [4, 5, 0, 1]);
  await page.locator(".mm-submit").click();
  const secondGame = { phase: await phase(page), message: await message(page),
    rows: await page.locator(".mm-history-row").allInnerTexts() };
  ok((await phase(page)) === "won", `the post-reset secret [4,5,0,1] can be cracked (${JSON.stringify(secondGame)})`);

  log("wrong guesses lose after the limit and lock play");
  await page.locator(".mm-reset").click();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await typeGuess(page, [0, 0, 0, 0]);
    await page.locator(".mm-submit").click();
  }
  ok((await phase(page)) === "lost" && (await message(page)).toLowerCase().includes("lost"),
    "the tenth wrong guess loses and announces the result");
  ok((await counter(page)).includes("0") && (await historyCount(page)) === 10,
    "ten guesses are spent and each one is recorded");
  ok((await page.locator(".mm-secret").count()) === 1 && (await page.locator(".mm-submit").isDisabled()),
    "loss reveals the secret and disables submit");
  const lockedHistory = await historyCount(page);
  await slot(page, 0).focus();
  await page.keyboard.press("1");
  ok((await historyCount(page)) === lockedHistory, "play is locked after a loss");
  await shot(page, "mastermind-lost.png");

  log("R restarts and keyboard stays scoped to the app");
  await page.keyboard.press("r");
  ok((await phase(page)) === "playing" && (await historyCount(page)) === 0,
    "R starts a fresh game from the terminal phase");
  await typeGuess(page, [0, 0, 0, 0]);
  const beforeOutside = await page.locator(".mm-slot").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")).join("|"));
  await page.locator("#outside").focus();
  await page.keyboard.press("1");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("r");
  const afterOutside = await page.locator(".mm-slot").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")).join("|"));
  ok(beforeOutside === afterOutside && (await page.locator(".mm-slot").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")).join("|"))) === beforeOutside,
    "typing outside the app cannot reach its keyboard shortcuts");

  log("compact touch layout at 390x844");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const compact = await mp.evaluate(() => {
    const app = document.querySelector(".mm-app");
    const host = document.querySelector(".harness-host");
    const palette = document.querySelector(".mm-palette").getBoundingClientRect();
    const submit = document.querySelector(".mm-submit").getBoundingClientRect();
    const colours = [...document.querySelectorAll(".mm-color")].map((n) => n.getBoundingClientRect().width);
    return {
      appWidth: app.getBoundingClientRect().width, hostWidth: host.getBoundingClientRect().width,
      appScroll: app.scrollWidth, appClient: app.clientWidth,
      paletteRight: palette.right, hostRight: host.getBoundingClientRect().right,
      submitBottom: submit.bottom, hostBottom: host.getBoundingClientRect().bottom,
      min: Math.min(...colours),
    };
  });
  ok(compact.appWidth <= compact.hostWidth + 1 && compact.appScroll <= compact.appClient + 1 &&
     compact.paletteRight <= compact.hostRight + 1 && compact.min >= 30,
    `compact layout fits 390px with usable peg buttons (${JSON.stringify(compact)})`);
  ok(compact.submitBottom <= compact.hostBottom + 1, "submit stays inside the 390x844 host");
  await palette(mp, 5).tap();
  ok((await slot(mp, 0).getAttribute("aria-label")).includes("Orange"),
    "a plain tap on a colour fills the next empty slot");
  await slot(mp, 2).tap();
  await palette(mp, 1).tap();
  ok((await slot(mp, 2).getAttribute("aria-label")).includes("Blue"),
    "tapping a slot then a colour fills the chosen slot");
  await shot(mp, "mastermind-compact-390.png");

  log("short landscape at 844x390");
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.waitForTimeout(100);
  const landscape = await mp.evaluate(() => {
    const app = document.querySelector(".mm-app");
    const host = document.querySelector(".harness-host");
    const submit = document.querySelector(".mm-submit").getBoundingClientRect();
    const palette = document.querySelector(".mm-palette").getBoundingClientRect();
    return {
      appBottom: app.getBoundingClientRect().bottom, hostBottom: host.getBoundingClientRect().bottom,
      submitBottom: submit.bottom, paletteBottom: palette.bottom, appScroll: app.scrollWidth, appClient: app.clientWidth,
    };
  });
  ok(landscape.appBottom <= landscape.hostBottom + 1 && landscape.submitBottom <= landscape.hostBottom + 1 &&
     landscape.paletteBottom <= landscape.hostBottom + 1 && landscape.appScroll <= landscape.appClient + 1,
    `short landscape keeps the whole game usable (${JSON.stringify(landscape)})`);
  await shot(mp, "mastermind-landscape-844x390.png");
  await phone.close();

  log("dispose through signal and idempotent handle.dispose");
  await page.evaluate(() => window.__mmAbort.abort());
  ok((await page.locator(".mm-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__mmHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);

  log("ALL MASTERMIND UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`MASTERMIND UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
