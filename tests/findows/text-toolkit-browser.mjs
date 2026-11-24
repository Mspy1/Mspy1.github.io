/* Focused Text Toolkit UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/text-toolkit-browser.mjs [--port=8857] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8857 and mounts the production module in a
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
const PORT = Number(arg("port", "8857"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence/text-toolkit"));
const playwrightModule = arg("playwright", "") || process.env.FINDOWS_PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks before the browser: fail fast on a missing lane. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/text-toolkit.mjs"), "utf8");
const engineSource = readFileSync(resolve(ROOT, "findows/js/apps/text-toolkit-engine.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/text-toolkit.css"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("text-toolkit.mjs must export async function mount()");
}
if (!/runToolkit/.test(moduleSource) || !/text-toolkit-engine\.mjs/.test(moduleSource)) {
  throw new Error("text-toolkit.mjs must use the pure engine");
}
for (const pattern of [/\binnerHTML\b/, /\beval\s*\(/, /\bnew\s+Function\s*\(/, /\b(document|window)\.addEventListener\s*\(/]) {
  if (pattern.test(moduleSource)) throw new Error(`text-toolkit.mjs contains a forbidden construct: ${pattern}`);
}
if (!/addEventListener\s*\(/.test(moduleSource) || !/removeEventListener\s*\(/.test(moduleSource)) {
  throw new Error("text-toolkit.mjs must scope listeners and remove them on dispose");
}
if (!/export\s+function\s+runToolkit/.test(engineSource)) {
  throw new Error("text-toolkit-engine.mjs must export runToolkit");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".ttk-") && !line.startsWith("@") &&
    !/^(from|to|\d+(?:\.\d+)?%)$/.test(line.slice(0, -1).trim()));
if (badSelectors.length) {
  throw new Error(`text-toolkit.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
const iconPath = resolve(ROOT, "findows/assets/icon-text-toolkit.svg");
const svg = readFileSync(iconPath, "utf8");
if (!svg.trimStart().startsWith("<svg") || !svg.includes('viewBox="0 0 64 64"') ||
    /<script|onload=|href="https?:/i.test(svg)) {
  throw new Error("icon-text-toolkit.svg must be a local, original 64×64 SVG without scripts");
}
console.log("static checks: mount export, engine use, no innerHTML/eval/global listeners, listener cleanup, scoped CSS, local icon PASS");

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
<title>Text Toolkit UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/text-toolkit.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-shell{padding:12px}
  .harness-host{width:min(900px,calc(100vw - 24px));height:min(700px,calc(100vh - 36px));margin:0 auto;
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
  window.__ttkCopied = [];
  const clipboard = { writeText: async (value) => { window.__ttkCopied.push(value); } };
  const { mount } = await import("/findows/js/apps/text-toolkit.mjs");
  const controller = new AbortController();
  window.__ttkAbort = controller;
  window.__ttkHandle = await mount({
    container: document.getElementById("app"),
    windowId: "text-toolkit-ui-test",
    fileId: null,
    services: { clipboard },
    signal: controller.signal,
  });
  window.__ttkReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__text-toolkit-harness.html") {
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
console.log(`text-toolkit UI harness serving ${ROOT} at ${BASE}`);

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
    if (/^https?:\/\//i.test(request.url()) && !request.url().startsWith(BASE)) {
      externalRequests.push(request.url());
    }
  });
}

const browser = await chromium.launch({ headless: true });
async function newContext(options) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    window.__ttkTimers = new Set();
    const nativeSet = window.setTimeout.bind(window);
    const nativeClear = window.clearTimeout.bind(window);
    window.setTimeout = (...args) => {
      const id = nativeSet(...args);
      window.__ttkTimers.add(id);
      return id;
    };
    window.clearTimeout = (id) => {
      window.__ttkTimers.delete(id);
      return nativeClear(id);
    };
  });
  return context;
}
async function openHarness(page) {
  await page.goto(`${BASE}/__text-toolkit-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ttkReady === true, null, { timeout: 5000 });
}
const output = (page) => page.locator(".ttk-output").inputValue();
async function applyOperation(page, value, text, options = {}) {
  await page.locator(".ttk-input").fill(text);
  await page.locator(".ttk-operation").selectOption(value);
  if (options.tabSize) await page.locator(".ttk-tab-size").selectOption(String(options.tabSize));
  await page.locator(".ttk-apply").click();
  return output(page);
}

try {
  log("mount contract and empty state");
  const desktop = await newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__ttkHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
     `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await output(page)) === "" && (await page.locator(".ttk-output-count").innerText()).includes("0"),
     "empty state shows no result and zero counts");
  ok((await page.locator(".ttk-operation option").count()) >= 19,
     "operation picker exposes the full transform catalog");
  await shot(page, "text-toolkit-desktop-empty.png");

  log("real case transforms");
  const caseCases = [
    ["upper", "Hello world", "HELLO WORLD"],
    ["lower", "Hello WORLD", "hello world"],
    ["title", "hello WORLD", "Hello World"],
    ["sentence", "hello. world! again", "Hello. World! Again"],
    ["camel", "helloWorld XMLHttpRequest", "helloWorldXmlHttpRequest"],
    ["pascal", "helloWorld XMLHttpRequest", "HelloWorldXmlHttpRequest"],
    ["snake", "helloWorld XMLHttpRequest", "hello_world_xml_http_request"],
    ["kebab", "helloWorld XMLHttpRequest", "hello-world-xml-http-request"],
    ["constant", "helloWorld XMLHttpRequest", "HELLO_WORLD_XML_HTTP_REQUEST"],
  ];
  for (const [op, input, expected] of caseCases) {
    ok((await applyOperation(page, op, input)) === expected, `${op}: ${JSON.stringify(input)} → ${JSON.stringify(expected)}`);
  }
  await shot(page, "text-toolkit-desktop-case.png");

  log("whitespace controls");
  ok((await applyOperation(page, "trim", "  hi  ")) === "hi", "trim strips edges");
  ok((await applyOperation(page, "collapse", "a   b\t c\n d   ")) === "a b c\nd", "collapse keeps line structure");
  ok((await applyOperation(page, "no-blank-lines", "a\n\n b \n\nc")) === "a\n b \nc", "blank lines are removed");
  ok((await applyOperation(page, "tabs-to-spaces", "a\tb", { tabSize: 4 })) === "a    b", "tab size option is honoured");

  log("line tools and counting");
  ok((await applyOperation(page, "sort-asc", "b\na\nc")) === "a\nb\nc", "sort ascending");
  ok((await applyOperation(page, "sort-desc", "b\na\nc")) === "c\nb\na", "sort descending");
  ok((await applyOperation(page, "reverse-lines", "a\nb\nc")) === "c\nb\na", "reverse lines");
  ok((await applyOperation(page, "unique", "a\nb\na\nc\nb")) === "a\nb\nc", "duplicate lines removed");
  ok((await applyOperation(page, "unique-ignore-case", "A\na\nB\nb")) === "A\nB", "case-insensitive dedupe");
  const countResult = await applyOperation(page, "count", "Hello world\nsecond line");
  ok(countResult.includes("Words: 4") && countResult.includes("Characters: 23") && countResult.includes("Lines: 2"),
     `count reports words/chars/lines (${JSON.stringify(countResult)})`);
  ok((await page.locator(".ttk-input-count").innerText()).includes("4 words"), "live input stats show word count");
  await shot(page, "text-toolkit-desktop-count.png");

  log("bounded input and explicit errors");
  await page.locator(".ttk-input").fill("x".repeat(20_001));
  await page.locator(".ttk-operation").selectOption("upper");
  await page.locator(".ttk-apply").click();
  ok(await page.locator(".ttk-error").isVisible() &&
     (await page.locator(".ttk-error").innerText()).includes("20,000"),
     "over-limit input fails with an explicit, visible message");
  ok((await output(page)).includes("Words: 4"), "a rejected transform leaves the last good result intact");
  await shot(page, "text-toolkit-desktop-error.png");
  ok((await applyOperation(page, "upper", "x".repeat(20_000))).length === 20_000,
     "exactly at the limit still works");
  ok(!(await page.locator(".ttk-error").isVisible()), "a successful run clears the error");
  await page.locator(".ttk-clear").click();
  ok((await page.locator(".ttk-input").inputValue()) === "" && (await output(page)) === "",
     "Clear resets both text areas");

  log("copy and download produce plain text, keyboard paths work");
  await applyOperation(page, "upper", "<img src=x onerror=alert(1)>");
  ok((await output(page)) === "<IMG SRC=X ONERROR=ALERT(1)>", "markup is treated as inert text");
  await page.locator(".ttk-copy").click();
  await page.waitForFunction(() => window.__ttkCopied.length > 0);
  ok((await page.evaluate(() => window.__ttkCopied.at(-1))) === (await output(page)),
     "Copy sends the exact text result to the injected clipboard");
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".ttk-download").click();
  const download = await downloadPromise;
  ok(download.suggestedFilename().endsWith(".txt"), `Download suggests a .txt filename (${download.suggestedFilename()})`);
  const stream = await download.createReadStream();
  let downloaded = "";
  for await (const chunk of stream) downloaded += chunk.toString("utf8");
  ok(downloaded === (await output(page)), "Downloaded bytes match the text result exactly");
  await applyOperation(page, "lower", "CTRL ENTER");
  await page.locator(".ttk-operation").selectOption("title");
  await page.locator(".ttk-input").focus();
  await page.keyboard.press("Control+Enter");
  ok((await output(page)) === "Ctrl Enter", "Ctrl+Enter applies the selected transform from the input");
  await page.locator(".ttk-copy").focus();
  const copiedBefore = await page.evaluate(() => window.__ttkCopied.length);
  await page.keyboard.press("Enter");
  await page.waitForFunction((n) => window.__ttkCopied.length > n, copiedBefore);
  ok(true, "Enter activates the focused Copy button natively");

  log("touch layout at 390×844 and short landscape 844×390");
  const phone = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const controlHeights = await mp.locator(".ttk-apply, .ttk-copy, .ttk-download, .ttk-clear, .ttk-operation, .ttk-tab-size").evaluateAll(
    (nodes) => nodes.filter((node) => node.getClientRects().length > 0).map((node) => node.getBoundingClientRect().height));
  ok(controlHeights.every((height) => height >= 44),
     `compact controls are at least 44px (min ${Math.min(...controlHeights).toFixed(1)})`);
  await mp.locator(".ttk-input").fill("hi there");
  await mp.locator(".ttk-operation").selectOption("upper");
  await mp.tap(".ttk-apply");
  ok((await output(mp)) === "HI THERE", "touch can apply a transform");
  await mp.tap(".ttk-copy");
  await mp.waitForFunction(() => window.__ttkCopied.length > 0);
  ok(true, "touch can copy the result");
  await shot(mp, "text-toolkit-compact-390x844.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator(".ttk-apply").isVisible() && await mp.locator(".ttk-input").isVisible() &&
     await mp.locator(".ttk-output").isVisible(),
     "short landscape keeps input, output and actions reachable");
  await shot(mp, "text-toolkit-landscape-844x390.png");
  await phone.close();

  log("dispose cleanup and zero external traffic");
  await page.evaluate(() => window.__ttkAbort.abort());
  ok((await page.locator(".ttk-app").count()) === 0 &&
     (await page.evaluate(() => window.__ttkTimers.size)) === 0,
     "abort removes the app surface and clears pending timers");
  await page.evaluate(() => window.__ttkHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL TEXT TOOLKIT UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`TEXT TOOLKIT UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
