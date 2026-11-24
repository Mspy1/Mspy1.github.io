/* Focused Read Aloud UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/read-aloud-browser.mjs [--port=8860] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8860 and mounts the production module in a
   minimal harness with an injected local speech stub (no network, no real audio)
   because the shell registry is owned by the parent lane. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8860"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright();

/* ---------- static contract checks (fail fast on a missing lane) ---------- */
const modulePath = resolve(ROOT, "findows/js/apps/read-aloud.mjs");
const helperPath = resolve(ROOT, "findows/js/apps/read-aloud-logic.mjs");
const cssPath = resolve(ROOT, "findows/styles/read-aloud.css");
const moduleSource = readFileSync(modulePath, "utf8");
const helperSource = readFileSync(helperPath, "utf8");
const cssSource = readFileSync(cssPath, "utf8");
const iconSvg = readFileSync(resolve(ROOT, "findows/assets/icon-read-aloud.svg"), "utf8");

if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("read-aloud.mjs must export async function mount()");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("read-aloud.mjs must not register document/window listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("read-aloud.mjs must not use markup injection or dynamic code");
}
for (const [name, source] of [["module", moduleSource], ["helper", helperSource]]) {
  if (/\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|https?:\/\/)/.test(source)) {
    throw new Error(`read-aloud ${name} must not contact the network`);
  }
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".ra-") && !line.startsWith("@") &&
    !/^(from|to|\d+(?:\.\d+)?%)$/.test(line.slice(0, -1).trim()));
