/* Focused Tone Generator UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/tone-generator-browser.mjs [--port=8861] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8861 and mounts the production module in a
   minimal harness: an injected audio factory records Web Audio calls. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8861"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence/tone-generator"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE || process.env.FINDOWS_PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();

/* Static contract checks before the browser: fail fast on a missing lane. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/tone-generator.mjs"), "utf8");
const helperSource = readFileSync(resolve(ROOT, "findows/js/apps/tone-generator-audio.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/tone-generator.css"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("tone-generator.mjs must export async function mount()");
}
if (!/export\s+default\s*\{\s*mount\s*\}/.test(moduleSource)) {
  throw new Error("tone-generator.mjs must export default { mount }");
}
for (const token of ["createOscillator", "createGain", "resume", "suspend", "close", "start(", "stop("]) {
  if (!moduleSource.includes(token)) throw new Error(`tone-generator.mjs must use Web Audio (missing ${token})`);
}
for (const forbidden of [/\binnerHTML\b/, /\beval\s*\(/, /\bnew\s+Function\s*\(/,
  /\b(document|window)\.addEventListener\s*\(/, /\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/,
  /\bEventSource\b/, /setInterval\s*\(/, /setTimeout\s*\(/]) {
  if (forbidden.test(moduleSource)) throw new Error(`tone-generator.mjs contains forbidden code: ${forbidden}`);
}
if (!/tone-generator-audio\.mjs/.test(moduleSource) || !/gainForVolume/.test(helperSource)) {
  throw new Error("tone-generator must use its pure audio helper");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".tone-") && !line.startsWith("@") &&
    !/^(from|to|\d+(?:\.\d+)?%)$/.test(line.slice(0, -1).trim()));
if (badSelectors.length) {
  throw new Error(`tone-generator.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
if (/url\(\s*["']?https?:/i.test(cssSource) || /@import/i.test(cssSource)) {
  throw new Error("tone-generator.css must not load remote resources");
}
const icon = readFileSync(resolve(ROOT, "findows/assets/icon-tone-generator.svg"), "utf8");
if (!icon.trimStart().startsWith("<svg") || !icon.includes('viewBox="0 0 64 64"') ||
    /<script|onload=|href="https?:/i.test(icon)) {
  throw new Error("icon-tone-generator.svg must be a local, original 64×64 SVG without scripts");
}
console.log("static checks: mount contract, Web Audio calls, no forbidden APIs, scoped CSS, local icon PASS");

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
<title>Tone Generator UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/tone-generator.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-shell{padding:12px}
  .harness-host{width:min(760px,calc(100vw - 24px));height:min(680px,calc(100vh - 36px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  @media (max-width:600px),(max-height:499px){
    .harness-host{width:calc(100vw - 20px);height:min(660px,calc(100vh - 20px))}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  const requestedMode = new URLSearchParams(location.search).get("mode");
  const unsupported = requestedMode === "unsupported";
  const realAudio = requestedMode === "real";
  if (unsupported) { window.AudioContext = undefined; window.webkitAudioContext = undefined; }
  window.__toneAudio = { contexts: [], timers: 0 };
  const nativeSetInterval = window.setInterval.bind(window);
  window.setInterval = (...args) => { window.__toneAudio.timers++; return nativeSetInterval(...args); };

  class FakeParam {
    constructor(value) { this.value = value; this.calls = []; }
    setValueAtTime(value, time) { this.value = value; this.calls.push(["set", value, time]); }
    linearRampToValueAtTime(value, time) { this.value = value; this.calls.push(["ramp", value, time]); }
  }
  class FakeGain {
    constructor(context) { this.context = context; this.gain = new FakeParam(1); this.disconnected = false; context.gains.push(this); }
    connect(node) { this.connectedTo = node; return this; }
    disconnect() { this.disconnected = true; }
  }
  class FakeOscillator {
    constructor(context) {
      this.context = context; this.type = "sine"; this.frequency = new FakeParam(440);
      this.started = false; this.stopped = false; this.disconnected = false;
      context.oscillators.push(this);
    }
    connect(node) { this.connectedTo = node; return this; }
    disconnect() { this.disconnected = true; }
    start(time) { this.started = true; this.startTime = time; }
    stop(time) { this.stopped = true; this.stopTime = time; }
  }
  class FakeAudioContext {
    constructor() {
      this.state = "running"; this.currentTime = 0; this.destination = { id: "speakers" };
      this.oscillators = []; this.gains = []; this.resumed = 0; this.suspended = 0; this.closed = 0;
      window.__toneAudio.contexts.push(this);
    }
    createOscillator() { return new FakeOscillator(this); }
    createGain() { return new FakeGain(this); }
    async resume() { this.resumed++; this.state = "running"; }
    async suspend() { this.suspended++; this.state = "suspended"; }
    async close() { this.closed++; this.state = "closed"; }
  }
  window.__toneAudioFactory = () => new FakeAudioContext();

  const { mount } = await import("/findows/js/apps/tone-generator.mjs");
  const controller = new AbortController();
  window.__toneAbort = controller;
  window.__toneHandle = await mount({
    container: document.getElementById("app"),
    windowId: "tone-generator-ui-test",
    fileId: null,
    mode: null,
    draftId: null,
    services: unsupported || realAudio ? {} : { createAudioContext: window.__toneAudioFactory },
    signal: controller.signal,
  });
  window.__toneReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__tone-harness.html") {
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
console.log(`tone-generator UI harness serving ${ROOT} at ${BASE}`);

let step = 0;
let checks = 0;
const log = (message) => console.log(`[${String(++step).padStart(2, "0")}] ${message}`);
const ok = (condition, message) => {
  checks++;
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
    const url = request.url();
    if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) {
      externalRequests.push(url);
    }
  });
}

const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
async function openHarness(page, mode = "") {
  await page.goto(`${BASE}/__tone-harness.html${mode ? `?mode=${mode}` : ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__toneReady === true, null, { timeout: 5000 });
}
const text = (page, selector) => page.locator(selector).innerText();
const fitsOnScreen = (page) => page.evaluate(() => {
  const app = document.querySelector(".tone-app");
  const host = document.getElementById("app").getBoundingClientRect();
  const start = document.querySelector(".tone-start").getBoundingClientRect();
  return {
    overflow: app.scrollHeight - app.clientHeight,
    startBottom: Math.round(start.bottom),
    hostBottom: Math.round(host.bottom),
  };
});

const audioState = (page) => page.evaluate(() => {
  const context = window.__toneAudio.contexts[0];
  return {
    contexts: window.__toneAudio.contexts.length,
    timers: window.__toneAudio.timers,
    oscillators: (context?.oscillators || []).map((osc) => ({
      type: osc.type,
      frequency: osc.frequency.value,
      started: osc.started,
      stopped: osc.stopped,
      disconnected: osc.disconnected,
      gain: osc.connectedTo?.gain?.value,
    })),
    resumed: context?.resumed || 0,
    suspended: context?.suspended || 0,
    closed: context?.closed || 0,
  };
});

try {
  log("mount contract and a silent opening (no context, no oscillator, no timers)");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__toneHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
     `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  const opening = await audioState(page);
  ok(opening.contexts === 0 && opening.oscillators.length === 0 && opening.timers === 0,
     `no audio context or oscillator is created on open (${JSON.stringify(opening)})`);
  const idle = {
    badge: await text(page, ".tone-badge"),
    support: await page.locator(".tone-app").getAttribute("data-support"),
    startEnabled: await page.locator(".tone-start").isEnabled(),
    stopEnabled: await page.locator(".tone-stop").isEnabled(),
  };
  ok(/ready/i.test(idle.badge) && idle.startEnabled && !idle.stopEnabled,
     `the app opens idle with Start enabled and Stop disabled (${JSON.stringify(idle)})`);
  ok((await text(page, ".tone-readout-value")).includes("440 Hz") &&
     (await text(page, ".tone-readout-label")).includes("35%"),
     "the default tone is described without making sound");
  ok((await page.locator(".tone-app").getAttribute("data-support")) === "supported" &&
     !(await page.locator(".tone-unavailable").isVisible()),
     "support is reported truthfully when a Web Audio constructor is available");
  await shot(page, "tone-desktop-dark.png");

  log("an explicit gesture creates an oscillator; settings reach the audio graph");
  await page.locator(".tone-start").click();
  let audio = await audioState(page);
  ok(audio.contexts === 1 && audio.oscillators.length === 1 && audio.oscillators[0].started,
     `Start creates and starts exactly one oscillator (${JSON.stringify(audio.oscillators)})`);
  ok(audio.oscillators[0].type === "sine" && audio.oscillators[0].frequency === 440,
     "the oscillator uses the chosen sine waveform and 440 Hz");
  ok(audio.oscillators[0].gain > 0 && audio.oscillators[0].gain <= 0.25,
     `gain follows the volume ceiling (${audio.oscillators[0].gain})`);
  ok(/playing/i.test(await text(page, ".tone-badge")) &&
     (await page.locator(".tone-stop").isEnabled()),
     "the playing state is visible and Stop becomes available");
  await shot(page, "tone-playing.png");

  log("frequency presets, waveforms and volume update the live oscillator");
  await page.locator('.tone-preset[data-frequency="880"]').click();
  audio = await audioState(page);
  ok(audio.oscillators[0].frequency === 880 &&
     (await page.locator(".tone-frequency-input").inputValue()) === "880",
     "a pitch preset updates both the field and the running oscillator");
  await page.locator('.tone-wave[data-wave="square"]').click();
  audio = await audioState(page);
  ok(audio.oscillators[0].type === "square" &&
     (await page.locator('.tone-wave[data-wave="square"]').getAttribute("aria-pressed")) === "true",
     "waveform buttons set the oscillator type and aria-pressed");
  await page.locator(".tone-volume-range").evaluate((node) => {
    node.value = "70";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  audio = await audioState(page);
  ok(Math.abs(audio.oscillators[0].gain - 0.175) < 1e-9 &&
     (await text(page, ".tone-volume-value")).includes("70%"),
     "volume changes the live gain and the visible percentage");
  ok((await text(page, ".tone-sr-status")).includes("Square"),
     "the live region describes the current tone");

  log("keyboard activation stays native and never starts a second context");
  const frequencyInput = page.locator(".tone-frequency-input");
  await frequencyInput.fill("523");
  await frequencyInput.press("ArrowUp");
  audio = await audioState(page);
  ok(audio.oscillators[0].frequency === 524 && audio.contexts === 1,
     "ArrowUp on the focused number field retunes the running tone without a new context");
  await page.locator('.tone-wave[data-wave="triangle"]').focus();
  await page.keyboard.press("Enter");
  audio = await audioState(page);
  ok(audio.oscillators[0].type === "triangle", "Enter activates the focused waveform button");
  await page.locator(".tone-stop").focus();
  await page.keyboard.press("Enter");
  audio = await audioState(page);
  ok(audio.oscillators[0].stopped && audio.suspended >= 1 &&
     !(await page.locator(".tone-stop").isEnabled()),
     "Enter on Stop ends the oscillator and suspends the context");
  await page.locator(".tone-start").focus();
  await page.keyboard.press("Space");
  audio = await audioState(page);
  ok(audio.oscillators.length === 2 && audio.oscillators[1].started && audio.contexts === 1,
     "Space restarts on the same context with a fresh oscillator");

  log("invalid frequency is rejected inline and never reaches the audio graph");
  await frequencyInput.fill("99999");
  ok(await page.locator(".tone-validation").isVisible() &&
     /frequency/i.test(await text(page, ".tone-validation")),
     "an out-of-range frequency shows an inline explanation");
  audio = await audioState(page);
  ok(audio.oscillators[1].frequency === 524 && audio.contexts === 1,
     "the rejected value does not retune the oscillator or create audio");
  await frequencyInput.fill("440");
  ok(!(await page.locator(".tone-validation").isVisible()) && (await audioState(page)).oscillators[1].frequency === 440,
     "correcting the field clears the message and retunes the tone");

  log("light theme renders the same controls");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(180);
  await shot(page, "tone-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  log("390×844 touch layout and 844×390 landscape stay usable");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const controlHeights = await mp.locator(".tone-start, .tone-stop, .tone-wave, .tone-preset")
    .evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length > 0)
      .map((node) => node.getBoundingClientRect().height));
  ok(controlHeights.length >= 7 && controlHeights.every((height) => height >= 44),
     `compact controls are at least 44px (min ${Math.min(...controlHeights).toFixed(1)})`);
  const compactFit = await fitsOnScreen(mp);
  ok(compactFit.overflow <= 2 && compactFit.startBottom <= compactFit.hostBottom + 1,
     `390×844 keeps every control on screen without scrolling (${JSON.stringify(compactFit)})`);
  await mp.tap('.tone-preset[data-frequency="220"]');
  await mp.tap('.tone-wave[data-wave="triangle"]');
  await mp.tap(".tone-start");
  const touchAudio = await audioState(mp);
  ok(touchAudio.oscillators.length === 1 && touchAudio.oscillators[0].started &&
     touchAudio.oscillators[0].type === "triangle" && touchAudio.oscillators[0].frequency === 220,
     `touch can choose a pitch, a waveform and start a tone (${JSON.stringify(touchAudio.oscillators)})`);
  await shot(mp, "tone-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  const landscapeFit = await fitsOnScreen(mp);
  ok(await mp.locator(".tone-frequency-input").isVisible() &&
     await mp.locator(".tone-volume-range").isVisible() && landscapeFit.overflow <= 2 &&
     landscapeFit.startBottom <= landscapeFit.hostBottom + 1,
     `short landscape keeps pitch, volume and Start fully reachable (${JSON.stringify(landscapeFit)})`);
  await shot(mp, "tone-landscape-844x390.png");
  await mp.tap(".tone-stop");
  ok((await audioState(mp)).oscillators[0].stopped, "touch can stop the tone in landscape");
  await phone.close();

  log("unsupported browsers are told the truth and get no audio");
  const noAudio = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const np = await noAudio.newPage();
  watch(np);
  await openHarness(np, "unsupported");
  ok((await np.locator(".tone-app").getAttribute("data-support")) === "unavailable" &&
     (await np.locator(".tone-unavailable").isVisible()) &&
     /not available/i.test(await text(np, ".tone-unavailable")),
     "missing Web Audio shows a truthful unavailable message");
  ok(!(await np.locator(".tone-start").isEnabled()) &&
     /unavailable/i.test(await np.locator(".tone-badge").innerText()) &&
     (await audioState(np)).contexts === 0,
     "unavailable mode disables Start and creates no context");
  await shot(np, "tone-unsupported.png");
  await noAudio.close();

  log("the real Web Audio path also starts only after a gesture");
  const realCtx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const rp = await realCtx.newPage();
  watch(rp);
  await openHarness(rp, "real");
  ok((await rp.locator(".tone-app").getAttribute("data-support")) === "supported" &&
     /ready/i.test(await text(rp, ".tone-badge")),
     "a real browser context is detected without an injected factory");
  await rp.locator(".tone-start").click();
  ok(/playing/i.test(await text(rp, ".tone-badge")) &&
     !(await rp.locator(".tone-error").isVisible()),
     "a gesture starts the real oscillator without an error");
  await rp.locator(".tone-stop").click();
  ok(/ready/i.test(await text(rp, ".tone-badge")), "the real tone stops on demand");
  await rp.evaluate(() => window.__toneAbort.abort());
  ok((await rp.locator(".tone-app").count()) === 0, "real-context disposal removes the surface");
  await realCtx.close();

  log("dispose suspends and closes the context, stops the oscillator and removes the surface");
  audio = await audioState(page);
  ok(audio.oscillators[1].started && !audio.oscillators[1].stopped && audio.contexts === 1,
     "the desktop tone was playing before disposal");
  await page.evaluate(() => window.__toneAbort.abort());
  audio = await audioState(page);
  ok((await page.locator(".tone-app").count()) === 0 && audio.timers === 0,
     "abort removes the app and leaves no timers");
  ok(audio.oscillators[1].stopped && audio.oscillators[1].disconnected &&
     audio.suspended >= 1 && audio.closed >= 1,
     `dispose stops/disconnects the oscillator and suspends/closes the context (${JSON.stringify(audio)})`);
  await page.evaluate(() => window.__toneHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);

  log(`ALL TONE GENERATOR UI CHECKS PASSED (${checks} assertions)`);
  await desktop.close();
} catch (error) {
  console.error(`TONE GENERATOR UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
