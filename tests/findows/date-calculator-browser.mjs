/* Focused Date Calculator UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/date-calculator-browser.mjs [--port=8854] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8854 and mounts the production module in a
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
const PORT = Number(arg("port", "8854"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

/* Static contract checks before the browser: fail fast on a missing lane. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/date-calculator.mjs"), "utf8");
const engineSource = readFileSync(resolve(ROOT, "findows/js/apps/date-calculator-engine.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/date-calculator.css"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("date-calculator.mjs must export async function mount()");
}
if (/innerHTML|outerHTML|\beval\s*\(|new\s+Function\s*\(/.test(moduleSource + engineSource)) {
  throw new Error("date calculator must not use markup injection or dynamic code");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("date-calculator.mjs must not register document/window listeners");
}
if (/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/.test(moduleSource + engineSource + cssSource)) {
  throw new Error("date calculator must not make network requests");
}
if (/https?:\/\//.test(moduleSource + cssSource)) {
  throw new Error("date calculator must not reference remote resources");
}
if (!/signal/.test(moduleSource) || !/replaceChildren\s*\(/.test(moduleSource)) {
  throw new Error("date calculator must honor abort signal and replaceChildren mount contract");
}
if (!/dispose\s*\(/.test(moduleSource)) {
  throw new Error("date calculator must provide dispose()");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".datecalc-") && !line.startsWith("@"));
if (badSelectors.length) {
  throw new Error(`date-calculator.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
for (const name of ["icon-date-calculator.svg"]) {
  const svg = readFileSync(resolve(ROOT, `findows/assets/${name}`), "utf8");
  if (!svg.trimStart().startsWith("<svg") || !svg.includes('viewBox="0 0 64 64"') ||
      /<script|onload=|href="https?:/i.test(svg)) {
    throw new Error(`${name} must be a local, original 64×64 SVG without scripts`);
  }
}
console.log("static checks: mount export, no dynamic code or global listeners, scoped CSS, no network, local icon PASS");

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
<title>Date calculator UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/date-calculator.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-shell{padding:12px}
  .harness-host{width:min(720px,calc(100vw - 24px));height:min(600px,calc(100vh - 36px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:auto}
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
  const mode = new URLSearchParams(location.search).get("mode") || "between";
  const { mount } = await import("/findows/js/apps/date-calculator.mjs");
  const controller = new AbortController();
  window.__dcAbort = controller;
  window.__dcHandle = await mount({
    container: document.getElementById("app"),
    windowId: "date-calculator-ui-test",
    fileId: null,
    mode,
    draftId: null,
    services: {},
    signal: controller.signal,
  });
  window.__dcReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__date-calculator-harness.html") {
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
console.log(`date calculator UI harness serving ${ROOT} at ${BASE}`);

let step = 0;
const log = (message) => console.log(`[${String(++step).padStart(2, "0")}] ${message}`);
const ok = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`      PASS ${message}`);
};
const shot = (page, name) => page.screenshot({ path: resolve(OUT, name), fullPage: false });

const consoleErrors = [];
const badResponses = [];
const requests = [];
function watch(page) {
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => requests.push(request.url()));
}

const browser = await chromium.launch({ headless: true });
async function newContext(options) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    window.__dcListeners = { added: 0, removed: 0, signalAdded: 0, signalRemoved: 0 };
    const nativeAdd = Element.prototype.addEventListener;
    const nativeRemove = Element.prototype.removeEventListener;
    const inside = (node) => Boolean(node?.closest?.(".datecalc-app"));
    Element.prototype.addEventListener = function (type, fn, options) {
      if (inside(this)) window.__dcListeners.added += 1;
      return nativeAdd.call(this, type, fn, options);
    };
    Element.prototype.removeEventListener = function (type, fn, options) {
      if (inside(this)) window.__dcListeners.removed += 1;
      return nativeRemove.call(this, type, fn, options);
    };
    const signalAdd = AbortSignal.prototype.addEventListener;
    const signalRemove = AbortSignal.prototype.removeEventListener;
    AbortSignal.prototype.addEventListener = function (...args) {
      window.__dcListeners.signalAdded += 1;
      return signalAdd.apply(this, args);
    };
    AbortSignal.prototype.removeEventListener = function (...args) {
      window.__dcListeners.signalRemoved += 1;
      return signalRemove.apply(this, args);
    };
  });
  return context;
}
async function openHarness(page, mode = "") {
  await page.goto(`${BASE}/__date-calculator-harness.html${mode ? `?mode=${mode}` : ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__dcReady === true, null, { timeout: 5000 });
}
const text = (page, selector) => page.locator(selector).innerText();
const setDate = (page, field, value) => page.locator(`.datecalc-date[data-field="${field}"]`).fill(value);

try {
  log("mount contract, mode tabs and the exact 30-day acceptance case");
  const desktop = await newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__dcHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
     `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok(await page.locator('[data-panel="between"]').isVisible() &&
     !(await page.locator('[data-panel="shift"]').isVisible()) &&
     (await page.locator('.datecalc-tab[data-mode="between"]').getAttribute("aria-pressed")) === "true",
     "only the default panel is visible with matching aria-pressed");

  await setDate(page, "from", "2026-01-01");
  await setDate(page, "to", "2026-01-31");
  ok((await text(page, ".datecalc-span-value")).trim() === "30" &&
     (await page.locator(".datecalc-span-unit").textContent()).trim() === "days",
     `2026-01-01 to 2026-01-31 renders 30 days (value=${JSON.stringify(await text(page, ".datecalc-span-value"))}, unit=${JSON.stringify(await page.locator(".datecalc-span-unit").textContent())})`);
  ok((await text(page, ".datecalc-span-detail")).includes("2026"),
     "the result names both dates in readable form");
  await shot(page, "date-calculator-desktop-dark.png");

  log("invalid dates are rejected in the production engine and surfaced in the UI");
  const invalidEngine = await page.evaluate(async () => {
    const engine = await import("/findows/js/apps/date-calculator-engine.mjs");
    return {
      leap: engine.isValidLocalDate("2024-02-29"),
      nonLeap: engine.isValidLocalDate("2025-02-29"),
      feb30: engine.isValidLocalDate("2026-02-30"),
      badFormat: engine.isValidLocalDate("01/01/2026"),
    };
  });
  ok(invalidEngine.leap && !invalidEngine.nonLeap && !invalidEngine.feb30 && !invalidEngine.badFormat,
     `engine rejects impossible dates (${JSON.stringify(invalidEngine)})`);
  await setDate(page, "to", "");
  ok(await page.locator('[data-panel="between"] .datecalc-validation').isVisible() &&
     (await page.locator('.datecalc-date[data-field="to"]').getAttribute("aria-invalid")) === "true" &&
     (await text(page, "[data-panel='between'] .datecalc-span-value")).trim() === "—",
     "a missing date shows an alert, marks the field and blanks the result");
  await setDate(page, "to", "2026-01-31");
  ok(!(await page.locator('[data-panel="between"] .datecalc-validation').isVisible()),
     "correcting the date clears the validation alert");

  log("swap, presets and leap-year span in the live UI");
  await page.click(".datecalc-swap");
  ok((await text(page, ".datecalc-span-value")).trim() === "-30",
     "swap reverses the signed day count");
  await page.click('.datecalc-preset[data-preset="next30"]');
  ok((await text(page, ".datecalc-span-value")).trim() === "30" &&
     (await page.locator('.datecalc-date[data-field="from"]').inputValue()).length === 10,
     "the Next 30 days preset fills a real range");
  await setDate(page, "from", "2024-02-28");
  await setDate(page, "to", "2024-03-01");
  ok((await text(page, ".datecalc-span-value")).trim() === "2",
     "leap day is counted in the UI span");
  await shot(page, "date-calculator-leap-span.png");

  log("add/subtract days and months with native keyboard controls");
  await page.click('.datecalc-tab[data-mode="shift"]');
  ok(await page.locator('[data-panel="shift"]').isVisible() &&
     (await page.locator('.datecalc-tab[data-mode="shift"]').getAttribute("aria-pressed")) === "true",
     "mode tabs switch panels");
  await setDate(page, "date", "2026-01-01");
  await page.locator('.datecalc-amount').fill("30");
  ok((await text(page, ".datecalc-date-value")).trim() === "2026-01-31",
     `2026-01-01 plus 30 days renders 2026-01-31 (${await text(page, ".datecalc-date-value")})`);
  ok((await text(page, ".datecalc-date-detail")).includes("2026"),
     "the resulting date is also described in words");

  await page.locator('.datecalc-amount').focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("1");
  await page.locator('.datecalc-unit').selectOption("months");
  ok((await text(page, ".datecalc-date-value")).trim() === "2026-02-01",
     "keyboard-typed months update the result live");
  await setDate(page, "date", "2024-01-31");
  ok((await text(page, ".datecalc-date-value")).trim() === "2024-02-29",
     "month addition clamps to the leap-year end of month");
  await page.click('.datecalc-direction[data-direction="subtract"]');
  ok((await page.locator('.datecalc-direction[data-direction="subtract"]').getAttribute("aria-pressed")) === "true" &&
     (await text(page, ".datecalc-date-value")).trim() === "2023-12-31",
     `subtract direction updates aria-pressed and the date (value=${JSON.stringify(await text(page, ".datecalc-date-value"))})`);
  await page.locator('.datecalc-direction[data-direction="add"]').focus();
  await page.keyboard.press("Enter");
  ok((await text(page, ".datecalc-date-value")).trim() === "2024-02-29",
     "Enter activates the focused Add button exactly once");
  await page.locator(".datecalc-today").focus();
  await page.keyboard.press("Space");
  ok((await page.locator('.datecalc-date[data-field="date"]').inputValue()).length === 10,
     "Space activates Use today and fills a real date");
  await shot(page, "date-calculator-shift-desktop.png");

  log("light theme and compact viewport checks");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(120);
  await shot(page, "date-calculator-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  const phone = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const controlHeights = await mp.locator(".datecalc-tab, .datecalc-preset, .datecalc-direction, .datecalc-swap, .datecalc-today, .datecalc-input").evaluateAll(
    (nodes) => nodes.filter((node) => node.getClientRects().length > 0).map((node) => node.getBoundingClientRect().height));
  ok(controlHeights.every((height) => height >= 44),
     `compact controls are at least 44px (min ${Math.min(...controlHeights).toFixed(1)})`);
  await mp.tap('.datecalc-tab[data-mode="shift"]');
  await mp.tap('.datecalc-direction[data-direction="subtract"]');
  ok((await mp.locator('.datecalc-direction[data-direction="subtract"]').getAttribute("aria-pressed")) === "true",
     "touch can switch panels and directions");
  await setDate(mp, "date", "2024-03-31");
  ok((await text(mp, ".datecalc-date-value")).trim().length === 10,
     "touch viewport keeps the date result live");
  await shot(mp, "date-calculator-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  await mp.waitForTimeout(80);
  ok(await mp.locator('[data-panel="shift"]').isVisible() &&
     await mp.locator(".datecalc-date-value").isVisible() &&
     await mp.locator(".datecalc-today").isVisible(),
     "short landscape keeps the result and controls reachable");
  await shot(mp, "date-calculator-landscape-844x390.png");
  await phone.close();

  log("dispose removes listeners and the surface; no external requests");
  const before = await page.evaluate(() => ({ ...window.__dcListeners }));
  ok(before.added > 0 && before.signalAdded > 0,
     `listeners are registered while mounted (${JSON.stringify(before)})`);
  await page.evaluate(() => window.__dcAbort.abort());
  ok((await page.locator(".datecalc-app").count()) === 0,
     "abort removes the app surface");
  await page.evaluate(() => window.__dcHandle.dispose());
  const after = await page.evaluate(() => ({ ...window.__dcListeners }));
  ok(after.added === after.removed && after.signalAdded === after.signalRemoved,
     `a second dispose() is safe and leaves no listeners behind (${JSON.stringify(after)})`);
  const external = requests.filter((url) => !url.startsWith(BASE) && !url.startsWith("data:"));
  ok(external.length === 0, `zero external requests (${external.join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL DATE CALCULATOR UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`DATE CALCULATOR UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
