/* Focused Hash Tool UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/hash-tool-browser.mjs [--port=8853] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8853 and mounts the production module in a
   harness with a minimal injected services object. SHA-256 is computed by the
   browser's real Web Crypto over bytes typed locally or picked from disk.
   No fixture is shipped: every digest is computed live in the browser.
   The clipboard write is recorded by an init script so "Copy" can be proven
   without depending on headless clipboard permissions; crypto is never stubbed. */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8853"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const PLAYWRIGHT = arg("playwright", "") || process.env.FINDOWS_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || undefined;

mkdirSync(OUT, { recursive: true });

/* ---------- static contract checks (red before the app exists) ---------- */
const modulePath = resolve(ROOT, "findows/js/apps/hash-tool.mjs");
const enginePath = resolve(ROOT, "findows/js/apps/hash-tool-engine.mjs");
const cssPath = resolve(ROOT, "findows/styles/hash-tool.css");
const iconPath = resolve(ROOT, "findows/assets/icon-hash-tool.svg");
for (const [label, path] of [["module", modulePath], ["engine", enginePath], ["css", cssPath], ["icon", iconPath]]) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
}
const moduleSource = readFileSync(modulePath, "utf8");
const engineSource = readFileSync(enginePath, "utf8");
const cssSource = readFileSync(cssPath, "utf8");
const iconSource = readFileSync(iconPath, "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("hash-tool.mjs must export async function mount()");
}
for (const [label, source] of [["module", moduleSource], ["engine", engineSource]]) {
  if (/\b(document|window)\.addEventListener\s*\(/.test(source)) {
    throw new Error(`${label} must not register window/document listeners`);
  }
  if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(source)) {
    throw new Error(`${label} must not use markup injection or dynamic code`);
  }
  if (/\b(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket\s*\()/.test(source)) {
    throw new Error(`${label} must not make a network request`);
  }
}
if (!/sha256Hex\s*\(/.test(moduleSource) || !/cryptoSupport\s*\(/.test(moduleSource)) {
  throw new Error("hash-tool.mjs must use the shared engine for hashing and capability detection");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".ht-") && !line.startsWith("@"));
if (badSelectors.length) {
  throw new Error(`hash-tool.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
if (!/<svg\b[^>]*viewBox=/.test(iconSource) || /<image\b[^>]*href=["']https?:/i.test(iconSource)) {
  throw new Error("icon-hash-tool.svg must be an original inline SVG with a viewBox and no remote image");
}
console.log("static checks: mount export, scoped CSS/Crypto engine use, no global listeners/markup/eval/network, original icon PASS");

const { chromium } = loadPlaywright(PLAYWRIGHT);

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
<title>Hash Tool UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/hash-tool.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{padding:12px}
  .harness-host{width:min(860px,calc(100vw - 24px));height:min(560px,calc(100vh - 84px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden;background:#101626}
  @media (max-width:600px),(max-height:499px){
    .harness-host{width:calc(100vw - 20px);height:min(620px,calc(100vh - 84px))}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar"><button id="outside" type="button">Outside control</button><span>Focus here to prove shortcuts are scoped</span></div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { mount } from "/findows/js/apps/hash-tool.mjs";
  const services = { label: "minimal injected services" };
  window.__htServices = services;
  window.__htHandle = null;
  window.__htAbort = null;
  window.__htMount = async (options = {}) => {
    if (window.__htHandle) { window.__htHandle.dispose(); window.__htHandle = null; }
    if (window.__htAbort) window.__htAbort.abort();
    window.__htAbort = new AbortController();
    window.__htHandle = await mount({
      container: document.getElementById("app"),
      windowId: options.windowId || "hash-tool-ui-test",
      fileId: null, mode: options.mode || "text", draftId: null,
      services,
      signal: window.__htAbort.signal,
    });
    window.__htReady = true;
    return true;
  };
  await window.__htMount();
  window.__htReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__hash-tool-ui-harness.html") {
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
console.log(`hash-tool UI harness serving ${ROOT} at ${BASE}`);

let step = 0;
const log = (message) => console.log(`[${String(++step).padStart(2, "0")}] ${message}`);
const ok = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`      PASS ${message}`);
};
const shot = (page, name) => page.screenshot({ path: resolve(OUT, name), fullPage: false });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ABC = sha(Buffer.from("abc", "utf8"));

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

async function stubClipboard(context) {
  await context.addInitScript(() => {
    window.__htCopied = [];
    const real = Boolean(navigator.clipboard?.writeText);
    window.__htRealClipboardPresent = real;
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => { window.__htCopied.push(String(text)); },
          readText: async () => window.__htCopied[window.__htCopied.length - 1] || "",
        },
      });
    } catch { /* some engines lock the property; the harness still checks status */ }
  });
}

async function openHarness(page) {
  await page.goto(`${BASE}/__hash-tool-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__htReady === true, null, { timeout: 8000 });
}
const digestText = (page) => page.locator(".ht-digest").innerText();

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, real Web Crypto and the abc acceptance vector");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await stubClipboard(desktop);
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__htHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok(await page.locator(".ht-app").isVisible() && !(await page.locator(".ht-unavailable").isVisible()),
    "available crypto shows the hashing workspace, not Unavailable");
  ok(await page.evaluate(() => window.__htRealClipboardPresent === true), "browser exposes the Clipboard API");
  const cryptoReal = await page.evaluate(() => ({
    secure: window.isSecureContext,
    digest: typeof window.crypto?.subtle?.digest,
  }));
  ok(cryptoReal.secure === true && cryptoReal.digest === "function",
    `real Web Crypto is present in a secure context (${JSON.stringify(cryptoReal)})`);
  await page.locator(".ht-text").fill("abc");
  const beforeTextRequests = requests.length;
  await page.locator(".ht-hash-text").click();
  await page.waitForFunction(() => !document.querySelector(".ht-result")?.hidden, null, { timeout: 4000 });
  ok((await digestText(page)) === ABC,
    `typed abc hashes to ${ABC} with browser Web Crypto (got ${await digestText(page)})`);
  ok((await page.locator(".ht-status").innerText()).includes("3 bytes"), "status reports the byte length of typed text");
  ok((await page.locator(".ht-source").innerText()).includes("Typed text"), "result identifies its source as typed text");
  ok(requests.length === beforeTextRequests, "hashing typed text fires no network request");
  await shot(page, "hash-tool-ui-desktop-dark.png");

  log("copy writes only the digest; clear resets every surface");
  await page.locator(".ht-copy").click();
  const copied = await page.evaluate(() => window.__htCopied);
  ok(copied.length === 1 && copied[0] === ABC, `Copy writes exactly the digest (${JSON.stringify(copied)})`);
  ok((await page.locator(".ht-status").innerText()).toLowerCase().includes("copied"), "status confirms the copy");
  await page.locator(".ht-clear").click();
  ok((await page.locator(".ht-text").inputValue()) === "" && (await page.locator(".ht-result").isHidden()),
    "Clear empties the input and hides the result");
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new Error("denied"); };
  });
  await page.locator(".ht-text").fill("abc");
  await page.locator(".ht-hash-text").click();
  await page.waitForFunction(() => !document.querySelector(".ht-result")?.hidden, null, { timeout: 4000 });
  await page.locator(".ht-copy").click();
  await page.locator(".ht-error").waitFor({ state: "visible" });
  ok((await page.locator(".ht-error").innerText()).toLowerCase().includes("clipboard"),
    "a rejected clipboard write shows manual-copy guidance instead of failing silently");

  log("a picked local text file is hashed from bytes, and a binary file from raw bytes");
  await page.locator(".ht-file-input").setInputFiles({
    name: "sample.txt", mimeType: "text/plain", buffer: Buffer.from("abc", "utf8"),
  });
  await page.waitForFunction((expected) => document.querySelector(".ht-digest")?.textContent === expected, ABC, { timeout: 4000 });
  ok((await digestText(page)) === ABC, "picked text file hashes to the abc vector");
  ok((await page.locator(".ht-source").innerText()).includes("sample.txt"), "status names the picked file");
  const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0x0a]);
  const binaryHash = sha(binary);
  const beforeFileRequests = requests.length;
  await page.locator(".ht-file-input").setInputFiles({
    name: "raw.bin", mimeType: "application/octet-stream", buffer: binary,
  });
  await page.waitForFunction((expected) => document.querySelector(".ht-digest")?.textContent === expected, binaryHash, { timeout: 4000 });
  ok((await digestText(page)) === binaryHash,
    `binary file hashes raw bytes, not decoded text (${binaryHash})`);
  ok(requests.length === beforeFileRequests, "picking and hashing a file fires no network request");
  ok((await page.locator(".ht-file-input").inputValue()) === "", "file input is reset so the same file can be picked again");
  await shot(page, "hash-tool-ui-file.png");

  log("oversized local file is rejected before any digest is produced");
  const beforeOversize = await digestText(page);
  await page.evaluate(() => {
    const input = document.querySelector(".ht-file-input");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{
        name: "huge.bin", size: 64 * 1024 * 1024 + 1, type: "application/octet-stream",
        arrayBuffer: async () => new ArrayBuffer(1),
      }],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator(".ht-error").waitFor({ state: "visible" });
  ok((await page.locator(".ht-error").innerText()).includes("64 MiB"), "oversized file shows the explicit size limit");
  ok((await digestText(page)) === beforeOversize, "a rejected file leaves the previous digest untouched");
  await page.evaluate(() => { delete document.querySelector(".ht-file-input").files; });

  log("keyboard path: Ctrl+Enter hashes, Enter in the field stays a newline, outside keys are ignored");
  await page.locator(".ht-clear").click();
  await page.locator(".ht-text").fill("first");
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(() => !document.querySelector(".ht-result")?.hidden, null, { timeout: 4000 });
  ok((await digestText(page)) === sha(Buffer.from("first", "utf8")), "Ctrl+Enter in the text field hashes the text");
  const beforeOutside = await digestText(page);
  await page.locator("#outside").focus();
  await page.keyboard.type("not hashed");
  await page.keyboard.press("Control+Enter");
  ok((await digestText(page)) === beforeOutside, "keys outside the app never reach the hash action");
  const passive = await page.evaluate(() => {
    const area = document.querySelector(".ht-text");
    area.focus();
    const fire = (init) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      area.dispatchEvent(event);
      return event.defaultPrevented;
    };
    return {
      ime: fire({ key: "Enter", isComposing: true, ctrlKey: true }),
      imeCode: fire({ key: "Enter", ctrlKey: true, keyCode: 229 }),
      tab: fire({ key: "Tab" }),
      plainEnter: fire({ key: "Enter" }),
    };
  });
  ok(!passive.ime && !passive.imeCode && !passive.tab && !passive.plainEnter,
    `IME, Tab and plain Enter are not intercepted (${JSON.stringify(passive)})`);
  await page.locator("#outside").focus();
  await page.evaluate(() => window.__htHandle.focus());
  ok(await page.evaluate(() => document.activeElement?.classList.contains("ht-text")),
    "handle.focus() returns focus to the text field");

  log("unavailable path: no crypto.subtle shows Unavailable with controls disabled");
  const noCrypto = await browser.newContext({ viewport: { width: 1024, height: 720 } });
  await noCrypto.addInitScript(() => {
    const safe = { getRandomValues: window.crypto.getRandomValues.bind(window.crypto) };
    Object.defineProperty(window, "crypto", { configurable: true, value: safe });
  });
  const np = await noCrypto.newPage();
  watch(np);
  await openHarness(np);
  ok(await np.locator(".ht-unavailable").isVisible() && (await np.locator(".ht-unavailable-title").innerText()).includes("Unavailable"),
    "missing crypto.subtle produces an explicit Unavailable surface");
  ok((await np.locator(".ht-unavailable-reason").innerText()).length > 10, "Unavailable explains the missing capability");
  ok(await np.locator(".ht-text").isDisabled() && await np.locator(".ht-hash-text").isDisabled() &&
     await np.locator(".ht-file-button").isDisabled() && await np.locator(".ht-copy").isDisabled(),
    "every hashing and copy control is disabled while unavailable");
  ok(await np.locator(".ht-result").isHidden() && !(await np.locator(".ht-workspace").isVisible()),
    "no result or workspace is offered when hashing cannot run");
  await shot(np, "hash-tool-ui-unavailable.png");
  await noCrypto.close();

  log("unavailable path: an insecure context is detected before any digest is attempted");
  const insecure = await browser.newContext({ viewport: { width: 1024, height: 720 } });
  await insecure.addInitScript(() => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, get: () => false });
  });
  const ip = await insecure.newPage();
  watch(ip);
  await openHarness(ip);
  ok(await ip.locator(".ht-unavailable").isVisible() &&
     (await ip.locator(".ht-unavailable-reason").innerText()).match(/HTTPS|localhost/i),
    "insecure context is reported with an HTTPS/localhost reason");
  ok(await ip.locator(".ht-hash-text").isDisabled(), "hashing is blocked before reading any bytes");
  await insecure.close();

  log("touch layout at 390x844 and landscape 844x390 stays reachable");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await stubClipboard(phone);
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  ok(await mp.locator(".ht-text").isVisible() && await mp.locator(".ht-hash-text").isVisible() &&
     await mp.locator(".ht-file-button").isVisible(),
    "390x844 keeps input, hash and file controls visible");
  await mp.locator(".ht-text").fill("touch");
  await mp.locator(".ht-hash-text").tap();
  await mp.waitForFunction(() => !document.querySelector(".ht-result")?.hidden, null, { timeout: 4000 });
  ok(await mp.locator(".ht-copy").isVisible(), "390x844 shows the copy control once a digest exists");
  ok((await digestText(mp)) === sha(Buffer.from("touch", "utf8")), "touch tap hashes typed text");
  await mp.locator(".ht-copy").tap();
  ok((await mp.evaluate(() => window.__htCopied))[0] === sha(Buffer.from("touch", "utf8")),
    "touch tap copies the digest");
  await mp.locator(".ht-file-input").setInputFiles({
    name: "touch.txt", mimeType: "text/plain", buffer: Buffer.from("abc", "utf8"),
  });
  await mp.waitForFunction((expected) => document.querySelector(".ht-digest")?.textContent === expected, ABC, { timeout: 4000 });
  ok((await digestText(mp)) === ABC, "touch context hashes a picked file with real Web Crypto");
  const portFit = await mp.evaluate(() => ({
    scrollWidth: document.querySelector(".ht-app").scrollWidth,
    clientWidth: document.querySelector(".ht-app").clientWidth,
  }));
  ok(portFit.scrollWidth <= portFit.clientWidth + 2,
    `390x844 has no horizontal overflow (${JSON.stringify(portFit)})`);
  await shot(mp, "hash-tool-ui-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator(".ht-text").isVisible() && await mp.locator(".ht-hash-text").isVisible() &&
     await mp.locator(".ht-copy").isVisible(), "844x390 keeps controls reachable in landscape");
  const landscapeFit = await mp.evaluate(() => {
    const box = document.querySelector(".ht-app").getBoundingClientRect();
    const controls = [...document.querySelectorAll(".ht-text,.ht-hash-text,.ht-copy")].map((node) => {
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, width: r.width };
    });
    return { hostTop: box.top, hostBottom: box.bottom, controls };
  });
  ok(landscapeFit.controls.every((c) => c.top >= landscapeFit.hostTop - 1 && c.bottom <= landscapeFit.hostBottom + 1 && c.width > 0),
    `844x390 controls stay inside the host (${JSON.stringify(landscapeFit)})`);
  await shot(mp, "hash-tool-ui-landscape-844x390.png");
  await phone.close();

  log("dispose cleanup: explicit dispose, abort and a late digest resolution");
  await page.evaluate(() => { window.__htOrigDigest = null; });
  await page.evaluate(() => {
    const proto = Object.getPrototypeOf(window.crypto.subtle);
    window.__htProto = proto;
    window.__htOrigDigest = proto.digest;
    proto.digest = function (...args) {
      return new Promise((resolve) => {
        window.__htResolveLate = () => resolve(window.__htOrigDigest.apply(this, args));
      });
    };
  });
  await page.evaluate(() => window.__htMount({ windowId: "hash-tool-late-test" }));
  await page.locator(".ht-text").fill("late");
  await page.locator(".ht-hash-text").click();
  await page.waitForFunction(() => typeof window.__htResolveLate === "function", null, { timeout: 4000 });
  await page.evaluate(() => window.__htHandle.dispose());
  ok((await page.locator(".ht-app").count()) === 0, "dispose removes the app surface immediately");
  await page.evaluate(() => window.__htResolveLate());
  ok((await page.locator(".ht-app").count()) === 0 && (await page.locator(".ht-result").count()) === 0,
    "a digest resolving after dispose cannot repaint a removed surface");
  await page.evaluate(() => { window.__htProto.digest = window.__htOrigDigest; });
  await page.evaluate(() => window.__htMount({ windowId: "hash-tool-abort-test" }));
  await page.evaluate(() => window.__htAbort.abort());
  ok((await page.locator(".ht-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__htHandle.dispose());
  ok(true, "a second dispose() after abort is safe");

  ok(requests.every((url) => url.startsWith(BASE)),
    `zero third-party requests (${requests.filter((url) => !url.startsWith(BASE)).join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL HASH TOOL UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`HASH TOOL UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
