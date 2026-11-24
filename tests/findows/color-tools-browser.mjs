/* Focused Color Tools UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/color-tools-browser.mjs [--port=8856] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8856 and mounts the production app module in
   a minimal harness with an injected clipboard service, because the shell
   registry is owned by another lane. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8856"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence/color-tools"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks run before the browser so a missing lane fails fast. */
const modulePath = resolve(ROOT, "findows/js/apps/color-tools.mjs");
const enginePath = resolve(ROOT, "findows/js/apps/color-tools-engine.mjs");
const cssPath = resolve(ROOT, "findows/styles/color-tools.css");
const iconPath = resolve(ROOT, "findows/assets/icon-color-tools.svg");
const moduleSource = readFileSync(modulePath, "utf8");
const engineSource = readFileSync(enginePath, "utf8");
const cssSource = readFileSync(cssPath, "utf8");
const iconSource = readFileSync(iconPath, "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("color-tools.mjs must export async function mount()");
}
if (!/color-tools-engine\.mjs/.test(moduleSource)) {
  throw new Error("color-tools.mjs must drive the production pure engine");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("color-tools.mjs must not register document/window listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("color-tools.mjs must not use markup injection or dynamic code");
}
if (/\b(fetch\s*\(|XMLHttpRequest|WebSocket|import\s*\()/.test(moduleSource + engineSource)) {
  throw new Error("color tools must not issue network requests or dynamic imports");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".ct-") && !line.startsWith("@"));
if (badSelectors.length) {
  throw new Error(`color-tools.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
if (!iconSource.trimStart().startsWith("<svg") || !iconSource.includes('viewBox="0 0 64 64"') ||
    /<script|onload=|href="https?:/i.test(iconSource)) {
  throw new Error("icon-color-tools.svg must be a local, original 64x64 SVG without scripts");
}
console.log("static checks: mount export, production engine, no global listeners, no markup/eval/network, scoped CSS, local icon PASS");

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
<title>Color Tools UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/color-tools.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{padding:12px}
  .harness-host{width:min(860px,calc(100vw - 24px));height:min(620px,calc(100vh - 84px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  @media (max-width:600px),(max-height:499px){
    .harness-host{width:calc(100vw - 20px);height:min(640px,calc(100vh - 20px))}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar">
    <button id="outside" type="button">Outside control</button>
    <span>Focus here to prove the Color Tools keyboard is scoped</span>
  </div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { mount } from "/findows/js/apps/color-tools.mjs";
  const controller = new AbortController();
  window.__ctAbort = controller;
  window.__copied = [];
  const services = {
    clipboard: {
      writeText: (text) => { window.__copied.push(String(text)); return Promise.resolve(); },
    },
  };
  window.__ctHandle = await mount({
    container: document.getElementById("app"),
    windowId: "color-tools-ui-test",
    fileId: null,
    services,
    signal: controller.signal,
  });
  window.__ctReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__color-tools-harness.html") {
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
console.log(`color tools UI harness serving ${ROOT} at ${BASE}`);

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
  page.on("request", (request) => requests.push(request.url()));
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
}

async function openHarness(page) {
  await page.goto(`${BASE}/__color-tools-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ctReady === true, null, { timeout: 5000 });
}
const valueOf = (page, selector) => page.locator(selector).innerText().then((t) => t.trim());

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract and initial HEX/RGB/HSL readout");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__ctHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await page.locator(".ct-color-input").inputValue()) === "#336699", "base colour starts at #336699");
  ok((await valueOf(page, '.ct-format[data-format="hex"] .ct-format-value')) === "#336699",
    "HEX card shows the base colour");
  ok((await valueOf(page, '.ct-format[data-format="rgb"] .ct-format-value')) === "rgb(51, 102, 153)",
    "RGB card converts the base colour");
  ok((await valueOf(page, '.ct-format[data-format="hsl"] .ct-format-value')) === "hsl(210, 50%, 40%)",
    "HSL card converts the base colour");
  const preview = await page.locator(".ct-preview").evaluate((node) => getComputedStyle(node).backgroundColor);
  ok(preview === "rgb(51, 102, 153)", `live preview paints the base colour (${preview})`);
  await shot(page, "color-tools-desktop.png");

  log("live conversion, harm, and copy values");
  await page.locator(".ct-color-input").fill("#ff0000");
  await page.locator(".ct-color-input").dispatchEvent("input");
  ok((await valueOf(page, '.ct-format[data-format="rgb"] .ct-format-value')) === "rgb(255, 0, 0)",
    "typing #ff0000 updates the RGB readout");
  ok((await valueOf(page, '.ct-format[data-format="hsl"] .ct-format-value')) === "hsl(0, 100%, 50%)",
    "typing #ff0000 updates the HSL readout");
  await page.locator('.ct-copy[data-format="hex"]').click();
  await page.locator('.ct-copy[data-format="rgb"]').click();
  await page.locator('.ct-copy[data-format="hsl"]').click();
  const copied = await page.evaluate(() => window.__copied);
  ok(JSON.stringify(copied) === JSON.stringify(["#ff0000", "rgb(255, 0, 0)", "hsl(0, 100%, 50%)"]),
    `copy buttons send exact values to the injected clipboard (${JSON.stringify(copied)})`);
  ok((await valueOf(page, ".ct-status")).includes("Copied"), "copy action is announced in the status line");

  log("harmonies: select a scheme and promote a swatch to the base");
  await page.locator(".ct-harmony-select").selectOption("triadic");
  const swatchHexes = await page.locator(".ct-swatch-hex").allInnerTexts();
  ok(JSON.stringify(swatchHexes.map((s) => s.trim())) === JSON.stringify(["#ff0000", "#00ff00", "#0000ff"]),
    `triadic harmony offers three swatches (${JSON.stringify(swatchHexes)})`);
  await page.locator('.ct-swatch[data-hex="#00ff00"]').click();
  ok((await page.locator(".ct-color-input").inputValue()) === "#00ff00", "tapping a swatch promotes it to the base colour");
  ok((await valueOf(page, '.ct-format[data-format="hex"] .ct-format-value')) === "#00ff00",
    "format cards follow the promoted colour");

  log("invalid input is a typed, recoverable error");
  await page.locator(".ct-color-input").fill("not-a-color");
  await page.locator(".ct-color-input").dispatchEvent("change");
  const errorBox = page.locator(".ct-error");
  ok(await errorBox.isVisible() && (await errorBox.getAttribute("role")) === "alert" &&
     (await errorBox.innerText()).includes("not a valid colour"),
    "invalid base colour shows an assertive alert with a helpful message");
  ok((await valueOf(page, '.ct-format[data-format="hex"] .ct-format-value')) === "#00ff00",
    "invalid input does not destroy the last good colour");
  await shot(page, "color-tools-error.png");
  await page.locator(".ct-color-input").fill("#336699");
  await page.locator(".ct-color-input").dispatchEvent("input");
  ok(!(await errorBox.isVisible()), "valid input clears the error");

  log("WCAG contrast: 21:1 anchors, live change and swap");
  ok((await valueOf(page, ".ct-ratio")) === "21.00", "black on white reads exactly 21.00:1");
  ok((await valueOf(page, ".ct-level")) === "AAA", "21:1 is classified AAA");
  const badges = await page.locator(".ct-badge[data-pass='true']").count();
  ok(badges === 4, `all four WCAG badges pass at 21:1 (${badges})`);
  await page.locator(".ct-fg-input").fill("#777777");
  await page.locator(".ct-fg-input").dispatchEvent("input");
  await page.locator(".ct-bg-input").fill("#777777");
  await page.locator(".ct-bg-input").dispatchEvent("input");
  ok((await valueOf(page, ".ct-ratio")) === "1.00", "identical colours read 1.00:1");
  ok((await valueOf(page, ".ct-level")) === "Fail", "1:1 is classified Fail");
  await page.locator(".ct-fg-input").fill("#000000");
  await page.locator(".ct-fg-input").dispatchEvent("input");
  await page.locator(".ct-bg-input").fill("#ffffff");
  await page.locator(".ct-bg-input").dispatchEvent("input");
  await page.locator(".ct-swap").click();
  ok((await page.locator(".ct-fg-input").inputValue()) === "#ffffff" &&
     (await page.locator(".ct-bg-input").inputValue()) === "#000000" &&
     (await valueOf(page, ".ct-ratio")) === "21.00", "swap exchanges the two colours and keeps the ratio");
  await page.locator(".ct-bg-input").fill("nope");
  await page.locator(".ct-bg-input").dispatchEvent("input");
  ok(await page.locator(".ct-contrast-error").isVisible(), "invalid contrast input shows its own alert");
  await shot(page, "color-tools-contrast.png");

  log("local keyboard path and outside-focus isolation");
  await page.locator(".ct-color-input").fill("");
  await page.locator(".ct-color-input").focus();
  await page.keyboard.type("#00ff00");
  await page.keyboard.press("Enter");
  ok((await valueOf(page, '.ct-format[data-format="hex"] .ct-format-value')) === "#00ff00",
    "typing a hex value and pressing Enter commits it");
  await page.locator(".ct-harmony-select").focus();
  await page.keyboard.press("ArrowDown");
  const chosen = await page.locator(".ct-harmony-select").inputValue();
  ok(chosen !== "triadic", `ArrowDown changes the harmony with the native select (${chosen})`);
  await page.locator('.ct-copy[data-format="rgb"]').focus();
  const beforeEnter = await page.evaluate(() => window.__copied.length);
  await page.keyboard.press("Enter");
  ok((await page.evaluate(() => window.__copied.length)) === beforeEnter + 1,
    "Enter activates a focused copy button exactly once");
  const passive = await page.evaluate(() => {
    const input = document.querySelector(".ct-color-input");
    input.focus();
    const before = document.querySelector('.ct-format[data-format="hex"] .ct-format-value').textContent;
    const fire = (init) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const tab = fire({ key: "Tab" });
    const ctrl = fire({ key: "5", ctrlKey: true });
    const ime = fire({ key: "5", isComposing: true });
    return { before, after: document.querySelector('.ct-format[data-format="hex"] .ct-format-value').textContent, tab, ctrl, ime };
  });
  ok(passive.before === passive.after && !passive.tab && !passive.ctrl && !passive.ime,
    `Tab/modifier/IME events are not intercepted (${JSON.stringify(passive)})`);
  const beforeOutside = await valueOf(page, '.ct-format[data-format="hex"] .ct-format-value');
  await page.locator("#outside").focus();
  await page.keyboard.type("#123456");
  ok((await valueOf(page, '.ct-format[data-format="hex"] .ct-format-value')) === beforeOutside,
    "typing outside the app cannot reach Color Tools");
  await shot(page, "color-tools-keyboard.png");

  log("390x844 portrait: one column, 44px touch targets, tap paths");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const columns = await mp.locator(".ct-stage").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  ok(columns === 1, `portrait stage uses a single column (${columns})`);
  const touchSizes = await mp.locator(".ct-copy, .ct-swap, .ct-swatch, .ct-harmony-select, .ct-apply").evaluateAll(
    (nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  ok(touchSizes.every((height) => height >= 44), `all portrait controls are at least 44px (min ${Math.min(...touchSizes).toFixed(1)})`);
  await mp.locator(".ct-color-input").fill("#ff0000");
  await mp.locator(".ct-color-input").dispatchEvent("input");
  await mp.tap('.ct-swatch[data-hex="#00ffff"]');
  ok((await mp.locator(".ct-color-input").inputValue()) === "#00ffff", "touch tap promotes a harmony swatch");
  await mp.tap('.ct-copy[data-format="hex"]');
  ok((await mp.evaluate(() => window.__copied)).includes("#00ffff"), "touch tap copies the exact HEX value");
  const overflow = await mp.evaluate(() => document.querySelector(".ct-app").scrollWidth - document.querySelector(".ct-app").clientWidth);
  ok(overflow <= 1, `portrait layout has no horizontal overflow (${overflow}px)`);
  await shot(mp, "color-tools-portrait-390x844.png");

  log("844x390 landscape: two columns, controls still usable");
  await mp.setViewportSize({ width: 844, height: 390 });
  const landscapeColumns = await mp.locator(".ct-stage").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  ok(landscapeColumns === 2, `landscape stage uses two columns (${landscapeColumns})`);
  const landscapeSizes = await mp.locator(".ct-copy, .ct-swap, .ct-swatch, .ct-harmony-select, .ct-apply").evaluateAll(
    (nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  ok(landscapeSizes.every((height) => height >= 44), `landscape controls stay at least 44px (min ${Math.min(...landscapeSizes).toFixed(1)})`);
  ok(await mp.locator(".ct-contrast").isVisible() && await mp.locator(".ct-ratio").isVisible(),
    "contrast checker remains visible in short landscape");
  await shot(mp, "color-tools-landscape-844x390.png");
  await phone.close();

  log("dispose through signal and idempotent handle.dispose");
  await page.evaluate(() => window.__ctAbort.abort());
  ok((await page.locator(".ct-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__ctHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  const external = requests.filter((url) => !url.startsWith(BASE));
  ok(external.length === 0, `zero external requests (${external.join(" | ") || "none"})`);

  log("ALL COLOR TOOLS UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`COLOR TOOLS UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
