/* Focused World Clock UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/world-clock-browser.mjs [--port=8855] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8855 and mounts the production module in a
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
const PORT = Number(arg("port", "8855"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE || process.env.FINDOWS_PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks before the browser: fail fast on a missing lane. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/world-clock.mjs"), "utf8");
const engineSource = readFileSync(resolve(ROOT, "findows/js/apps/world-clock-engine.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/world-clock.css"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("world-clock.mjs must export async function mount()");
}
if (/innerHTML|outerHTML|\beval\s*\(|new\s+Function\s*\(/.test(`${moduleSource}${engineSource}`)) {
  throw new Error("World Clock must not use innerHTML, eval or dynamic code");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("world-clock.mjs must not register document/window listeners");
}
if (/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(`${moduleSource}${engineSource}`)) {
  throw new Error("World Clock must not make network requests");
}
if (!/\btimeZone\s*:/.test(`${moduleSource}${engineSource}`)) {
  throw new Error("World Clock must format through Intl with an explicit timeZone");
}
if (!/clearInterval\s*\(/.test(moduleSource)) {
  throw new Error("world-clock.mjs must clear its intervals");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".world-clock-") && !line.startsWith("@") &&
    !/^(from|to|\d+(?:\.\d+)?%)$/.test(line.slice(0, -1).trim()));
if (badSelectors.length) {
  throw new Error(`world-clock.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
const svg = readFileSync(resolve(ROOT, "findows/assets/icon-world-clock.svg"), "utf8");
if (!svg.trimStart().startsWith("<svg") || !svg.includes('viewBox="0 0 64 64"') ||
    /<script|onload=|href="https?:/i.test(svg)) {
  throw new Error("icon-world-clock.svg must be a local, original 64×64 SVG without scripts");
}
console.log("static checks: mount export, no dynamic code, no global listeners, no network, explicit timeZone, interval cleanup, scoped CSS, local icon PASS");

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
<title>World Clock UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/world-clock.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-shell{padding:12px}
  .harness-host{width:min(760px,calc(100vw - 24px));height:min(620px,calc(100vh - 36px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  @media (max-width:600px),(max-height:499px){
    .harness-host{width:calc(100vw - 20px);height:min(640px,calc(100vh - 20px))}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  const { mount } = await import("/findows/js/apps/world-clock.mjs");
  const controller = new AbortController();
  window.__worldClockAbort = controller;
  window.__worldClockHandle = await mount({
    container: document.getElementById("app"),
    windowId: "world-clock-ui-test",
    fileId: null,
    mode: null,
    draftId: null,
    services: {},
    signal: controller.signal,
  });
  window.__worldClockReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__world-clock-harness.html") {
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
console.log(`World Clock UI harness serving ${ROOT} at ${BASE}`);

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
    try {
      const url = new URL(request.url());
      if (["http:", "https:"].includes(url.protocol) && url.hostname !== "127.0.0.1") {
        externalRequests.push(`${url.protocol}//${url.host}`);
      }
    } catch {
      /* non-URL requests are irrelevant */
    }
  });
}