if (badSelectors.length) {
  throw new Error(`read-aloud.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
if (!iconSvg.trimStart().startsWith("<svg") || !iconSvg.includes('viewBox="0 0 64 64"') ||
    /<script|onload=|href="https?:/i.test(iconSvg)) {
  throw new Error("icon-read-aloud.svg must be a local, original 64×64 SVG without scripts");
}
console.log("static checks: mount export, no global listeners, no markup/eval, no network, scoped CSS, local icon PASS");

/* ---------- local harness page ---------- */
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
<title>Read Aloud UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/read-aloud.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{padding:12px}
  .harness-host{width:min(760px,calc(100vw - 24px));height:min(620px,calc(100vh - 84px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  @media (max-width:600px),(max-height:499px){
    .harness-bar{display:none}
    .harness-host{width:calc(100vw - 20px);height:min(680px,calc(100vh - 20px))}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar">
    <button id="outside" type="button">Outside control</button>
    <span>Focus here to prove Read Aloud keyboard handling is scoped</span>
  </div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script>
(function () {
  var mode = new URLSearchParams(location.search).get("mode");
  var voices = [
    { name: "Local English", lang: "en-US", localService: true, voiceURI: "local-en" },
    { name: "Local French", lang: "fr-FR", localService: true, voiceURI: "local-fr" },
    { name: "Cloud English", lang: "en-GB", localService: false, voiceURI: "cloud-en" }
  ];
  var state = { voices: voices, spoken: [], utterances: [], cancels: 0, pauses: 0, resumes: 0, getVoicesCalls: 0 };
  function FakeUtterance(text) {
    this.text = text; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1;
    this.lang = ""; this.onend = null; this.onerror = null;
  }
  var fake = {
    speak: function (u) { state.spoken.push(u.text); state.utterances.push(u); },
    cancel: function () { state.cancels += 1; },
    pause: function () { state.pauses += 1; },
    resume: function () { state.resumes += 1; },
    getVoices: function () { state.getVoicesCalls += 1; return state.voices.slice(); }
  };
  if (mode === "unavailable") {
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {} });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: undefined });
  } else {
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: fake });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
  }
  window.__raFake = state;
  window.__raFakeSynth = fake;
})();
</script>
<script type="module">
  const { mount } = await import("/findows/js/apps/read-aloud.mjs");
  const controller = new AbortController();
  window.__raAbort = controller;
  window.__raHandle = await mount({
    container: document.getElementById("app"),
    windowId: "read-aloud-ui-test",
    services: {},
    signal: controller.signal,
  });
  window.__raReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__read-aloud-harness.html") {
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
console.log(`read-aloud UI harness serving ${ROOT} at ${BASE}`);

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

async function openHarness(page, mode = "available") {
  await page.goto(`${BASE}/__read-aloud-harness.html?mode=${mode}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__raReady === true, null, { timeout: 5000 });
}
const fake = (page) => page.evaluate(() => {
  const s = window.__raFake;
  return {
    spoken: s.spoken.slice(), cancels: s.cancels, pauses: s.pauses, resumes: s.resumes,
    getVoicesCalls: s.getVoicesCalls,
    last: s.utterances.length ? {
      text: s.utterances[s.utterances.length - 1].text,
      voice: s.utterances[s.utterances.length - 1].voice?.name || null,
      rate: s.utterances[s.utterances.length - 1].rate,
      pitch: s.utterances[s.utterances.length - 1].pitch,
    } : null,
  };
});
const status = (page) => page.locator(".ra-status").innerText();
const setRange = (page, selector, value) => page.locator(selector).evaluate((node, v) => {
  node.value = v;
  node.dispatchEvent(new Event("input", { bubbles: true }));
}, value);
const fireLastUtterance = (page, event, extra = {}) => page.evaluate(({ event, extra }) => {
  const list = window.__raFake.utterances;
  const utterance = list[list.length - 1];
  if (!utterance) throw new Error("no utterance to fire");
  if (event === "end") utterance.onend?.();
  else utterance.onerror?.(extra);
}, { event, extra });

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract and accessible initial surface");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__raHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok((await status(page)).includes("Ready"), `initial status is ready (${await status(page)})`);
  const textAttrs = await page.locator(".ra-text").evaluate((node) => ({
    tag: node.tagName.toLowerCase(), label: Boolean(node.getAttribute("aria-label")),
    described: Boolean(node.getAttribute("aria-describedby")),
  }));
  ok(textAttrs.tag === "textarea" && textAttrs.label && textAttrs.described,
    `text area is labelled and described (${JSON.stringify(textAttrs)})`);
  const voiceOptions = await page.locator(".ra-voice option").allInnerTexts();
  ok(voiceOptions.length === 3 && voiceOptions[0] === "System default voice" &&
     !voiceOptions.some((label) => label.includes("Cloud")),
    `only local voices plus the system default are offered (${JSON.stringify(voiceOptions)})`);
  ok((await page.locator(".ra-rate-value").innerText()).includes("1") &&
     (await page.locator(".ra-pitch-value").innerText()).includes("1"),
    "rate and pitch readouts start at their defaults");
  await shot(page, "read-aloud-desktop-initial.png");

  log("pointer path: typed text is prepared and spoken once");
  await page.locator(".ra-text").fill("  Hello   from Findows  ");
  await page.locator(".ra-play").click();
  let state = await fake(page);
  ok(state.spoken.length === 1 && state.spoken[0] === "Hello from Findows",
    `play speaks the prepared text exactly once (${JSON.stringify(state.spoken)})`);
  ok(state.last.voice === null && state.last.rate === 1 && state.last.pitch === 1,
    `default voice/rate/pitch are passed to the utterance (${JSON.stringify(state.last)})`);
  ok((await status(page)).includes("Reading") && (await page.locator(".ra-play").innerText()).includes("Pause"),
    `speaking state is visible in status and button (${await status(page)})`);

  log("voice, rate and pitch selection apply to the next utterance");
  await page.locator(".ra-voice").selectOption({ label: "Local French (fr-FR)" });
  await setRange(page, ".ra-rate", "1.8");
  await setRange(page, ".ra-pitch", "0.4");
  ok((await page.locator(".ra-rate-value").innerText()).includes("1.8") &&
     (await page.locator(".ra-pitch-value").innerText()).includes("0.4"),
    "rate and pitch readouts follow the sliders");
  await page.locator(".ra-stop").click();
  await page.locator(".ra-play").click();
  state = await fake(page);
  ok(state.last.voice === "Local French" && state.last.rate === 1.8 && state.last.pitch === 0.4,
    `selected local voice and adjusted values reach the utterance (${JSON.stringify(state.last)})`);
  await shot(page, "read-aloud-desktop-speaking.png");

  log("pause, resume, stop, natural end and error recovery");
  const beforePause = await fake(page);
  await page.locator(".ra-play").click();
  state = await fake(page);
  ok(state.pauses === beforePause.pauses + 1 && (await status(page)).includes("Paused") &&
     (await page.locator(".ra-play").innerText()).includes("Resume"),
    "pause calls speechSynthesis.pause and exposes Paused/Resume");
  await page.locator(".ra-play").click();
  state = await fake(page);
  ok(state.resumes === beforePause.resumes + 1 && (await status(page)).includes("Reading"),
    "resume calls speechSynthesis.resume and returns to Reading");
  const beforeStop = (await fake(page)).cancels;
  await page.locator(".ra-stop").click();
  state = await fake(page);
  ok(state.cancels === beforeStop + 1 && (await status(page)).includes("Ready"),
    "stop cancels speech and returns to Ready");
  await page.locator(".ra-play").click();
  await fireLastUtterance(page, "end");
  ok((await status(page)).includes("Ready"), "a natural end returns to Ready");
  await page.locator(".ra-play").click();
  await fireLastUtterance(page, "error", { error: "interrupted" });
  ok(await page.locator(".ra-error").isVisible(), "an utterance error is surfaced in an alert");
  await page.locator(".ra-stop").click();
  ok(!(await page.locator(".ra-error").isVisible()), "stop clears the error alert");

  log("empty text is refused without speaking");
  await page.locator(".ra-text").fill("    \n ");
  const beforeEmpty = (await fake(page)).spoken.length;
  await page.locator(".ra-play").click();
  ok((await fake(page)).spoken.length === beforeEmpty && await page.locator(".ra-error").isVisible() &&
     (await page.locator(".ra-error").innerText()).match(/type or paste/i),
    "empty input shows a helpful error and never calls speak");

  log("scoped keyboard path: shortcuts, native buttons and passive events");
  await page.locator(".ra-text").fill("Keyboard text");
  await page.locator(".ra-text").focus();
  await page.keyboard.press("Control+Enter");
  state = await fake(page);
  ok(state.spoken.length === beforeEmpty + 1 && state.spoken[state.spoken.length - 1] === "Keyboard text",
    "Ctrl+Enter in the text area starts reading");
  const beforeEscape = (await fake(page)).cancels;
  await page.keyboard.press("Escape");
  ok((await fake(page)).cancels === beforeEscape + 1, "Escape stops reading while focus is inside the app");
  await page.locator(".ra-play").focus();
  await page.keyboard.press("Enter");
  ok((await fake(page)).spoken.length === beforeEmpty + 2, "Enter activates the focused Play button once");
  const passive = await page.evaluate(() => {
    const text = document.querySelector(".ra-text");
    text.focus();
    const fire = (init) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      text.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const tab = fire({ key: "Tab" });
    const save = fire({ key: "s", ctrlKey: true });
    const ime = fire({ key: "x", isComposing: true });
    const codeEvent = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "x" });
    Object.defineProperty(codeEvent, "keyCode", { get: () => 229 });
    text.dispatchEvent(codeEvent);
    return { tab, save, ime, imeCode: codeEvent.defaultPrevented };
  });
  ok(!passive.tab && !passive.save && !passive.ime && !passive.imeCode,
    `Tab, Ctrl+S and IME events are left to the browser (${JSON.stringify(passive)})`);
  const beforeOutside = (await fake(page)).spoken.length;
  await page.locator("#outside").focus();
  await page.keyboard.type("Hello");
  await page.keyboard.press("Control+Enter");
  ok((await fake(page)).spoken.length === beforeOutside, "typing outside the app cannot reach Read Aloud");
  await shot(page, "read-aloud-desktop-keyboard.png");

  log("light theme presentation");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await page.waitForTimeout(200);
  await shot(page, "read-aloud-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });

  log("compact 390×844 touch layout");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const columns = await mp.locator(".ra-settings").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  ok(columns === 1, `compact settings use a single column (${columns})`);
  const compactHeights = await mp.locator(".ra-play, .ra-stop, .ra-refresh").evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
  ok(compactHeights.every((height) => height >= 44), `compact controls are at least 44px (min ${Math.min(...compactHeights).toFixed(1)})`);
  await mp.locator(".ra-text").fill("Touch text");
  await mp.tap(".ra-play");
  ok((await fake(mp)).spoken.length === 1, "touch tap on Play speaks the text");
  await mp.tap(".ra-play");
  ok((await status(mp)).includes("Paused"), "touch tap on Pause pauses speech");
  await mp.tap(".ra-stop");
  ok((await status(mp)).includes("Ready"), "touch tap on Stop returns to Ready");
  await shot(mp, "read-aloud-compact-390x844.png");

  log("short landscape 844×390 keeps every control usable");
  await mp.setViewportSize({ width: 844, height: 390 });
  const landscapeHeights = await mp.locator(".ra-play, .ra-stop, .ra-refresh").evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
  ok(await mp.locator(".ra-text").isVisible() && await mp.locator(".ra-voice").isVisible() &&
     landscapeHeights.every((height) => height >= 44),
  `landscape keeps text, voice and 44px controls visible (min ${Math.min(...landscapeHeights).toFixed(1)})`);
  await mp.tap(".ra-play");
  ok((await fake(mp)).spoken.length === 2, "landscape tap path still speaks");
  await shot(mp, "read-aloud-landscape-844x390.png");
  await phone.close();

  log("truthful unavailable state when the speech API is absent");
  const unavailable = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const up = await unavailable.newPage();
  watch(up);
  await openHarness(up, "unavailable");
  ok((await up.locator(".ra-support").innerText()).match(/not available/i),
    "unavailable mode states plainly that speech playback is not available");
  ok((await status(up)).includes("Unavailable"), "status reports Unavailable");
  for (const selector of [".ra-play", ".ra-stop", ".ra-voice", ".ra-rate", ".ra-pitch"]) {
    ok(await up.locator(selector).isDisabled(), `${selector} is disabled when speech is unavailable`);
  }
  await up.locator(".ra-play").evaluate((node) => node.click());
  ok((await fake(up)).spoken.length === 0, "no utterance is attempted without the speech API");
  await shot(up, "read-aloud-unavailable.png");
  await unavailable.close();

  log("dispose cancels speech, clears its timer, and is idempotent");
  await page.locator(".ra-text").fill("Dispose check");
  await page.locator(".ra-play").click();
  const beforeDispose = (await fake(page)).cancels;
  await page.evaluate(() => window.__raAbort.abort());
  ok((await page.locator(".ra-app").count()) === 0, "abort removes the app surface");
  ok((await fake(page)).cancels >= beforeDispose + 1, "dispose cancels the active utterance");
  await page.evaluate(() => window.__raHandle.dispose());
  ok(true, "a second dispose() is safe");

  const timerPage = await desktop.newPage();
  watch(timerPage);
  await openHarness(timerPage);
  const callsBefore = (await fake(timerPage)).getVoicesCalls;
  await timerPage.evaluate(() => window.__raAbort.abort());
  await timerPage.waitForTimeout(700);
  ok((await fake(timerPage)).getVoicesCalls === callsBefore,
    `the delayed voice refresh timer is cleared on dispose (${callsBefore} → ${(await fake(timerPage)).getVoicesCalls})`);
  await timerPage.close();

  log("clean network and console");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  ok(externalRequests.length === 0, `zero external requests (${externalRequests.join(" | ") || "none"})`);

  log("ALL READ ALOUD UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`READ ALOUD UI CHECK FAILED: ${error.message}`);
  if (consoleErrors.length) console.error(`console/page errors: ${consoleErrors.join(" | ")}`);
  if (badResponses.length) console.error(`HTTP failures: ${badResponses.join(" | ")}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
