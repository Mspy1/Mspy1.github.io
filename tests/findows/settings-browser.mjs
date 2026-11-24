/* Focused Settings UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/settings-browser.mjs [--port=8803] [--out=DIR] [--playwright=PATH]
   Serves this worktree and mounts the production Settings module with injectable
   services (real file service + real IndexedDB, real preferences/localStorage). */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8803"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright();

/* Static contract checks make a missing module/CSS red before any browser work. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/settings.mjs"), "utf8");
const preferencesSource = readFileSync(resolve(ROOT, "findows/js/preferences.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/settings.css"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("settings.mjs must export async function mount()");
}
if (!/export\s+function\s+createPreferences\s*\(/.test(preferencesSource)) {
  throw new Error("preferences.mjs must export createPreferences()");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("settings.mjs must not register document/window listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource + preferencesSource)) {
  throw new Error("settings modules must not use markup injection or dynamic code");
}
if (!/PREFERENCES_KEY|findows\.preferences\.v1/.test(preferencesSource)) {
  throw new Error("preferences.mjs needs a namespaced settings key");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".set-") && !line.startsWith("@"));
if (badSelectors.length) {
  throw new Error(`settings.css has unscoped selectors: ${badSelectors.join(" | ")}`);
}
for (const icon of ["icon-settings", "icon-notepad", "icon-files"]) {
  const source = readFileSync(resolve(ROOT, `findows/assets/${icon}.svg`), "utf8");
  if (!/^\s*<svg[\s>]/.test(source) || !/viewBox="0 0 64 64"/.test(source)) {
    throw new Error(`${icon}.svg is not a valid original 64px icon`);
  }
}
console.log("static checks: exports, no global listeners, no markup/eval, namespaced key, scoped CSS, original icons PASS");

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
<title>Settings UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/shell.css">
<link rel="stylesheet" href="/findows/styles/settings.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{position:relative;z-index:30;display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{position:relative;z-index:30;padding:0 12px 12px}
  .harness-host{width:min(900px,calc(100vw - 24px));height:min(620px,calc(100vh - 80px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden;background:#101626}
  @media (max-width:600px),(max-height:499px){.harness-host{width:calc(100vw - 20px);height:min(640px,calc(100vh - 80px))}}
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide" data-wallpaper="dusk" data-reduce-motion="false" data-translucent="true">
  <div class="fw-wallpaper" aria-hidden="true"></div>
  <div class="harness-bar"><button id="outside" type="button">Outside control</button><span>Focus here to prove shortcuts stay in the app</span></div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { createStorage, STORAGE_CODES } from "/findows/js/storage.mjs";
  import { createFileService } from "/findows/js/file-service.mjs";
  import { createPreferences, PREFERENCES_KEY } from "/findows/js/preferences.mjs";
  import { mount } from "/findows/js/apps/settings.mjs";

  const desktop = document.getElementById("fw-desktop");
  const storage = createStorage();
  window.__setStorageMode = await storage.ready();
  const files = createFileService({ storage });
  const calls = { openApp: [] };
  const services = {
    files,
    openApp(appId, options) { calls.openApp.push({ appId, options }); return Promise.resolve(null); },
    setDirty() {},
  };
  window.__setFiles = files;
  window.__setServices = services;
  window.__setCalls = calls;
  window.__setKey = PREFERENCES_KEY;
  window.__setAdapter = null;
  window.__setPrefs = null;
  window.__setHandle = null;
  window.__setAbort = null;
  window.__setMount = async () => {
    if (window.__setHandle) { window.__setHandle.dispose(); window.__setAbort.abort(); }
    window.__setAbort = new AbortController();
    window.__setPrefs = createPreferences({
      root: desktop,
      storage: window.__setAdapter,
      media: window.matchMedia,
    });
    await window.__setPrefs.ready();
    services.preferences = window.__setPrefs;
    window.__setHandle = await mount({
      container: document.getElementById("app"),
      windowId: "settings-ui-test",
      fileId: null,
      mode: "edit",
      services,
      signal: window.__setAbort.signal,
    });
    window.__setReady = true;
    return true;
  };
  await window.__setMount();
  window.__setReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__settings-ui-harness.html") {
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
console.log(`settings UI harness serving ${ROOT} at ${BASE}`);

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
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => requests.push(request.url()));
}
async function openHarness(page) {
  await page.goto(`${BASE}/__settings-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__setReady === true, null, { timeout: 8000 });
}
const dataset = (page, key) => page.evaluate((name) => document.getElementById("fw-desktop").dataset[name], key);
const saveState = (page) => page.locator(".set-save-state").innerText();

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, accessible controls and default appearance");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__setHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  const radioCounts = { theme: await page.locator("input.set-theme").count(), wallpaper: await page.locator("input.set-wallpaper").count() };
  ok(radioCounts.theme === 3 && radioCounts.wallpaper === 3,
    `theme and three wallpaper choices are exposed as native radios (${JSON.stringify(radioCounts)}, host ${JSON.stringify((await page.evaluate(() => document.getElementById("app").textContent)).slice(0, 200))})`);
  ok(await page.locator(".set-motion").count() === 1 && await page.locator(".set-translucency").count() === 1,
    "motion and translucency use native checkboxes");
  ok(await page.locator(".set-reset").isVisible() && await page.locator(".set-purge").isVisible(),
    "reset and recycle-bin purge are separate visible actions");
  ok((await dataset(page, "themePref")) === "system" && (await dataset(page, "wallpaper")) === "dusk",
    "defaults apply system theme and Dusk wallpaper to the shell dataset");
  ok((await saveState(page)).includes("Saved"), "initial preferences are reported as saved");
  await page.locator("#outside").focus();
  await page.evaluate(() => window.__setHandle.focus());
  ok(await page.evaluate(() => document.activeElement?.classList.contains("set-title")),
    "handle.focus() returns focus to the Settings heading");
  await shot(page, "settings-ui-desktop-dark.png");

  log("theme and wallpaper choices persist under the single isolated key");
  await page.locator('.set-theme[value="light"]').check();
  await page.waitForFunction(() => document.getElementById("fw-desktop").dataset.theme === "light");
  ok((await dataset(page, "theme")) === "light" && (await dataset(page, "themePref")) === "light",
    "Light theme updates both effective theme and preference dataset");
  await page.locator('.set-wallpaper[value="tide"]').check();
  await page.waitForFunction(() => document.getElementById("fw-desktop").dataset.wallpaper === "tide");
  ok((await dataset(page, "wallpaper")) === "tide", "Tide wallpaper applies to the shell dataset");
  const storedKeys = await page.evaluate(() => Object.keys(localStorage));
  ok(storedKeys.length === 1 && storedKeys[0] === await page.evaluate(() => window.__setKey),
    `only the namespaced preference key is written (${JSON.stringify(storedKeys)})`);
  await shot(page, "settings-ui-desktop-light.png");
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__setReady === true, null, { timeout: 8000 });
  ok(await page.locator('.set-theme[value="light"]').isChecked() &&
     await page.locator('.set-wallpaper[value="tide"]').isChecked(),
     "theme and wallpaper survive a reload");
  await page.locator('.set-wallpaper[value="aurora"]').check();
  await page.locator('.set-theme[value="dark"]').check();
  await shot(page, "settings-ui-wallpaper-aurora.png");

  log("translucency changes the shell dataset and computed token");
  await page.locator(".set-translucency").uncheck();
  await page.waitForFunction(() => document.getElementById("fw-desktop").dataset.translucent === "false");
  const blur = await page.evaluate(() => getComputedStyle(document.getElementById("fw-desktop")).getPropertyValue("--fw-blur").trim());
  ok((await dataset(page, "translucent")) === "false" && blur === "none",
    `translucency toggle sets the dataset and disables blur (${blur})`);
  await page.locator(".set-translucency").check();

  log("browser reduced motion takes precedence over the saved preference");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelector(".set-motion-note")?.hidden === false, null, { timeout: 4000 });
  ok((await dataset(page, "reduceMotion")) === "true", "browser preference forces reduced motion on");
  ok((await page.locator(".set-motion-note").innerText()).includes("browser"), "the UI explains browser precedence");
  ok((await page.locator(".set-motion-note").innerText()).includes("cannot undo"),
    "the motion note says browser reduced motion cannot be undone here");
  await page.locator(".set-motion").check();
  await page.locator(".set-motion").uncheck();
  await page.waitForTimeout(80);
  ok((await dataset(page, "reduceMotion")) === "true", "unchecking the app toggle cannot override the browser");
  await shot(page, "settings-ui-reduced-motion.png");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(() => document.querySelector(".set-motion-note")?.hidden === true, null, { timeout: 4000 });
  await page.locator(".set-motion").check();
  ok((await dataset(page, "reduceMotion")) === "true", "the app preference applies once the browser preference is gone");
  await page.locator(".set-motion").uncheck();

  log("storage information is factual and a failed write discloses unsaved prefs");
  const storageInfo = await page.locator(".set-storage-info").innerText();
  ok(storageInfo.includes("Persistent") || storageInfo.includes("persistent"), `storage mode is reported (${storageInfo.slice(0, 120)})`);
  ok(storageInfo.includes("clear site data"), `storage status says the browser can clear site data (${storageInfo.slice(0, 160)})`);
  const estimateText = await page.locator(".set-estimate").innerText();
  ok(estimateText.includes("whole site") || estimateText.includes("unavailable"),
    `estimate is labelled whole-site, or explicitly unavailable (${estimateText.slice(0, 160)})`);
  await page.evaluate(() => {
    window.__setAdapter = {
      getSetting: () => null,
      setSetting: () => Promise.reject(new Error("quota")),
      deleteSetting: () => Promise.resolve(),
    };
  });
  await page.evaluate(() => window.__setMount());
  await page.locator('.set-theme[value="light"]').check();
  await page.waitForFunction(() => document.querySelector(".set-save-state")?.textContent.includes("Not saved"), null, { timeout: 4000 });
  ok((await saveState(page)).includes("Not saved"), "write failure switches the status to unsaved");
  ok((await dataset(page, "theme")) === "light", "the chosen appearance still applies while unsaved");
  await shot(page, "settings-ui-unsaved.png");
  await page.evaluate(() => {
    window.__store = {};
    window.__setAdapter.setSetting = (key, value) => {
      window.__store[key] = value;
      return Promise.resolve();
    };
  });
  await page.locator(".set-retry").click();
  await page.waitForFunction(() => document.querySelector(".set-save-state")?.textContent.includes("Saved"), null, { timeout: 4000 });
  ok((await saveState(page)).includes("Saved"), "Try saving again clears the unsaved state after a successful write");
  await page.evaluate(() => { window.__setAdapter = null; });
  await page.evaluate(() => window.__setMount());

  log("appearance reset touches only preferences, not documents or unrelated keys");
  const note = await page.evaluate(async () => {
    const entry = await window.__setFiles.createText({ parentId: "documents", name: "settings note.txt", text: "keep this document" });
    localStorage.setItem("findows.test.unrelated", "keep me");
    return { id: entry.id };
  });
  await page.locator('.set-theme[value="dark"]').check();
  await page.locator('.set-wallpaper[value="aurora"]').check();
  await page.locator(".set-reset").click();
  await page.locator(".set-reset-dialog").waitFor({ state: "visible" });
  ok((await page.locator(".set-reset-dialog").innerText()).includes("documents"),
    "reset confirmation states that documents are not deleted");
  await page.locator('.set-reset-dialog [data-action="confirm"]').click();
  await page.locator(".set-reset-dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.getElementById("fw-desktop").dataset.themePref === "system");
  ok((await dataset(page, "themePref")) === "system" && (await dataset(page, "wallpaper")) === "dusk",
    "reset restores default appearance");
  ok(await page.evaluate((id) => window.__setFiles.read(id).then((entry) => entry.text), note.id) === "keep this document",
    "reset leaves saved documents intact");
  ok((await page.evaluate(() => localStorage.getItem("findows.test.unrelated"))) === "keep me",
    "reset leaves unrelated local storage keys intact");

  log("scoped Recycle Bin purge removes only confirmed trash roots");
  const purgeData = await page.evaluate(async () => {
    const sibling = await window.__setFiles.createText({ parentId: "documents", name: "sibling note.txt", text: "sibling survives" });
    const trashed = await window.__setFiles.createText({ parentId: "documents", name: "trashed note.txt", text: "goodbye" });
    await window.__setFiles.trash(trashed.id, trashed.revision);
    return { siblingId: sibling.id, trashedId: trashed.id };
  });
  const leftoverOverlays = await page.evaluate(() => [...document.querySelectorAll(".set-overlay")].map((node) => node.textContent.slice(0, 120)));
  ok(leftoverOverlays.length === 0, `no dialog remains open before purge (${JSON.stringify(leftoverOverlays)})`);
  await page.locator(".set-purge").click();
  await page.locator(".set-purge-dialog").waitFor({ state: "visible" });
  ok((await page.locator(".set-purge-dialog").innerText()).includes("trashed note.txt"),
    "purge dialog lists the real trashed item before confirmation");
  ok((await page.locator(".set-purge-dialog").innerText()).includes("everything inside"),
    "purge confirmation says each trash root and everything inside it is deleted");
  await page.locator('.set-purge-dialog [data-action="confirm"]').click();
  await page.waitForFunction(() => document.querySelector(".set-purge-result")?.textContent.includes("Permanently deleted"), null, { timeout: 4000 });
  ok((await page.locator(".set-purge-result").innerText()).includes("1"), "purge reports one deleted trash root");
  ok((await page.locator(".set-purge-result").innerText()).includes("and everything inside"),
    "purge result states the trash root's contents were deleted too");
  const purgeState = await page.evaluate(async ({ siblingId, trashedId }) => {
    let trashedReadable = false;
    try { await window.__setFiles.read(trashedId); trashedReadable = true; } catch { /* expected MISSING */ }
    const sibling = await window.__setFiles.read(siblingId);
    return { trashedReadable, siblingText: sibling.text };
  }, purgeData);
  ok(purgeState.trashedReadable === false && purgeState.siblingText === "sibling survives",
    "purge deletes only the confirmed trash root and leaves siblings/database intact");

  log("dialogs stay fully on-screen when a compact app is scrolled");
  const narrow = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  const np = await narrow.newPage();
  watch(np);
  await openHarness(np);
  await np.evaluate(() => { document.querySelector(".set-app").scrollTop = 9999; });
  await np.locator(".set-reset").click();
  await np.locator(".set-reset-dialog").waitFor({ state: "visible" });
  const dialogBox = await np.locator(".set-dialog").boundingBox();
  const dialogClose = await np.locator(".set-dialog-x").boundingBox();
  ok(dialogBox.y >= 0 && dialogBox.y + dialogBox.height <= 640,
    `320x640 dialog stays within the viewport (${JSON.stringify(dialogBox)})`);
  ok(dialogClose.width >= 44 && dialogClose.height >= 44 && dialogClose.y >= 0,
    `320x640 dialog close is a 44px reachable target (${JSON.stringify(dialogClose)})`);
  await shot(np, "settings-dialog-320x640.png");
  await np.setViewportSize({ width: 844, height: 390 });
  await np.reload({ waitUntil: "load" });
  await np.waitForFunction(() => window.__setReady === true, null, { timeout: 8000 });
  await np.evaluate(() => { document.querySelector(".set-app").scrollTop = 9999; });
  await np.locator(".set-reset").click();
  await np.locator(".set-reset-dialog").waitFor({ state: "visible" });
  const wideBox = await np.locator(".set-dialog").boundingBox();
  const wideClose = await np.locator(".set-dialog-x").boundingBox();
  ok(wideBox.y >= 0 && wideBox.y + wideBox.height <= 390,
    `844x390 dialog stays within the viewport (${JSON.stringify(wideBox)})`);
  ok(wideClose.width >= 44 && wideClose.height >= 44 && wideClose.y >= 0,
    `844x390 dialog close is reachable (${JSON.stringify(wideClose)})`);
  await shot(np, "settings-dialog-844x390.png");
  await narrow.close();

  log("compact layout and dispose through signal");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  ok(await mp.locator(".set-theme").first().isVisible() && await mp.locator(".set-reset").isVisible(),
    "compact layout keeps appearance controls and reset reachable");
  await shot(mp, "settings-ui-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator(".set-theme").first().isVisible() && await mp.locator(".set-storage-info").isVisible(),
    "short landscape keeps settings usable");
  await shot(mp, "settings-ui-landscape-844x390.png");
  await phone.close();

  await page.evaluate(() => window.__setAbort.abort());
  ok((await page.locator(".set-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__setHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(requests.every((url) => url.startsWith(BASE)), `zero third-party requests (${requests.filter((url) => !url.startsWith(BASE)).join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL SETTINGS UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`SETTINGS UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
