/* Focused Clock UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/clock-browser.mjs [--port=8800] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8800 and mounts the production module in a
   minimal harness because the shell registry is owned by the parent lane. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8800"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks before the browser: fail fast on a missing lane. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/clock.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/clock.css"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("clock.mjs must export async function mount()");
}
if (/Notification/.test(moduleSource)) {
  throw new Error("clock.mjs must not promise or call browser notifications");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("clock.mjs must not register document/window listeners");
}
if (!/clearInterval\s*\(/.test(moduleSource)) {
  throw new Error("clock.mjs must clear its intervals");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".clock-") && !line.startsWith("@") &&
    !/^(from|to|\d+(?:\.\d+)?%)$/.test(line.slice(0, -1).trim()));
if (badSelectors.length) {
  throw new Error(`clock.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
for (const name of ["icon-clock.svg", "icon-calculator.svg"]) {
  const svg = readFileSync(resolve(ROOT, `findows/assets/${name}`), "utf8");
  if (!svg.trimStart().startsWith("<svg") || !svg.includes('viewBox="0 0 64 64"') ||
      /<script|onload=|href="https?:/i.test(svg)) {
    throw new Error(`${name} must be a local, original 64×64 SVG without scripts`);
  }
}
console.log("static checks: mount export, no Notification, no global listeners, interval cleanup, scoped CSS, local icons PASS");

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
<title>Clock UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/clock.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-shell{padding:12px}
  .harness-host{width:min(720px,calc(100vw - 24px));height:min(560px,calc(100vh - 36px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  @media (max-width:600px),(max-height:499px){
    .harness-host{width:calc(100vw - 20px);height:min(620px,calc(100vh - 20px))}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  const mode = new URLSearchParams(location.search).get("mode") || "clock";
  const { mount } = await import("/findows/js/apps/clock.mjs");
  const controller = new AbortController();
  window.__clockAbort = controller;
  window.__clockHandle = await mount({
    container: document.getElementById("app"),
    windowId: "clock-ui-test",
    fileId: null,
    mode,
    draftId: null,
    services: {},
    signal: controller.signal,
  });
  window.__clockReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__clock-harness.html") {
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
console.log(`clock UI harness serving ${ROOT} at ${BASE}`);

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

const browser = await chromium.launch({ headless: true });
async function newContext(options) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    window.__clockTimers = new Set();
    const nativeSet = window.setInterval.bind(window);
    const nativeClear = window.clearInterval.bind(window);
    window.setInterval = (...args) => {
      const id = nativeSet(...args);
      window.__clockTimers.add(id);
      return id;
    };
    window.clearInterval = (id) => {
      window.__clockTimers.delete(id);
      return nativeClear(id);
    };
  });
  return context;
}
async function openHarness(page, mode = "") {
  await page.goto(`${BASE}/__clock-harness.html${mode ? `?mode=${mode}` : ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__clockReady === true, null, { timeout: 5000 });
}
const text = (page, selector) => page.locator(selector).innerText();

function parseStopwatch(value) {
  const match = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{2})$/);
  if (!match) throw new Error(`Unreadable stopwatch value ${JSON.stringify(value)}`);
  return (Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 + Number(match[4]) * 10;
}
function parseCountdown(value) {
  const match = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Unreadable countdown value ${JSON.stringify(value)}`);
  return (Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000;
}
async function setInputs(page, { hours = 0, minutes = 0, seconds = 0 }) {
  await page.locator('.clock-input[data-unit="hours"]').fill(String(hours));
  await page.locator('.clock-input[data-unit="minutes"]').fill(String(minutes));
  await page.locator('.clock-input[data-unit="seconds"]').fill(String(seconds));
}

try {
  log("mount contract, accessible local time and mode switching");
  const desktop = await newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__clockHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
     `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  const clockTime = await text(page, ".clock-current-time");
  const dateTime = await page.locator(".clock-current-time").getAttribute("datetime");
  ok(/\d{1,2}:\d{2}:\d{2}/.test(clockTime) && Boolean(dateTime),
     `local time is rendered in a time element (${clockTime} / ${dateTime})`);
  ok(Boolean(await page.locator(".clock-current-date").getAttribute("datetime")) &&
     (await text(page, ".clock-zone")).includes("Local time"),
     "local date and time zone are exposed");
  await shot(page, "clock-desktop-dark.png");

  const localDateContext = await newContext({
    viewport: { width: 900, height: 700 },
    timezoneId: "Pacific/Kiritimati",
  });
  await localDateContext.addInitScript(() => {
    const RealDate = Date;
    const fixed = new RealDate("2026-11-24T10:00:00Z");
    class FixedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(fixed.getTime());
        else super(...args);
      }
      static now() { return fixed.getTime(); }
    }
    window.Date = FixedDate;
  });
  const localPage = await localDateContext.newPage();
  watch(localPage);
  await openHarness(localPage);
  const localDateText = await text(localPage, ".clock-current-date");
  const localDateMachine = await localPage.locator(".clock-current-date").getAttribute("datetime");
  ok(localDateText.includes("25") && localDateMachine === "2026-11-25",
     `local date datetime matches the visible local day in UTC+14 (${localDateText} / ${localDateMachine})`);
  await localDateContext.close();

  await page.click('.clock-tab[data-mode="stopwatch"]');
  ok(await page.locator('[data-panel="stopwatch"]').isVisible() &&
     (await page.locator('.clock-tab[data-mode="stopwatch"]').getAttribute("aria-pressed")) === "true",
     "mode buttons switch panels with aria-pressed");
  await page.click('.clock-tab[data-mode="countdown"]');
  ok(await page.locator('[data-panel="countdown"]').isVisible() &&
     !(await page.locator('[data-panel="stopwatch"]').isVisible()),
     "only one panel is visible at a time");
  await page.click('.clock-tab[data-mode="clock"]');
  const initialMode = await newContext({ viewport: { width: 900, height: 700 } });
  const modePage = await initialMode.newPage();
  watch(modePage);
  await openHarness(modePage, "stopwatch");
  ok(await modePage.locator('[data-panel="stopwatch"]').isVisible(),
     "the mode argument opens the stopwatch directly");
  await initialMode.close();

  log("stopwatch start/pause/resume, laps, reset and timestamp-derived elapsed time");
  await page.click('.clock-tab[data-mode="stopwatch"]');
  const swDisplay = page.locator(".clock-stopwatch-display");
  const startButton = page.locator('[data-panel="stopwatch"] .clock-start');
  await startButton.click();
  ok((await startButton.innerText()) === "Pause", "Start becomes Pause while running");
  await page.waitForTimeout(260);
  const firstElapsed = parseStopwatch(await swDisplay.innerText());
  ok(firstElapsed >= 200, `elapsed time advances (${firstElapsed}ms)`);
  await startButton.click();
  const paused = await swDisplay.innerText();
  await page.waitForTimeout(350);
  ok((await swDisplay.innerText()) === paused, "paused stopwatch does not advance");
  await startButton.click();
  await page.waitForTimeout(260);
  ok(parseStopwatch(await swDisplay.innerText()) > parseStopwatch(paused), "resume continues from the stored elapsed time");

  await page.click('[data-panel="stopwatch"] [data-action="lap"]');
  await page.waitForTimeout(220);
  await page.click('[data-panel="stopwatch"] [data-action="lap"]');
  const laps = page.locator(".clock-lap");
  ok((await laps.count()) === 2, `two laps are recorded (found ${await laps.count()})`);
  const lapTexts = await laps.allInnerTexts();
  ok(lapTexts.some((entry) => /#2/.test(entry)) && lapTexts.some((entry) => /#1/.test(entry)),
     `laps are numbered newest first (${lapTexts.join(" | ")})`);
  await shot(page, "clock-stopwatch.png");

  await page.click('[data-panel="stopwatch"] [data-action="reset"]');
  const afterReset = await swDisplay.innerText();
  ok(afterReset === "00:00.00" && (await laps.count()) === 0,
     `reset clears elapsed time and laps (display ${JSON.stringify(afterReset)}, laps ${await laps.count()})`);

  log("minimizing hides without resetting; keyboard activation stays native");
  await startButton.click();
  await page.waitForTimeout(200);
  const beforeHide = parseStopwatch(await swDisplay.innerText());
  await page.evaluate(() => { document.getElementById("app").hidden = true; });
  await page.waitForTimeout(320);
  await page.evaluate(() => { document.getElementById("app").hidden = false; });
  const afterShow = parseStopwatch(await swDisplay.innerText());
  ok(afterShow > beforeHide, `hidden app keeps time from timestamps (${beforeHide}ms → ${afterShow}ms)`);
  await startButton.focus();
  await page.keyboard.press("Enter");
  ok((await startButton.innerText()) === "Start", "Enter toggles the focused stopwatch button once");
  await page.locator('[data-panel="stopwatch"] [data-action="reset"]').focus();
  await page.keyboard.press("Space");
  ok((await swDisplay.innerText()) === "00:00.00", "Space activates the focused reset button");

  log("countdown validation, presets, pause/resume and a single completion transition");
  await page.click('.clock-tab[data-mode="countdown"]');
  const cdDisplay = page.locator(".clock-countdown-display");
  const cdStart = page.locator('[data-panel="countdown"] .clock-start');
  await setInputs(page, { seconds: 60 });
  await cdStart.click();
  ok(await page.locator(".clock-validation").isVisible() && (await cdDisplay.innerText()) === "00:00",
     "out-of-range seconds are rejected before the timer starts");
  await page.click('.clock-preset[data-seconds="300"]');
  ok((await page.locator('.clock-input[data-unit="minutes"]').inputValue()) === "5",
     "preset fills the duration fields");

  await setInputs(page, { seconds: 3 });
  await cdStart.click();
  await page.waitForTimeout(1200);
  const remaining = parseCountdown(await cdDisplay.innerText());
  ok(remaining > 0 && remaining <= 2_000, `countdown counts down from the duration (${remaining}ms left)`);
  await cdStart.click();
  const held = await cdDisplay.innerText();
  await page.waitForTimeout(350);
  ok((await cdDisplay.innerText()) === held, "pause holds the remaining time");
  await cdStart.click();
  await page.waitForTimeout(1200);
  ok(parseCountdown(await cdDisplay.innerText()) < parseCountdown(held), "resume continues the countdown");
  await page.click('[data-panel="countdown"] [data-action="reset"]');
  ok((await cdDisplay.innerText()) === "00:00" && !(await page.locator(".clock-finished").isVisible()),
     "reset returns the countdown to its idle display");

  await setInputs(page, { seconds: 1 });
  await cdStart.click();
  await page.waitForTimeout(1350);
  const finished = page.locator(".clock-finished");
  ok(await finished.isVisible() && (await finished.innerText()).includes("Time's up") &&
     (await cdDisplay.innerText()) === "00:00",
     "completion shows the finished message once and stops at zero");
  ok((await finished.getAttribute("class")).includes("is-complete") &&
     (await finished.evaluate((node) => getComputedStyle(node).animationIterationCount)) === "1",
     "the finished transition runs once");
  ok((await text(page, '[data-panel="countdown"] .clock-note')).includes("Keep this window open"),
     "the UI does not promise background notifications");
  await shot(page, "clock-countdown-complete.png");
  const statusAfter = await text(page, ".clock-sr-status");
  await page.waitForTimeout(600);
  ok((await text(page, ".clock-sr-status")) === statusAfter && (await cdDisplay.innerText()) === "00:00",
     "a completed timer never completes twice or goes negative");
  await page.click('[data-panel="countdown"] [data-action="reset"]');
  ok(!(await finished.isVisible()) && (await cdStart.innerText()) === "Start",
     "reset clears the finished state and allows a new countdown");

  log("light theme and compact layouts");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(220);
  await shot(page, "clock-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  const phone = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp, "countdown");
  const controlHeights = await mp.locator(".clock-btn, .clock-tab, .clock-preset").evaluateAll(
    (nodes) => nodes.filter((node) => node.getClientRects().length > 0).map((node) => node.getBoundingClientRect().height));
  ok(controlHeights.every((height) => height >= 44),
     `compact controls are at least 44px (min ${Math.min(...controlHeights).toFixed(1)})`);
  await mp.tap('.clock-preset[data-seconds="60"]');
  await mp.tap('[data-panel="countdown"] .clock-start');
  ok((await mp.locator('[data-panel="countdown"] .clock-start').innerText()) === "Pause",
     "touch can start a countdown");
  await shot(mp, "clock-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator("[data-panel='countdown']").isVisible() &&
     (await mp.locator('[data-panel="countdown"] .clock-start').isVisible()),
     "short landscape keeps the countdown controls reachable");
  await shot(mp, "clock-landscape-844x390.png");
  await phone.close();

  log("dispose clears intervals and removes the surface");
  await page.click('.clock-tab[data-mode="clock"]');
  await page.click('.clock-tab[data-mode="stopwatch"]');
  await page.click('[data-panel="stopwatch"] .clock-start');
  ok((await page.evaluate(() => window.__clockTimers.size)) >= 2,
     `wall clock and ticking intervals are active (${await page.evaluate(() => window.__clockTimers.size)})`);
  await page.evaluate(() => window.__clockAbort.abort());
  ok((await page.locator(".clock-app").count()) === 0 &&
     (await page.evaluate(() => window.__clockTimers.size)) === 0,
     "abort removes the app and clears every interval");
  await page.evaluate(() => window.__clockHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL CLOCK UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`CLOCK UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
