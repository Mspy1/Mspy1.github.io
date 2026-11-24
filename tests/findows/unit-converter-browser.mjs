/* Focused Unit Converter UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/unit-converter-browser.mjs [--port=8850] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8850 and mounts the production module in a
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
const PORT = Number(arg("port", "8850"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks before the browser: fail fast on a missing lane. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/unit-converter.mjs"), "utf8");
const engineSource = readFileSync(resolve(ROOT, "findows/js/apps/unit-converter-engine.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/unit-converter.css"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("unit-converter.mjs must export async function mount()");
}
if (!/from\s+"\.\/unit-converter-engine\.mjs"/.test(moduleSource)) {
  throw new Error("unit-converter.mjs must import the production engine");
}
for (const [source, name] of [[moduleSource, "unit-converter.mjs"], [engineSource, "unit-converter-engine.mjs"]]) {
  if (/innerHTML|eval\s*\(|new\s+Function\s*\(/.test(source)) {
    throw new Error(`${name} must not use innerHTML/eval/dynamic code`);
  }
  if (/\b(document|window)\.addEventListener\s*\(/.test(source)) {
    throw new Error(`${name} must not register document/window listeners`);
  }
  if (/\bfetch\s*\(|https?:\/\//.test(source)) {
    throw new Error(`${name} must not make or reference external requests`);
  }
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".uc-") && !line.startsWith("@") &&
    !/^(from|to|\d+(?:\.\d+)?%)$/.test(line.slice(0, -1).trim()));
if (badSelectors.length) {
  throw new Error(`unit-converter.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
for (const name of ["icon-unit-converter.svg", "icon-calculator.svg"]) {
  const svg = readFileSync(resolve(ROOT, `findows/assets/${name}`), "utf8");
  if (!svg.trimStart().startsWith("<svg") || !svg.includes('viewBox="0 0 64 64"') ||
      /<script|onload=|href="https?:/i.test(svg)) {
    throw new Error(`${name} must be a local, original 64×64 SVG without scripts`);
  }
}
console.log("static checks: mount export, engine import, no innerHTML/eval/global listeners/external URLs, scoped CSS, local icons PASS");

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
<title>Unit Converter UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/unit-converter.css">
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
  const { mount } = await import("/findows/js/apps/unit-converter.mjs");
  const controller = new AbortController();
  window.__ucAbort = controller;
  window.__ucHandle = await mount({
    container: document.getElementById("app"),
    windowId: "unit-converter-ui-test",
    fileId: null,
    mode: "converter",
    draftId: null,
    services: {},
    signal: controller.signal,
  });
  window.__ucReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__uc-harness.html") {
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
console.log(`unit converter UI harness serving ${ROOT} at ${BASE}`);

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

const browser = await chromium.launch({ headless: true });
async function openHarness(page) {
  await page.goto(`${BASE}/__uc-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ucReady === true, null, { timeout: 5000 });
}
const text = (page, selector) => page.locator(selector).innerText();
const resultValue = async (page) => Number((await text(page, ".uc-result")).trim());
const fromUnit = (page) => page.locator(".uc-from").inputValue();
const toUnit = (page) => page.locator(".uc-to").inputValue();

try {
  log("mount contract and exact acceptance conversions");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__ucHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
     `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await page.locator('.uc-category[data-category="length"]').getAttribute("aria-selected")) === "true",
     "the default length category is selected");
  await page.locator(".uc-input").fill("1");
  ok(await resultValue(page) === 1.609344 && (await text(page, ".uc-result")).trim() === "1.609344",
     `1 mi = 1.609344 km (${(await text(page, ".uc-result")).trim()})`);
  await shot(page, "unit-converter-desktop-dark.png");

  await page.click('.uc-category[data-category="temperature"]');
  await page.locator(".uc-input").fill("0");
  ok(await resultValue(page) === 32 && (await text(page, ".uc-result")).trim() === "32",
     `0 C = 32 F (${(await text(page, ".uc-result")).trim()})`);
  await shot(page, "unit-converter-temperature.png");

  log("invalid input shows an accessible error and never a bogus result");
  await page.locator(".uc-input").fill("abc");
  ok(await page.locator(".uc-error").isVisible() &&
     /number/i.test(await text(page, ".uc-error")) &&
     (await text(page, ".uc-result")).trim() === "",
     "invalid text shows an error alert and clears the result");
  ok((await page.locator(".uc-error").getAttribute("role")) === "alert",
     "the error is a live alert");
  await shot(page, "unit-converter-invalid.png");
  await page.locator(".uc-input").fill("100");
  ok(!(await page.locator(".uc-error").isVisible()) && await resultValue(page) === 212,
     "a valid value clears the error and recomputes (100 C = 212 F)");

  log("swap, category defaults and precision control");
  await page.click('.uc-category[data-category="length"]');
  await page.locator(".uc-input").fill("1");
  await page.locator(".uc-from").selectOption("mi");
  await page.locator(".uc-to").selectOption("km");
  const beforeSwap = [await fromUnit(page), await toUnit(page)];
  await page.click(".uc-swap");
  const afterSwap = [await fromUnit(page), await toUnit(page)];
  ok(beforeSwap[0] === "mi" && beforeSwap[1] === "km" &&
     afterSwap[0] === "km" && afterSwap[1] === "mi" &&
     Math.abs(await resultValue(page) - 0.621371) < 1e-6,
     `swap exchanges units and reverses the value (${beforeSwap.join("→")} becomes ${afterSwap.join("→")}: ${await text(page, ".uc-result")})`);

  await page.click(".uc-swap");
  await page.locator(".uc-precision").fill("2");
  ok((await text(page, ".uc-precision-value")).trim() === "2" &&
     (await text(page, ".uc-result")).trim() === "1.61",
     `precision control renders rounded decimals (${(await text(page, ".uc-result")).trim()})`);
  await page.locator(".uc-precision").fill("0");
  ok((await text(page, ".uc-result")).trim() === "2", "zero precision rounds to an integer");
  await page.locator(".uc-precision").fill("6");

  log("keyboard paths: typing, native activation and an app-scoped swap shortcut");
  await page.locator(".uc-input").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("2");
  ok(await resultValue(page) === 3.218688,
     `typing a value updates the result live (${(await text(page, ".uc-result")).trim()})`);
  const keyBefore = [await fromUnit(page), await toUnit(page)];
  await page.locator(".uc-swap").focus();
  await page.keyboard.press("Enter");
  ok((await fromUnit(page)) !== keyBefore[0], "Enter activates the focused swap button natively");
  await page.keyboard.press("Alt+S");
  ok((await fromUnit(page)) === keyBefore[0], "Alt+S is an app-scoped swap shortcut");
  await page.locator(".uc-input").focus();
  await page.keyboard.press("Alt+S");
  ok((await fromUnit(page)) === keyBefore[0], "the shortcut is ignored while typing in a field");

  log("light theme and compact layouts at 390×844 and 844×390");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await shot(page, "unit-converter-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const controlHeights = await mp.locator(".uc-category, .uc-swap, .uc-input, .uc-from, .uc-to, .uc-precision").evaluateAll(
    (nodes) => nodes.filter((node) => node.getClientRects().length > 0).map((node) => node.getBoundingClientRect().height));
  ok(controlHeights.every((height) => height >= 44),
     `compact controls are at least 44px (min ${Math.min(...controlHeights).toFixed(1)})`);
  await mp.tap('.uc-category[data-category="mass"]');
  ok((await mp.locator('.uc-category[data-category="mass"]').getAttribute("aria-selected")) === "true",
     "touch can switch categories");
  const touchBefore = await fromUnit(mp);
  await mp.tap(".uc-swap");
  ok((await fromUnit(mp)) !== touchBefore, "touch can swap units");
  await shot(mp, "unit-converter-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator(".uc-app").isVisible() &&
     await mp.locator('.uc-category[data-category="time"]').isVisible() &&
     await mp.locator(".uc-result").isVisible(),
     "short landscape keeps the converter controls reachable");
  await shot(mp, "unit-converter-landscape-844x390.png");
  await phone.close();

  log("dispose removes the surface; no console errors, HTTP failures or external requests");
  await page.evaluate(() => window.__ucAbort.abort());
  ok((await page.locator(".uc-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__ucHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);

  log("ALL UNIT CONVERTER UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`UNIT CONVERTER UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
