/* Focused RED/GREEN regression evidence for F5: playback status must match the
   real engine result in Read Aloud and Tone Generator. Dev-only; never shipped.
   Usage: FINDOWS_PLAYWRIGHT_MODULE=<local playwright> node tests/findows/status-truthfulness-browser.mjs --port=8903
   Serves this worktree on 127.0.0.1:8903. Engine doubles inject rejected,
   throwing and missing pause/resume calls; no audio and no network are used. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8903"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence/status-truthfulness"));
if (arg("playwright", "")) process.env.FINDOWS_PLAYWRIGHT_MODULE = arg("playwright", "");

mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright();

/* Static contract checks: both lanes keep their existing safety invariants. */
const sources = {
  readAloud: readFileSync(resolve(ROOT, "findows/js/apps/read-aloud.mjs"), "utf8"),
  readAloudLogic: readFileSync(resolve(ROOT, "findows/js/apps/read-aloud-logic.mjs"), "utf8"),
  tone: readFileSync(resolve(ROOT, "findows/js/apps/tone-generator.mjs"), "utf8"),
  toneAudio: readFileSync(resolve(ROOT, "findows/js/apps/tone-generator-audio.mjs"), "utf8"),
};
for (const [name, source] of Object.entries(sources)) {
  if (!/export\s+(async\s+)?function\s+(mount|clampRate|createToneState)\s*\(/.test(source) && name.endsWith("Logic")) {
    throw new Error(`${name} lost its pure exports`);
  }
  if (/\b(document|window)\.addEventListener\s*\(/.test(source)) {
    throw new Error(`${name} must not register document/window listeners`);
  }
  if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(source)) {
    throw new Error(`${name} must not use markup injection or dynamic code`);
  }
  if (/\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\/)/.test(source)) {
    throw new Error(`${name} must not contact the network`);
  }
}
for (const name of ["readAloud", "tone"]) {
  if (!/export\s+async\s+function\s+mount\s*\(/.test(sources[name])) {
    throw new Error(`${name} must export async function mount()`);
  }
}
console.log("static checks: both mounts, no global listeners, no markup/eval, no network PASS");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const HARNESS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Status truthfulness harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/read-aloud.css">
<link rel="stylesheet" href="/findows/styles/tone-generator.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-shell{padding:12px}
  .harness-host{width:min(720px,calc(100vw - 24px));height:min(620px,calc(100vh - 36px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  @media (max-width:600px),(max-height:499px){.harness-host{width:calc(100vw - 20px);height:calc(100vh - 20px)}}
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script>
(function () {
  var params = new URLSearchParams(location.search);
  var app = params.get("app") || "read-aloud";
  var mode = params.get("mode") || "ok";
  window.__statusMode = { app: app, mode: mode };

  /* --- Read Aloud engine double --- */
  var speech = {
    spoken: [], utterances: [], cancels: 0, pauses: 0, resumes: 0
  };
  function FakeUtterance(text) {
    this.text = text; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1;
    this.onend = null; this.onerror = null;
  }
  function fail(kind) { return new Error(kind + " was rejected by the browser"); }
  var synth = {
    speak: function (u) { speech.spoken.push(u.text); speech.utterances.push(u); },
    cancel: function () { speech.cancels++; },
    getVoices: function () {
      return [{ name: "Local English", lang: "en-US", localService: true, voiceURI: "local-en" }];
    },
    pause: function () {
      speech.pauses++;
      if (app === "read-aloud" && mode === "pause-throws") throw fail("pause");
      if (app === "read-aloud" && mode === "pause-rejects") return Promise.reject(fail("pause"));
    },
    resume: function () {
      speech.resumes++;
      if (app === "read-aloud" && mode === "resume-throws") throw fail("resume");
      if (app === "read-aloud" && mode === "resume-rejects") return Promise.reject(fail("resume"));
    }
  };
  if (app === "read-aloud" && mode === "pause-missing") synth.pause = undefined;
  if (app === "read-aloud" && mode === "resume-missing") synth.resume = undefined;
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synth });
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
  window.__speechDouble = speech;

  /* --- Tone Generator engine double --- */
  var audio = { contexts: [] };
  class FakeParam {
    constructor(value) { this.value = value; }
    setValueAtTime(value) { this.value = value; }
  }
  class FakeOscillator {
    constructor(context) {
      this.context = context; this.type = "sine"; this.frequency = new FakeParam(440);
      this.started = false; this.stopped = false; this.disconnected = false;
      context.oscillators.push(this);
    }
    connect(node) { this.connectedTo = node; return this; }
    disconnect() { this.disconnected = true; }
    start() { this.started = true; }
    stop() { this.stopped = true; }
  }
  class FakeGain {
    constructor(context) { this.gain = new FakeParam(1); context.gains.push(this); }
    connect(node) { this.connectedTo = node; return this; }
    disconnect() { this.disconnected = true; }
  }
  class FakeAudioContext {
    constructor() {
      this.state = (app === "tone" && (mode === "resume-rejects" || mode === "resume-missing")) ? "suspended" : "running";
      this.currentTime = 0; this.destination = {}; this.oscillators = []; this.gains = [];
      this.resumed = 0; this.suspended = 0; this.closed = 0;
      audio.contexts.push(this);
    }
    createOscillator() { return new FakeOscillator(this); }
    createGain() { return new FakeGain(this); }
    resume() {
      this.resumed++;
      if (app === "tone" && mode === "resume-rejects") {
        return Promise.reject(fail("resume"));
      }
      this.state = "running";
      return Promise.resolve();
    }
    suspend() { this.suspended++; this.state = "suspended"; return Promise.resolve(); }
    close() { this.closed++; this.state = "closed"; return Promise.resolve(); }
  }
  if (app === "tone" && mode === "resume-missing") FakeAudioContext.prototype.resume = undefined;
  window.__toneDouble = audio;
  window.__audioFactory = function () { return new FakeAudioContext(); };
})();
</script>
<script type="module">
  var selected = window.__statusMode;
  var controller = new AbortController();
  window.__statusAbort = controller;
  if (selected.app === "read-aloud") {
    var ra = await import("/findows/js/apps/read-aloud.mjs");
    window.__statusHandle = await ra.mount({
      container: document.getElementById("app"), windowId: "status-ra",
      services: {}, signal: controller.signal
    });
  } else {
    var tone = await import("/findows/js/apps/tone-generator.mjs");
    window.__statusHandle = await tone.mount({
      container: document.getElementById("app"), windowId: "status-tone",
      services: { createAudioContext: window.__audioFactory }, signal: controller.signal
    });
  }
  window.__statusReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__status-harness.html") {
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
console.log(`status-truthfulness harness serving ${ROOT} at ${BASE}`);

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
    if (!request.url().startsWith(BASE)) externalRequests.push(request.url());
  });
}
const settle = (page) => page.waitForTimeout(90);
async function open(page, app, mode = "ok") {
  await page.goto(`${BASE}/__status-harness.html?app=${app}&mode=${mode}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__statusReady === true, null, { timeout: 5000 });
}
const ra = (page) => page.evaluate(() => ({
  status: document.querySelector(".ra-status")?.textContent || "",
  sr: document.querySelector(".ra-sr")?.textContent || "",
  errorVisible: !document.querySelector(".ra-error")?.hidden,
  error: document.querySelector(".ra-error")?.textContent || "",
  play: document.querySelector(".ra-play")?.textContent || "",
  pauses: window.__speechDouble.pauses,
  resumes: window.__speechDouble.resumes,
}));
const tone = (page) => page.evaluate(() => {
  const context = window.__toneDouble.contexts[0];
  return {
    badge: document.querySelector(".tone-badge")?.textContent || "",
    sr: document.querySelector(".tone-sr-status")?.textContent || "",
    errorVisible: !document.querySelector(".tone-error")?.hidden,
    error: document.querySelector(".tone-error")?.textContent || "",
    startEnabled: !document.querySelector(".tone-start")?.disabled,
    playing: document.querySelector(".tone-app")?.dataset.playing,
    contexts: window.__toneDouble.contexts.length,
    oscillators: (context?.oscillators || []).map((osc) => ({ started: osc.started, stopped: osc.stopped })),
  };
});

const browser = await chromium.launch({ headless: true });
try {
  log("Read Aloud: successful pause/resume still report the real state");
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  watch(page);
  await open(page, "read-aloud", "ok");
  await page.locator(".ra-text").fill("Status truthfulness");
  await page.locator(".ra-play").click();
  await settle(page);
  ok((await ra(page)).status.includes("Reading aloud"), "Play reports Reading aloud");
  await page.locator(".ra-play").click();
  await settle(page);
  ok((await ra(page)).status.includes("Paused"), "a successful pause reports Paused");
  await page.locator(".ra-play").click();
  await settle(page);
  ok((await ra(page)).status.includes("Reading aloud"), "a successful resume reports Reading aloud");

  log("Read Aloud: a rejected/throwing/missing pause must never claim Paused");
  for (const mode of ["pause-throws", "pause-rejects", "pause-missing"]) {
    await open(page, "read-aloud", mode);
    await page.locator(".ra-text").fill("Pause check");
    await page.locator(".ra-play").click();
    await settle(page);
    await page.locator(".ra-play").click();
    await settle(page);
    const snapshot = await ra(page);
    ok(snapshot.status !== "Paused", `${mode}: status does not claim the Paused state (${snapshot.status})`);
    ok(/could not be paused/i.test(snapshot.status) && snapshot.errorVisible &&
       /could not be paused/i.test(snapshot.error), `${mode}: error is truthful and visible (${snapshot.error})`);
    ok(!/reading paused/i.test(snapshot.sr) && /could not be paused/i.test(snapshot.sr),
      `${mode}: live region announces failure, not success (${snapshot.sr})`);
    ok(snapshot.play.includes("Pause"), `${mode}: control still offers Pause because speech was not paused`);
    if (mode !== "pause-missing") ok(snapshot.pauses === 1, `${mode}: the engine call was attempted exactly once`);
    await shot(page, `read-aloud-${mode}.png`);
  }

  log("Read Aloud: a rejected/throwing/missing resume must never claim Reading aloud");
  for (const mode of ["resume-throws", "resume-rejects", "resume-missing"]) {
    await open(page, "read-aloud", mode);
    await page.locator(".ra-text").fill("Resume check");
    await page.locator(".ra-play").click();
    await settle(page);
    await page.locator(".ra-play").click(); // genuine pause
    await settle(page);
    ok((await ra(page)).status.includes("Paused"), `${mode}: reached a genuine paused state`);
    await page.locator(".ra-play").click(); // failed resume
    await settle(page);
    const snapshot = await ra(page);
    ok(snapshot.status !== "Reading aloud", `${mode}: status does not claim the Reading aloud state (${snapshot.status})`);
    ok(/could not be resumed/i.test(snapshot.status) && snapshot.errorVisible &&
       /could not be resumed/i.test(snapshot.error), `${mode}: error is truthful and visible (${snapshot.error})`);
    ok(!/resuming reading/i.test(snapshot.sr) && /could not be resumed/i.test(snapshot.sr),
      `${mode}: live region announces failure, not success (${snapshot.sr})`);
    ok(snapshot.play.includes("Resume"), `${mode}: control still offers Resume`);
    if (mode !== "resume-missing") ok(snapshot.resumes === 1, `${mode}: the engine call was attempted exactly once`);
    await shot(page, `read-aloud-${mode}.png`);
  }

  log("Read Aloud: a later successful control recovers and clears the error");
  await open(page, "read-aloud", "ok");
  await page.locator(".ra-text").fill("Recovery check");
  await page.locator(".ra-play").click();
  await settle(page);
  await page.locator(".ra-play").click();
  await settle(page);
  ok((await ra(page)).status.includes("Paused"), "pause succeeds after earlier failures in other sessions");

  log("Tone Generator: a successful gesture still starts and announces a tone");
  await open(page, "tone", "ok");
  ok((await tone(page)).contexts === 0, "no AudioContext exists before the gesture");
  await page.locator(".tone-start").click();
  await settle(page);
  let audio = await tone(page);
  ok(/playing/i.test(audio.badge) && audio.playing === "true" && audio.oscillators.some((o) => o.started),
    "a successful Start creates and reports a playing oscillator");
  ok(/tone started/i.test(audio.sr), "a successful Start announces Tone started");

  log("Tone Generator: a rejected or missing resume never claims Playing");
  for (const mode of ["resume-rejects", "resume-missing"]) {
    await open(page, "tone", mode);
    await page.locator(".tone-start").click();
    await settle(page);
    const snapshot = await tone(page);
    ok(!/playing/i.test(snapshot.badge) && snapshot.playing === "false",
      `${mode}: badge and data attribute stay idle (${snapshot.badge})`);
    ok(snapshot.errorVisible && /could not start/i.test(snapshot.error),
      `${mode}: truthful start error is visible (${snapshot.error})`);
    ok(!/tone started/i.test(snapshot.sr) && /could not start/i.test(snapshot.sr),
      `${mode}: live region announces failure, not success (${snapshot.sr})`);
    ok(!snapshot.oscillators.some((o) => o.started), `${mode}: no oscillator was started`);
    ok(snapshot.startEnabled, `${mode}: Start can be retried`);
    await shot(page, `tone-${mode}.png`);
  }

  log("Cleanup after failures and clean network/console");
  await open(page, "tone", "resume-rejects");
  await page.locator(".tone-start").click();
  await settle(page);
  await page.evaluate(() => window.__statusAbort.abort());
  ok((await page.locator(".tone-app").count()) === 0, "dispose removes the Tone surface after a failed start");
  await page.evaluate(() => window.__statusHandle.dispose());
  ok(true, "a second dispose() is safe");
  await open(page, "read-aloud", "pause-throws");
  await page.locator(".ra-text").fill("Dispose check");
  await page.locator(".ra-play").click();
  await settle(page);
  await page.evaluate(() => window.__statusAbort.abort());
  ok((await page.locator(".ra-app").count()) === 0, "dispose removes the Read Aloud surface after a failure");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);

  log(`ALL STATUS TRUTHFULNESS CHECKS PASSED (${checks} assertions)`);
  await ctx.close();
} catch (error) {
  console.error(`STATUS TRUTHFULNESS CHECK FAILED: ${error.message}`);
  if (consoleErrors.length) console.error(`console/page errors: ${consoleErrors.join(" | ")}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
