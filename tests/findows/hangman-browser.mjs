/* Focused Hangman UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/hangman-browser.mjs [--port=8869] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8869 and mounts the production module with a
   minimal injected services object (local words + injectable RNG). */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8869"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence/hangman"));
const PLAYWRIGHT =
  arg("playwright", "") ||
  process.env.FINDOWS_PLAYWRIGHT_MODULE ||
  process.env.PLAYWRIGHT_MODULE ||
  "";

mkdirSync(OUT, { recursive: true });

let chromium;
try {
  ({ chromium } = loadPlaywright(PLAYWRIGHT || undefined));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

/* Static contract checks before launching the browser. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/hangman.mjs"), "utf8");
const engineSource = readFileSync(resolve(ROOT, "findows/js/apps/hangman-engine.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/hangman.css"), "utf8");
const iconSource = readFileSync(resolve(ROOT, "findows/assets/icon-hangman.svg"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("hangman.mjs must export async function mount()");
}
for (const required of [
  "hangman-engine.mjs", "createHangman", "createElementNS", "keydown", "abort",
  "removeEventListener", "dispose", "canClose",
]) {
  if (!moduleSource.includes(required)) throw new Error(`hangman.mjs is missing ${required}`);
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\(|fetch\s*\(|XMLHttpRequest|window\.addEventListener|document\.addEventListener)/.test(moduleSource)) {
  throw new Error("hangman.mjs must not inject markup, evaluate code, fetch, or bind global listeners");
}
if (!/WORDS/.test(engineSource) || /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(engineSource)) {
  throw new Error("hangman-engine.mjs must use its bundled words and no network");
}
const scoped = (selector) =>
  selector.startsWith(".hm-") ||
  selector.startsWith('#fw-desktop[data-theme="light"] .hm-') ||
  selector.startsWith("@") ||
  /^(from|to|\d+(?:\.\d+)?%)$/.test(selector);
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{"))
  .map((line) => line.slice(0, -1).trim())
  .filter((selector) => !scoped(selector));
if (badSelectors.length) throw new Error(`hangman.css has unscoped selectors: ${badSelectors.join(" | ")}`);
if (!iconSource.trimStart().startsWith("<svg") || !iconSource.includes('viewBox="0 0 64 64"') ||
    /<script|onload=|href="https?:/i.test(iconSource)) {
  throw new Error("icon-hangman.svg must be a local, original 64x64 SVG without scripts");
}
console.log("static checks: mount export, engine wiring, SVG figure, scoped CSS, local icon PASS");

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
<title>Hangman UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/hangman.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-shell{padding:10px}
  .hm-host{width:min(760px,calc(100vw - 20px));height:min(760px,calc(100vh - 20px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  #app2{margin-top:10px}
  @media (max-width:600px),(max-height:499px){
    .harness-shell{padding:6px}
    .hm-host{width:calc(100vw - 12px);height:calc(100vh - 12px)}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-shell">
    <div id="app" class="hm-host"></div>
    <div id="app2" class="hm-host" hidden></div>
  </div>
</div>
<script type="module">
  const params = new URLSearchParams(location.search);
  const [{ mount }, engine] = await Promise.all([
    import("/findows/js/apps/hangman.mjs"),
    import("/findows/js/apps/hangman-engine.mjs"),
  ]);
  window.__hmWordCount = engine.WORDS.length;
  const rng = () => (window.__hmRngQueue.length ? window.__hmRngQueue.shift() : 0);
  const words = (params.get("words") || "BANANA").split(",").filter(Boolean);
  window.__hmMountSecond = async (options = {}) => {
    document.getElementById("app2").hidden = false;
    return mount({
      container: document.getElementById("app2"),
      windowId: "hangman-second",
      fileId: null,
      services: options.services || { random: rng, words: ["CAT", "DOG"] },
      signal: new AbortController().signal,
    });
  };
  const services = { random: rng, words };
  window.__hmAbort = new AbortController();
  window.__hmHandle = await mount({
    container: document.getElementById("app"),
    windowId: "hangman-test",
    fileId: null,
    services,
    signal: window.__hmAbort.signal,
  });
  window.__hmReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__hangman-harness.html") {
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
console.log(`hangman UI harness serving ${ROOT} at ${BASE}`);

let step = 0;
const log = (message) => console.log(`[${String(++step).padStart(2, "0")}] ${message}`);
const ok = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`      PASS ${message}`);
};
const shot = (page, name) => page.screenshot({ path: resolve(OUT, name), fullPage: false });
const letters = (page) => page.locator(".hm-tile").allTextContents();
const visibleParts = (page) => page.locator(".hm-part--visible").count();
const message = (page) => page.locator(".hm-message").innerText();
const misses = (page) => page.locator(".hm-misses").innerText();
const phase = (page) => page.locator(".hm-app").getAttribute("data-phase");

const consoleErrors = [];
const badResponses = [];
const requests = [];
function watch(page) {
  page.on("console", (entry) => { if (entry.type() === "error") consoleErrors.push(entry.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => requests.push(request.url()));
}

const browser = await chromium.launch({ headless: true });
async function newContext(options = {}) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => { window.__hmRngQueue = []; });
  return context;
}
async function openHarness(page, query = "") {
  await page.goto(`${BASE}/__hangman-harness.html${query}`, { waitUntil: "load" });
  try {
    await page.waitForFunction(() => window.__hmReady === true, null, { timeout: 8000 });
  } catch (error) {
    throw new Error(`mount did not become ready: ${consoleErrors.join(" | ") || "no console output"}`);
  }
}

try {
  log("mount contract, bundled words and an untouched starting board");
  const desktop = await newContext({ viewport: { width: 1280, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__hmHandle;
    return {
      canClose: typeof handle?.canClose,
      focus: typeof handle?.focus,
      dispose: typeof handle?.dispose,
      words: window.__hmWordCount,
    };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok(shape.words >= 60, `bundled local word list has ${shape.words} words`);
  ok((await letters(page)).length === 6 && (await letters(page)).every((value) => value === "·"),
    "six masked tiles, no letter disclosed");
  ok((await misses(page)).includes("0 / 6") && (await visibleParts(page)) === 0,
    "zero misses and an empty gallows");
  ok((await phase(page)) === "ready", "the initial phase is ready");
  await shot(page, "hangman-desktop.png");

  log("keyboard guesses reveal repeated letters and spend misses only on wrong letters");
  await page.keyboard.press("a");
  const afterA = await letters(page);
  ok(afterA[1] === "A" && afterA[3] === "A" && afterA[5] === "A" && afterA[0] === "·",
    `typing A reveals all three A positions (${afterA.join(" ")})`);
  ok((await message(page)).toLowerCase().includes("in the word"), "a correct guess is announced");
  ok((await page.locator('.hm-key[data-letter="A"]').getAttribute("data-state")) === "correct" &&
     (await page.locator('.hm-key[data-letter="A"]').isDisabled()), "a used letter key is marked correct and disabled");
  await page.keyboard.press("z");
  ok((await misses(page)).includes("1 / 6") && (await visibleParts(page)) === 1,
    "one wrong letter draws one gallows part");
  ok((await page.locator('.hm-key[data-letter="Z"]').getAttribute("data-state")) === "wrong",
    "a wrong key is marked wrong");
  ok((await message(page)).toLowerCase().includes("not in the word"), "a wrong guess is announced");
  await page.keyboard.press("a");
  ok((await phase(page)) === "playing" && (await visibleParts(page)) === 1 &&
     (await message(page)).toLowerCase().includes("already"), "repeating a letter is a stable no-op");
  await shot(page, "hangman-playing.png");

  log("on-screen letter buttons and roving keyboard focus");
  await page.click('.hm-key[data-letter="B"]');
  ok((await letters(page))[0] === "B" && (await misses(page)).includes("1 / 6"),
    "clicking a letter button plays the same engine action as typing");
  await page.click('.hm-key[data-letter="N"]');
  ok((await letters(page))[2] === "N" && (await letters(page))[4] === "N",
    "N reveals both N positions from a click");
  ok((await phase(page)) === "won", "covering every letter from the key deck also wins");
  await page.keyboard.press("Escape");
  ok((await phase(page)) === "ready" && (await letters(page)).every((value) => value === "·") &&
     (await visibleParts(page)) === 0 && !(await page.locator('.hm-key[data-letter="A"]').isDisabled()),
    "Escape starts a new game with a fresh mask and enabled keys");
  await page.locator('.hm-key[data-letter="C"]').focus();
  ok((await page.evaluate(() => document.activeElement?.dataset.letter)) === "C",
    "a letter key can take keyboard focus");
  await page.keyboard.press("ArrowRight");
  const focusedLetter = await page.evaluate(() => document.activeElement?.dataset.letter);
  ok(focusedLetter === "V", `ArrowRight moves focus to the next letter key (focused ${focusedLetter})`);
  await page.keyboard.press("r");
  ok((await page.locator('.hm-key[data-letter="R"]').getAttribute("data-state")) === "wrong",
    "the letter R remains guessable instead of being reserved as a shortcut");

  log("win locks the board and reveals the word");
  const winContext = await newContext({ viewport: { width: 1024, height: 768 } });
  const wp = await winContext.newPage();
  watch(wp);
  await openHarness(wp);
  for (const letter of ["B", "A", "N"]) await wp.keyboard.press(letter.toLowerCase());
  ok((await phase(wp)) === "won" && (await letters(wp)).join("") === "BANANA",
    `guessing every distinct letter wins (${(await letters(wp)).join("")})`);
  ok((await message(wp)).includes("BANANA"), "the word is disclosed on a win");
  ok((await wp.locator(".hm-key:disabled").count()) === 26, "all letter keys lock after a win");
  await wp.keyboard.press("z");
  ok((await misses(wp)).includes("0 / 6"), "keyboard guesses are ignored after a win");
  await shot(wp, "hangman-win.png");
  await wp.keyboard.press("Escape");
  ok((await phase(wp)) === "ready" && (await visibleParts(wp)) === 0,
    "Escape unlocks a won game");
  await winContext.close();

  log("the sixth miss loses and freezes play; New game recovers");
  const loseContext = await newContext({ viewport: { width: 1024, height: 768 } });
  const lp = await loseContext.newPage();
  watch(lp);
  await openHarness(lp, "?words=CAT");
  for (const letter of ["d", "e", "f", "g", "h"]) await lp.keyboard.press(letter);
  ok((await phase(lp)) === "playing" && (await visibleParts(lp)) === 5, "five misses draw five parts");
  await lp.keyboard.press("i");
  ok((await phase(lp)) === "lost" && (await visibleParts(lp)) === 6 &&
     (await misses(lp)).includes("6 / 6"), "the sixth miss loses and completes the figure");
  ok((await letters(lp)).join("") === "CAT" && (await message(lp)).includes("CAT"),
    "the secret is revealed on a loss");
  await lp.keyboard.press("a");
  ok((await visibleParts(lp)) === 6 && (await misses(lp)).includes("6 / 6"),
    "no guess is accepted after a loss");
  await shot(lp, "hangman-lose.png");
  await lp.click(".hm-new");
  ok((await phase(lp)) === "ready" && (await visibleParts(lp)) === 0 &&
     (await letters(lp)).every((value) => value === "·") && (await lp.locator(".hm-key:disabled").count()) === 0,
    "New game clears the loss and re-enables every key");
  await loseContext.close();

  log("injected RNG chooses a different word on reset in a second instance");
  await page.evaluate(async () => { window.__hmSecond = await window.__hmMountSecond(); });
  await page.waitForSelector("#app2 .hm-app");
  ok((await page.locator("#app2 .hm-tile").count()) === 3, "the second instance mounts its own board");
  await page.evaluate(() => { window.__hmRngQueue = [0.75]; });
  await page.click("#app2 .hm-new");
  for (const letter of ["d", "o", "g"]) await page.keyboard.press(letter);
  ok((await page.locator("#app2 .hm-app").getAttribute("data-phase")) === "won" &&
     (await page.locator("#app2 .hm-tile").allTextContents()).join("") === "DOG",
    "reset consumed the injected RNG sample and selected DOG");
  await page.evaluate(() => { window.__hmSecond.dispose(); window.__hmSecond.dispose(); });
  ok((await page.locator("#app2 .hm-app").count()) === 0, "a second dispose() is safe and removes the surface");

  log("390x844 portrait: touch taps, reachable keys and no horizontal overflow");
  const phone = await newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const layout = await mp.evaluate(() => {
    const keys = [...document.querySelectorAll(".hm-key")];
    const boxes = keys.map((node) => node.getBoundingClientRect());
    return {
      count: keys.length,
      minHeight: Math.min(...boxes.map((box) => box.height)),
      inside: boxes.every((box) => box.left >= -1 && box.right <= window.innerWidth + 1 && box.top >= 0),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      wordVisible: Boolean(document.querySelector(".hm-word")?.getClientRects().length),
    };
  });
  ok(layout.count === 26 && layout.minHeight >= 40 && layout.inside && layout.overflow <= 1 && layout.wordVisible,
    `all 26 keys are reachable on a phone (min ${layout.minHeight.toFixed(1)}px, overflow ${layout.overflow}px)`);
  const tapTarget = await mp.locator('.hm-key[data-letter="A"]').boundingBox();
  await mp.touchscreen.tap(tapTarget.x + tapTarget.width / 2, tapTarget.y + tapTarget.height / 2);
  ok((await letters(mp))[1] === "A", "a touch tap on a letter button registers the guess");
  await shot(mp, "hangman-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  const landscape = await mp.evaluate(() => ({
    keys: [...document.querySelectorAll(".hm-key")].filter((node) => node.getClientRects().length).length,
    word: Boolean(document.querySelector(".hm-word")?.getClientRects().length),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  ok(landscape.keys === 26 && landscape.word && landscape.overflow <= 1,
    `844x390 landscape keeps the word and keys reachable (overflow ${landscape.overflow}px)`);
  await shot(mp, "hangman-landscape-844x390.png");
  await phone.close();

  log("dispose cleanup and zero external requests");
  const requestsBefore = requests.length;
  await page.evaluate(() => { window.__hmAbort.abort(); });
  ok((await page.locator("#app .hm-app").count()) === 0, "abort removes the app surface");
  await page.keyboard.press("a");
  await page.evaluate(() => { window.__hmHandle.dispose(); });
  ok(true, "keyboard input and a second dispose after abort are safe");
  await page.waitForTimeout(200);
  ok(requests.length === requestsBefore, "no requests happen after dispose");
  const external = requests.filter((url) => !url.startsWith(BASE));
  ok(external.length === 0, `zero external requests (${external.join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  log("ALL HANGMAN UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`HANGMAN UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
