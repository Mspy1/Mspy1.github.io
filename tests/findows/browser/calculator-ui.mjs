/* Focused Calculator UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/browser/calculator-ui.mjs [--port=8796] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8796 and mounts the production app module in a
   minimal harness because the shell registry is owned by another lane. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8796"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks run before the browser so a missing app fails fast. */
const modulePath = resolve(ROOT, "findows/js/apps/calculator.mjs");
const cssPath = resolve(ROOT, "findows/styles/calculator.css");
const moduleSource = readFileSync(modulePath, "utf8");
const cssSource = readFileSync(cssPath, "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("calculator.mjs must export async function mount()");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("calculator.mjs must not register window/document listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("calculator.mjs must not use markup injection or dynamic code");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".calc-") && !line.startsWith("@"));
if (badSelectors.length) {
  throw new Error(`calculator.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
console.log("static checks: mount export, no global listeners, no markup/eval, app-scoped CSS PASS");

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
<title>Calculator UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/calculator.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{padding:12px}
  .harness-host{width:min(760px,calc(100vw - 24px));height:min(540px,calc(100vh - 84px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  @media (max-width:600px),(max-height:499px){
    .harness-host{width:calc(100vw - 20px);height:min(620px,calc(100vh - 84px))}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar">
    <button id="outside" type="button">Outside control</button>
    <span>Focus here to prove the calculator keyboard is scoped</span>
  </div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { mount } from "/findows/js/apps/calculator.mjs";
  const controller = new AbortController();
  window.__calcAbort = controller;
  window.__calcHandle = await mount({
    container: document.getElementById("app"),
    windowId: "calculator-ui-test",
    fileId: null,
    services: {},
    signal: controller.signal,
  });
  window.__calcReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__calculator-ui-harness.html") {
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
console.log(`calculator UI harness serving ${ROOT} at ${BASE}`);

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
  await page.goto(`${BASE}/__calculator-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__calcReady === true, null, { timeout: 5000 });
}
const displayText = (page) => page.locator(".calc-display").innerText();
const clickTokens = async (page, tokens) => {
  for (const token of tokens) {
    await page.locator(`.calc-key[data-token="${token}"]`).click();
  }
};

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract and initial accessible display");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__calcHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await displayText(page)) === "0", "initial display is 0");
  const displayAttrs = await page.locator(".calc-display").evaluate((node) => ({
    label: node.getAttribute("aria-label"),
    tag: node.tagName.toLowerCase(),
    focusable: node.tabIndex >= 0,
    described: Boolean(node.getAttribute("aria-describedby")),
  }));
  ok(displayAttrs.tag === "output" && displayAttrs.label && displayAttrs.focusable && displayAttrs.described,
    `display is a labelled focusable output (${JSON.stringify(displayAttrs)})`);

  log("pointer keypad: 2 + 3 × 4 = 20 and history");
  await clickTokens(page, ["2", "+", "3", "*", "4", "="]);
  ok((await displayText(page)) === "20", "pointer path computes 2 + 3 × 4 = 20");
  ok((await page.locator(".calc-expression").innerText()).includes("×"), "expression line uses the multiplication symbol");
  const firstHistory = page.locator(".calc-history-item").first();
  ok((await page.locator(".calc-history-item").count()) === 1 &&
     (await firstHistory.innerText()).includes("2 + 3 × 4") && (await firstHistory.innerText()).includes("20"),
     "history records the newest expression and result");
  await clickTokens(page, ["C"]);
  await clickTokens(page, ["0", ".", "1", "+", "0", ".", "2", "="]);
  ok((await displayText(page)) === "0.3", "0.1 + 0.2 displays 0.3");
  ok((await page.locator(".calc-history-item").count()) === 2, "history keeps both calculations, newest first");

  log("pending operator state and clear history");
  await clickTokens(page, ["C", "+"]);
  ok((await page.locator('.calc-key[data-token="+"]').getAttribute("aria-pressed")) === "true",
     "pending operator is exposed with aria-pressed");
  await clickTokens(page, ["5", "="]);
  ok((await page.locator('.calc-key[data-token="+"]').getAttribute("aria-pressed")) === "false",
     "operator highlight clears after equals");
  await page.locator(".calc-clear-history").click();
  ok((await page.locator(".calc-history-item").count()) === 0 &&
     (await page.locator(".calc-history-empty").isVisible()), "Clear history empties the list and shows the empty state");
  ok((await page.locator(".calc-sr-status").innerText()).includes("History cleared"),
     "history clear is announced politely");
  await shot(page, "calculator-ui-desktop-dark.png");

  log("error announcement and recovery");
  await clickTokens(page, ["C", "5", "/", "0", "="]);
  ok((await displayText(page)) === "Error", "division by zero shows Error");
  const errorBox = page.locator(".calc-error");
  ok(await errorBox.isVisible() && (await errorBox.innerText()) === "Cannot divide by zero" &&
     (await errorBox.getAttribute("role")) === "alert", "error is an assertive alert with the engine message");
  await shot(page, "calculator-ui-error.png");
  await clickTokens(page, ["C"]);
  ok((await displayText(page)) === "0" && !(await errorBox.isVisible()), "C clears the error state");
  await clickTokens(page, ["7", "+", "1", "="]);
  ok((await displayText(page)) === "8", "calculator remains usable after recovery");

  log("local keyboard path, Tab and native button activation");
  await page.locator(".calc-display").focus();
  await page.keyboard.type("7*8=");
  ok((await displayText(page)) === "56", "typed digits/operators/Enter compute 7 × 8 = 56");
  await page.keyboard.press("Tab");
  ok(await page.evaluate(() => document.activeElement?.classList.contains("calc-key")),
     "Tab still moves natively from the display into the keypad");
  await clickTokens(page, ["C"]);
  await page.locator('.calc-key[data-token="7"]').focus();
  await page.keyboard.press("Enter");
  ok((await displayText(page)) === "7", "Enter activates a focused key once (no double press)");
  await clickTokens(page, ["C"]);
  await page.locator('.calc-key[data-token="8"]').focus();
  await page.keyboard.press("Space");
  ok((await displayText(page)) === "8", "Space activates a focused key once (no double press)");
  await clickTokens(page, ["C"]);
  await page.locator(".calc-display").focus();
  await page.keyboard.type("9+9");
  await page.keyboard.press("Enter");
  ok((await displayText(page)) === "18", "Enter on the display performs equals");
  await page.keyboard.type("123");
  await page.keyboard.press("Backspace");
  ok((await displayText(page)) === "12", "Backspace edits the typed entry");
  await page.keyboard.press("Delete");
  ok((await displayText(page)) === "0", "Delete clears the current entry (CE)");
  await shot(page, "calculator-ui-keyboard.png");

  log("IME, modifier keys and outside focus stay untouched");
  const passive = await page.evaluate(() => {
    const display = document.querySelector(".calc-display");
    display.focus();
    const before = display.textContent;
    const fire = (init) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      display.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const tab = fire({ key: "Tab" });
    const ctrl = fire({ key: "5", ctrlKey: true });
    const ime = fire({ key: "5", isComposing: true });
    const imeEvent = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "5" });
    Object.defineProperty(imeEvent, "keyCode", { get: () => 229 });
    display.dispatchEvent(imeEvent);
    return { before, after: display.textContent, tab, ctrl, ime, imeCode: imeEvent.defaultPrevented };
  });
  ok(passive.before === passive.after && !passive.tab && !passive.ctrl && !passive.ime && !passive.imeCode,
     `IME/modifier/Tab events are not intercepted (${JSON.stringify(passive)})`);
  const beforeOutside = await displayText(page);
  await page.locator("#outside").focus();
  await page.keyboard.type("9+9=");
  ok((await displayText(page)) === beforeOutside, "typing outside the app cannot reach the calculator");

  log("light theme and compact layouts");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(220);
  await shot(page, "calculator-ui-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const columns = await mp.locator(".calc-body").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  ok(columns === 1, `compact layout uses a single column (${columns})`);
  const keyHeights = await mp.locator(".calc-key").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  ok(keyHeights.every((height) => height >= 44), `all compact keys are at least 44px (min ${Math.min(...keyHeights).toFixed(1)})`);
  const clearHeightPortrait = await mp.locator(".calc-clear-history").evaluate((node) => node.getBoundingClientRect().height);
  ok(clearHeightPortrait >= 44,
     `Clear history is a 44px+ touch target at 390×844 (${clearHeightPortrait.toFixed(1)}px)`);
  await mp.tap('.calc-key[data-token="6"]');
  await mp.tap('.calc-key[data-token="/"]');
  await mp.tap('.calc-key[data-token="2"]');
  await mp.tap('.calc-key[data-token="="]');
  ok((await displayText(mp)) === "3", "touch tap path computes 6 ÷ 2 = 3");
  await shot(mp, "calculator-ui-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  const landscapeHeights = await mp.locator(".calc-key").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  const clearHeightLandscape = await mp.locator(".calc-clear-history").evaluate((node) => node.getBoundingClientRect().height);
  ok((await mp.locator(".calc-keypad").isVisible()) && landscapeHeights.every((height) => height >= 44) &&
     (await mp.locator(".calc-history").isVisible()) && clearHeightLandscape >= 44,
     `short landscape keeps keypad, history and Clear history usable (min key ${Math.min(...landscapeHeights).toFixed(1)}px, clear ${clearHeightLandscape.toFixed(1)}px)`);
  await shot(mp, "calculator-ui-landscape-844x390.png");
  await phone.close();

  log("dispose through signal and idempotent handle.dispose");
  await page.evaluate(() => window.__calcAbort.abort());
  ok((await page.locator(".calc-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__calcHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL CALCULATOR UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`CALCULATOR UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
