/* Focused Base64/URL codec UI evidence. Dev-only; never shipped as site runtime.
   Usage: FINDOWS_PLAYWRIGHT_MODULE=PATH node tests/findows/base64-codec-browser.mjs
          [--port=8852] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8852 and mounts the production module in a
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
const PORT = Number(arg("port", "8852"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.FINDOWS_PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks: fail fast if a lane file or a constraint is missing. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/base64-codec.mjs"), "utf8");
const engineSource = readFileSync(resolve(ROOT, "findows/js/apps/base64-codec-engine.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/base64-codec.css"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("base64-codec.mjs must export async function mount()");
}
if (!/from\s+["']\.\/base64-codec-engine\.mjs["']/.test(moduleSource) || !/transform\s*\(/.test(moduleSource)) {
  throw new Error("base64-codec.mjs must use the pure engine's transform()");
}
for (const [name, source] of [["module", moduleSource], ["engine", engineSource]]) {
  if (/\b(document|window)\.addEventListener\s*\(/.test(source)) {
    throw new Error(`${name} must not register document/window listeners`);
  }
  if (/innerHTML|outerHTML|\beval\s*\(|new\s+Function\s*\(|fetch\s*\(|XMLHttpRequest|import\s*\(/.test(source)) {
    throw new Error(`${name} must not use markup injection, eval or remote requests`);
  }
}
if (/https?:\/\//.test(moduleSource.replace(/^\s*\/\/.*$/gm, ""))) {
  throw new Error("base64-codec.mjs must not embed remote URLs");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".b64-") && !line.startsWith("@") &&
    !/^(from|to|\d+(?:\.\d+)?%)$/.test(line.slice(0, -1).trim()));
if (badSelectors.length) {
  throw new Error(`base64-codec.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
const svg = readFileSync(resolve(ROOT, "findows/assets/icon-base64-codec.svg"), "utf8");
if (!svg.trimStart().startsWith("<svg") || !svg.includes('viewBox="0 0 64 64"') ||
    /<script|onload=|href="https?:/i.test(svg)) {
  throw new Error("icon-base64-codec.svg must be a local, original 64×64 SVG without scripts");
}
console.log("static checks: mount export, engine use, no global listeners, no markup injection/eval/network, scoped CSS, local icon PASS");

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
<title>Base64 codec UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/base64-codec.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-shell{padding:12px}
  .harness-host{width:min(760px,calc(100vw - 24px));height:min(620px,calc(100vh - 36px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  @media (max-width:600px),(max-height:499px){
    .harness-host{width:calc(100vw - 20px);height:calc(100vh - 20px)}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  const { mount } = await import("/findows/js/apps/base64-codec.mjs");
  const controller = new AbortController();
  window.__b64Abort = controller;
  window.__b64Copies = [];
  window.__b64Handle = await mount({
    container: document.getElementById("app"),
    windowId: "base64-codec-ui-test",
    fileId: null,
    services: {
      clipboard: {
        writeText: async (text) => { window.__b64Copies.push(text); },
      },
    },
    signal: controller.signal,
  });
  window.__b64Ready = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__b64-harness.html") {
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
console.log(`base64 codec UI harness serving ${ROOT} at ${BASE}`);

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
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
  });
}

const browser = await chromium.launch({ headless: true });
async function openHarness(page) {
  await page.goto(`${BASE}/__b64-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__b64Ready === true, null, { timeout: 5000 });
}
const text = (page, selector) => page.locator(selector).innerText();

async function run(page, mode, action, input) {
  await page.locator(`.b64-mode[data-mode="${mode}"]`).click();
  await page.locator(".b64-input").fill(input);
  await page.locator(`.b64-action[data-action="${action}"]`).click();
  return text(page, ".b64-output");
}

try {
  log("mount contract, default mode and scoped surface");
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__b64Handle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
     `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await page.locator(".b64-app").count()) === 1, "one scoped app root is mounted");
  ok((await page.locator('.b64-mode[data-mode="base64"]').getAttribute("aria-pressed")) === "true",
     "Base64 text is the default mode");
  ok(await page.locator(".b64-error").isHidden() && (await text(page, ".b64-output")) === "",
     "initial output and error are empty");
  await shot(page, "base64-codec-desktop-initial.png");

  log("acceptance: hello base64 round-trip and a b&c URL component");
  ok(await run(page, "base64", "encode", "hello") === "aGVsbG8=", "hello encodes to aGVsbG8=");
  ok((await page.locator(".b64-input").inputValue()) === "hello", "encoding leaves the input intact");
  await page.locator('.b64-action[data-action="swap"]').click();
  ok((await page.locator(".b64-input").inputValue()) === "aGVsbG8=", "Swap moves the result into the input");
  await page.locator('.b64-action[data-action="decode"]').click();
  ok((await text(page, ".b64-output")) === "hello", "decoding aGVsbG8= returns hello");
  ok(await run(page, "url", "encode", "a b&c") === "a%20b%26c", "a b&c encodes to a%20b%26c");
  ok((await page.locator('.b64-mode[data-mode="url"]').getAttribute("aria-pressed")) === "true",
     "mode buttons expose aria-pressed");
  ok(await run(page, "url", "decode", "a%20b%26c") === "a b&c", "the URL component round-trips");
  await shot(page, "base64-codec-desktop-url.png");

  log("malformed input shows an explicit error and recovers");
  await run(page, "base64", "decode", "aG!sbG8=");
  const errorBox = page.locator(".b64-error");
  ok(await errorBox.isVisible() && /base64/i.test(await text(page, ".b64-error")),
     "malformed Base64 shows an explicit Base64 error");
  ok((await text(page, ".b64-output")) === "" &&
     (await page.locator(".b64-input").getAttribute("aria-invalid")) === "true",
     "the failed action does not publish output and marks the input invalid");
  await shot(page, "base64-codec-desktop-error.png");
  ok(await run(page, "base64", "encode", "hello") === "aGVsbG8=" &&
     await errorBox.isHidden() &&
     (await page.locator(".b64-input").getAttribute("aria-invalid")) !== "true",
     "a later valid action clears the error state");
  await run(page, "url", "decode", "%zz");
  ok(await errorBox.isVisible() && /url/i.test(await text(page, ".b64-error")),
     "broken percent escapes show an explicit URL error");
  await run(page, "base64", "encode", "hello");

  log("copy action uses injected clipboard service and announces result");
  await page.locator('.b64-action[data-action="copy"]').click();
  ok((await page.evaluate(() => window.__b64Copies.slice())) .includes("aGVsbG8="),
     "Copy writes the current result through the injected clipboard service");
  ok(/copied/i.test(await text(page, ".b64-status")), "Copy announces success politely");
  await page.locator('.b64-action[data-action="clear"]').click();
  ok((await page.locator(".b64-input").inputValue()) === "" && (await text(page, ".b64-output")) === "",
     "Clear empties input and output");
  await page.locator('.b64-action[data-action="copy"]').click();
  ok(/nothing to copy/i.test(await text(page, ".b64-status")), "Copy with no output reports why nothing happened");

  log("keyboard-only path stays inside the app");
  await page.locator(".b64-input").fill("hello");
  await page.locator(".b64-input").press("Control+Enter");
  ok((await text(page, ".b64-output")) === "aGVsbG8=", "Control+Enter encodes from the focused field");
  await page.locator(".b64-input").fill("aGVsbG8=");
  await page.locator(".b64-input").press("Control+Shift+Enter");
  ok((await text(page, ".b64-output")) === "hello", "Control+Shift+Enter decodes from the focused field");
  await page.locator('.b64-action[data-action="clear"]').focus();
  await page.keyboard.press("Enter");
  ok((await page.locator(".b64-input").inputValue()) === "", "native Enter activates the focused button");
  await page.locator(".b64-input").fill("hello");
  await page.locator('.b64-action[data-action="encode"]').focus();
  await page.keyboard.press("Space");
  ok((await text(page, ".b64-output")) === "aGVsbG8=", "native Space activates the focused button");

  log("390×844 touch layout and 844×390 landscape");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const controlHeights = await mp.locator(".b64-mode, .b64-action, .b64-copy").evaluateAll(
    (nodes) => nodes.filter((node) => node.getClientRects().length > 0).map((node) => node.getBoundingClientRect().height));
  ok(controlHeights.every((height) => height >= 44),
     `compact controls are at least 44px (min ${Math.min(...controlHeights).toFixed(1)})`);
  await mp.locator(".b64-input").fill("hello");
  await mp.tap('.b64-action[data-action="encode"]');
  ok((await text(mp, ".b64-output")) === "aGVsbG8=", "touch can encode");
  await mp.tap('.b64-mode[data-mode="url"]');
  await mp.locator(".b64-input").fill("a b&c");
  await mp.tap('.b64-action[data-action="encode"]');
  ok((await text(mp, ".b64-output")) === "a%20b%26c", "touch can switch mode and encode");
  await shot(mp, "base64-codec-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator(".b64-input").isVisible() && await mp.locator(".b64-output").isVisible() &&
     await mp.locator('.b64-action[data-action="encode"]').isVisible(),
     "short landscape keeps input, output and actions reachable");
  await shot(mp, "base64-codec-landscape-844x390.png");
  await phone.close();

  log("dispose cleanup and quiet network/console");
  await page.evaluate(() => window.__b64Abort.abort());
  ok((await page.locator(".b64-app").count()) === 0, "abort removes the app root");
  await page.evaluate(() => window.__b64Handle.dispose());
  ok(true, "a second dispose() is safe");
  ok((await page.evaluate(() => document.querySelectorAll(".b64-app").length)) === 0,
     "no codec surface remains in the document");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);

  log("ALL BASE64 CODEC UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`BASE64 CODEC UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