const browser = await chromium.launch({ headless: true });
async function newContext(options = {}) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    window.__worldClockTimers = new Set();
    const nativeSet = window.setInterval.bind(window);
    const nativeClear = window.clearInterval.bind(window);
    window.setInterval = (...args) => {
      const id = nativeSet(...args);
      window.__worldClockTimers.add(id);
      return id;
    };
    window.clearInterval = (id) => {
      window.__worldClockTimers.delete(id);
      return nativeClear(id);
    };
  });
  return context;
}
async function fixedDateScript(iso) {
  return `(() => {
    const RealDate = Date;
    const fixed = new RealDate(${JSON.stringify(iso)});
    class FixedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(fixed.getTime());
        else super(...args);
      }
      static now() { return fixed.getTime(); }
    }
    window.Date = FixedDate;
  })()`;
}
async function openHarness(page, extraScript = "") {
  if (extraScript) await page.addInitScript(extraScript);
  await page.goto(`${BASE}/__world-clock-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__worldClockReady === true, null, { timeout: 5000 });
}
const text = (page, selector) => page.locator(selector).innerText();
const timeOf = (page, zone) => text(page, `[data-zone="${zone}"] .world-clock-zone-time`);
const dateKeyOf = (page, zone) => page.locator(`[data-zone="${zone}"] .world-clock-zone-date`).getAttribute("datetime");
const cardCount = (page) => page.locator(".world-clock-zone-card").count();

try {
  log("mount contract, curated cards, labels and accessible time/date");
  const desktop = await newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__worldClockHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
     `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await cardCount(page)) >= 4, `several zones are mounted by default (${await cardCount(page)})`);
  const londonLabel = await text(page, '[data-zone="Europe/London"] .world-clock-zone-label');
  const londonId = await text(page, '[data-zone="Europe/London"] .world-clock-zone-id');
  ok(londonLabel === "London" && londonId === "Europe/London",
     `cards expose a friendly label and the IANA id (${londonLabel} / ${londonId})`);
  ok(/^\d{2}:\d{2}:\d{2}$/.test(await timeOf(page, "Europe/London")) &&
     Boolean(await page.locator('[data-zone="Europe/London"] .world-clock-zone-time').getAttribute("datetime")),
     "local time is rendered in a time element with an instant datetime");
  ok(Boolean(await dateKeyOf(page, "Asia/Tokyo")) &&
     (await text(page, ".world-clock-note")).includes("No internet"),
     "local date and the offline note are exposed");
  ok((await page.locator(".world-clock-zone-list option").count()) >= 10,
     "the entry field is backed by a local curated datalist");
  await shot(page, "world-clock-desktop-dark.png");

  log("DST correctness from one instant, plus a local-day rollover");
  const summer = await newContext({ viewport: { width: 900, height: 700 } });
  const summerPage = await summer.newPage();
  watch(summerPage);
  await openHarness(summerPage, await fixedDateScript("2026-07-01T12:00:00Z"));
  ok((await timeOf(summerPage, "UTC")) === "12:00:00" &&
     (await timeOf(summerPage, "Europe/London")) === "13:00:00" &&
     (await timeOf(summerPage, "America/New_York")) === "08:00:00",
     "summer wall times apply British and US daylight saving");
  ok((await text(summerPage, '[data-zone="Europe/London"] .world-clock-zone-offset')) === "UTC+01:00" &&
     (await text(summerPage, '[data-zone="America/New_York"] .world-clock-zone-offset')) === "UTC-04:00",
     "summer offsets are labelled with DST applied");

  const winter = await newContext({ viewport: { width: 900, height: 700 } });
  const winterPage = await winter.newPage();
  watch(winterPage);
  await openHarness(winterPage, await fixedDateScript("2026-01-01T12:00:00Z"));
  ok((await timeOf(winterPage, "Europe/London")) === "12:00:00" &&
     (await timeOf(winterPage, "America/New_York")) === "07:00:00" &&
     (await text(winterPage, '[data-zone="Europe/London"] .world-clock-zone-offset')) === "UTC+00:00",
     "winter wall times and offsets drop back to standard time");

  const rollover = await newContext({ viewport: { width: 900, height: 700 } });
  const rolloverPage = await rollover.newPage();
  watch(rolloverPage);
  await openHarness(rolloverPage, await fixedDateScript("2026-07-01T20:00:00Z"));
  ok((await timeOf(rolloverPage, "Asia/Tokyo")) === "05:00:00" &&
     (await dateKeyOf(rolloverPage, "Asia/Tokyo")) === "2026-07-02",
     "the date element carries the local calendar day, not the UTC day");
  await rollover.close();
  await winter.close();
  await summer.close();

  log("add via keyboard, invalid zone and duplicate handling, remove via keyboard");
  const input = page.locator(".world-clock-zone-input");
  const addButton = page.locator(".world-clock-add-button");
  const error = page.locator(".world-clock-error");
  await input.fill("Australia/Sydney");
  await input.press("Enter");
  ok((await cardCount(page)) === 5 &&
     (await text(page, '[data-zone="Australia/Sydney"] .world-clock-zone-label')) === "Sydney",
     "Enter in the field adds a curated zone from the local list");
  ok((await text(page, ".world-clock-sr-status")).toLowerCase().includes("added"),
     "adding a zone is announced politely");

  await input.fill("Mars/Olympus");
  await addButton.click();
  ok((await cardCount(page)) === 5 && (await error.isVisible()) &&
     /time zone/i.test(await error.innerText()) &&
     (await input.getAttribute("aria-invalid")) === "true",
     "an invalid zone shows an inline error and adds no card");
  await input.fill("UTC");
  await input.press("Enter");
  ok((await cardCount(page)) === 5 && /already/i.test(await error.innerText()),
     "a duplicate zone is rejected with a clear message");
  await input.fill("");
  ok(!(await error.isVisible()), "editing the field clears the error");

  await page.focus('[data-zone="Australia/Sydney"] .world-clock-remove-button');
  await page.keyboard.press("Enter");
  ok((await cardCount(page)) === 4 && (await page.locator('[data-zone="Australia/Sydney"]').count()) === 0 &&
     (await text(page, ".world-clock-sr-status")).toLowerCase().includes("removed"),
     "Enter on a focused Remove button deletes the card and announces it");

  log("light theme and distinct zones stay readable");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(200);
  const distinctTimes = await page.locator(".world-clock-zone-time").allInnerTexts();
  ok(new Set(distinctTimes).size >= 3,
     `the mounted zones show distinct local times (${distinctTimes.join(" | ")})`);
  await shot(page, "world-clock-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  log("390×844 touch layout and 844×390 landscape stay reachable");
  const phone = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const controlHeights = await mp.locator(".world-clock-add-button, .world-clock-remove-button").evaluateAll(
    (nodes) => nodes.filter((node) => node.getClientRects().length > 0).map((node) => node.getBoundingClientRect().height));
  ok(controlHeights.every((height) => height >= 44),
     `compact controls are at least 44px (min ${Math.min(...controlHeights).toFixed(1)})`);
  await mp.locator(".world-clock-zone-input").fill("Europe/Paris");
  await mp.tap(".world-clock-add-button");
  ok((await cardCount(mp)) === 5 &&
     (await text(mp, '[data-zone="Europe/Paris"] .world-clock-zone-label')) === "Paris",
     "touch can add a curated zone");
  await shot(mp, "world-clock-compact-390.png");
  await mp.tap('[data-zone="Europe/Paris"] .world-clock-remove-button');
  ok((await cardCount(mp)) === 4, "touch can remove a zone");
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.evaluate(() => { document.querySelector(".world-clock-zones").scrollTop = 0; });
  await mp.waitForTimeout(120);
  ok((await mp.locator(".world-clock-zone-card").first().isVisible()) &&
     (await mp.locator(".world-clock-add-button").isVisible()),
     "short landscape keeps the cards and the add control reachable");
  await shot(mp, "world-clock-landscape-844x390.png");
  await phone.close();

  log("dispose clears timers, removes the surface and is idempotent");
  ok((await page.evaluate(() => window.__worldClockTimers.size)) >= 1,
     `the repaint interval is active (${await page.evaluate(() => window.__worldClockTimers.size)})`);
  await page.evaluate(() => window.__worldClockAbort.abort());
  ok((await page.locator(".world-clock-app").count()) === 0 &&
     (await page.evaluate(() => window.__worldClockTimers.size)) === 0,
     "abort removes the app and clears every interval");
  await page.evaluate(() => window.__worldClockHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);

  log("ALL WORLD CLOCK UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`WORLD CLOCK UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
