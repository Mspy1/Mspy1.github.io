/* Focused Sticky Notes browser evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/sticky-notes-browser.mjs [--port=8805] [--out=DIR] [--playwright=PATH]
   Serves this worktree and mounts the production app with a real same-database
   IndexedDB connection through the existing openDatabase() primitive. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8805"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const PLAYWRIGHT = arg("playwright", "") || process.env.FINDOWS_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || undefined;

mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright(PLAYWRIGHT);

/* Static contract checks make a missing module/CSS/icon red before browser work. */
const appSource = readFileSync(resolve(ROOT, "findows/js/apps/sticky-notes.mjs"), "utf8");
const storeSource = readFileSync(resolve(ROOT, "findows/js/apps/sticky-store.mjs"), "utf8");
const logicSource = readFileSync(resolve(ROOT, "findows/js/apps/sticky-logic.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/sticky-notes.css"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(appSource)) {
  throw new Error("sticky-notes.mjs must export async function mount()");
}
if (!/export\s+async\s+function\s+openStickyStore\s*\(/.test(storeSource)) {
  throw new Error("sticky-store.mjs must export openStickyStore()");
}
if (!/openDatabase/.test(storeSource) || !/STICKY_NOTES/.test(storeSource)) {
  throw new Error("sticky-store.mjs must use openDatabase and STORES.STICKY_NOTES");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(appSource + storeSource)) {
  throw new Error("sticky modules must not register document/window listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(appSource + storeSource + logicSource)) {
  throw new Error("sticky modules must not use markup injection or dynamic code");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".sn-") && !line.startsWith("@"));
if (badSelectors.length) throw new Error(`sticky-notes.css has unscoped selectors: ${badSelectors.join(" | ")}`);
const iconSource = readFileSync(resolve(ROOT, "findows/assets/icon-sticky-notes.svg"), "utf8");
if (!/^\s*<svg[\s>]/.test(iconSource) || !/viewBox="0 0 64 64"/.test(iconSource)) {
  throw new Error("icon-sticky-notes.svg is not a valid original 64px icon");
}
console.log("static checks: exports, openDatabase/STICKY_NOTES, no global listeners, no markup/eval, scoped CSS, icon PASS");

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
<title>Sticky Notes harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/sticky-notes.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-bar{position:relative;z-index:30;display:flex;gap:10px;align-items:center;padding:8px 12px;font-size:12px}
  .harness-shell{position:relative;z-index:30;padding:0 12px 12px}
  .harness-host{width:min(900px,calc(100vw - 24px));height:min(600px,calc(100vh - 80px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden;background:#101626}
  @media (max-width:600px),(max-height:499px){.harness-host{width:calc(100vw - 20px);height:min(640px,calc(100vh - 80px))}}
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar"><button id="outside" type="button">Outside control</button><span>Sticky Notes runs against the real findows IndexedDB</span></div>
  <div class="harness-shell"><div id="app" class="harness-host"></div></div>
</div>
<script type="module">
  import { openDatabase } from "/findows/js/storage.mjs";
  import { openStickyStore } from "/findows/js/apps/sticky-store.mjs";
  import { mount } from "/findows/js/apps/sticky-notes.mjs";

  window.__snDb = await openDatabase();
  window.__snStore = await openStickyStore({ db: window.__snDb });
  window.__snOther = await openStickyStore({ db: await openDatabase() });
  window.__snDirty = [];
  const services = {
    stickyStore: window.__snStore,
    setDirty(windowId, value) { window.__snDirty.push({ windowId, value }); },
  };
  window.__snServices = services;
  window.__snHandle = null;
  window.__snAbort = null;
  window.__snMount = async (override = null) => {
    if (window.__snHandle) { window.__snHandle.dispose(); window.__snAbort.abort(); }
    window.__snAbort = new AbortController();
    window.__snHandle = await mount({
      container: document.getElementById("app"),
      windowId: "sticky-test",
      fileId: null,
      mode: "edit",
      services: { ...services, stickyStore: override || window.__snStore },
      signal: window.__snAbort.signal,
    });
    window.__snReady = true;
    return true;
  };
  await window.__snMount();
  window.__snReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__sticky-notes-harness.html") {
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
console.log(`sticky notes harness serving ${ROOT} at ${BASE}`);

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
  await page.goto(`${BASE}/__sticky-notes-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__snReady === true, null, { timeout: 8000 });
}
const statusText = (page) => page.locator(".sn-status").innerText();
const listIds = (page) => page.locator(".sn-note-item").evaluateAll((nodes) => nodes.map((node) => node.dataset.id));

async function poll(page, predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

async function makeNote(page, text) {
  const beforeId = await page.locator(".sn-note-item[aria-current='true']").getAttribute("data-id").catch(() => null);
  await page.locator(".sn-new").click();
  ok(await poll(page, async () => {
    const id = await page.locator(".sn-note-item[aria-current='true']").getAttribute("data-id").catch(() => null);
    const value = await page.locator(".sn-text").inputValue().catch(() => null);
    return Boolean(id) && id !== beforeId && value === "";
  }), "New note opens an empty editor before typing");
  await page.locator(".sn-text").fill(text);
  ok(await poll(page, () => page.evaluate(async (value) =>
    (await window.__snStore.list()).some((note) => note.text === value), text)),
  `note text ${JSON.stringify(text.slice(0, 20))} was committed`);
  return page.locator(".sn-note-item[aria-current='true']").getAttribute("data-id");
}

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, accessible editor and empty state");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__snHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  const editorAttrs = await page.locator(".sn-text").evaluate((node) => ({
    tag: node.tagName.toLowerCase(), label: node.getAttribute("aria-label"), max: node.getAttribute("maxlength"),
  }));
  ok(editorAttrs.tag === "textarea" && Boolean(editorAttrs.label) && editorAttrs.max === "2000",
    `editor is a labelled bounded textarea (${JSON.stringify(editorAttrs)})`);
  ok(await page.locator(".sn-new").isVisible() && await page.locator(".sn-search").isVisible(),
    "New note and search are visible");
  await page.locator("#outside").focus();
  await page.evaluate(() => window.__snHandle.focus());
  ok(await page.evaluate(() => document.activeElement?.classList.contains("sn-text") ||
     document.activeElement?.classList.contains("sn-new")), "handle.focus() focuses a control inside the app");
  await shot(page, "sticky-notes-empty.png");

  log("create, autosave, two notes and reload persistence");
  const firstId = await makeNote(page, "Buy milk\ntoday");
  const secondId = await makeNote(page, "Call Ada about the plan");
  const savedNotes = await page.evaluate(() => window.__snStore.list());
  ok(savedNotes.length === 2 && savedNotes.some((note) => note.text === "Buy milk\ntoday") &&
     savedNotes.some((note) => note.text === "Call Ada about the plan"),
     `two notes are committed through real IndexedDB (${JSON.stringify(savedNotes.map((note) => ({ text: note.text })))})`);
  ok((await statusText(page)).includes("Saved"), "status reports a committed save after autosave");
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__snReady === true, null, { timeout: 8000 });
  ok((await listIds(page)).length === 2, "both notes reappear after a page reload");
  await page.locator(`.sn-note-item[data-id="${firstId}"]`).click();
  ok((await page.locator(".sn-text").inputValue()) === "Buy milk\ntoday", "selecting a note restores its saved text");

  log("color and pin persist and affect list order");
  await page.locator('.sn-color[data-color="mint"]').click();
  await page.locator(".sn-pin").click();
  await page.waitForFunction(() => document.querySelector(".sn-status")?.textContent.includes("Saved"), null, { timeout: 4000 });
  const colored = await page.evaluate(async (id) => (await window.__snStore.list()).find((note) => note.id === id), firstId);
  ok(colored.color === "mint" && colored.pinned === true, `color and pin are committed (${JSON.stringify({ color: colored.color, pinned: colored.pinned })})`);
  ok((await listIds(page))[0] === firstId, "pinned note sorts to the top");
  await shot(page, "sticky-notes-colors-pin.png");

  log("search filters notes without changing stored data");
  await page.locator(".sn-search").fill("ADA");
  await page.waitForFunction(() => document.querySelectorAll(".sn-note-item").length === 1, null, { timeout: 4000 });
  ok((await listIds(page))[0] === secondId, "case-insensitive search filters the list to the matching note");
  await page.locator(".sn-search").fill("");
  ok((await listIds(page)).length === 2, "clearing search restores every note");

  log("bounded text length and explicit copy/download aids");
  await page.locator(".sn-text").fill("x".repeat(2500));
  ok([...await page.locator(".sn-text").inputValue()].length === 2000, "input is capped at 2000 characters");
  ok((await page.locator(".sn-count").innerText()).includes("2000"), "character counter reflects the cap");
  const downloadWait = page.waitForEvent("download");
  await page.locator(".sn-download").click();
  ok((await downloadWait).suggestedFilename().endsWith(".txt"), "Download exports the visible note as text");
  await page.locator(".sn-text").fill("Buy milk\ntoday");

  log("clipboard failure is truthful and points to export");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
  await page.locator(".sn-copy").click();
  await page.waitForFunction(() => document.querySelector(".sn-status")?.textContent.includes("blocked"), null, { timeout: 4000 });
  ok((await statusText(page)).includes("Download note"), "copy failure explicitly offers Download note");
  ok(!(await statusText(page)).includes("copied to the clipboard"), "no false clipboard success is reported");
  const blockedDownload = page.waitForEvent("download");
  await page.locator(".sn-download").click();
  ok((await blockedDownload).suggestedFilename().endsWith(".txt"), "export works as the copy alternative");
  await page.evaluate(() => { delete navigator.clipboard; });

  log("note list uses honest native buttons and native keyboard selection");
  const listRoles = await page.evaluate(() => ({
    list: document.querySelector(".sn-list")?.getAttribute("role") ?? null,
    item: document.querySelector(".sn-note-item")?.getAttribute("role") ?? null,
    selected: document.querySelector(".sn-note-item")?.getAttribute("aria-selected") ?? null,
  }));
  ok(listRoles.list === null && listRoles.item === null && listRoles.selected === null,
    `no misleading listbox/option roles are exposed (${JSON.stringify(listRoles)})`);
  const itemTags = await page.locator(".sn-note-item").evaluateAll((nodes) => nodes.map((node) => node.tagName.toLowerCase()));
  ok(itemTags.length === 2 && itemTags.every((tag) => tag === "button"), "notes remain native buttons");
  await page.locator(`.sn-note-item[data-id="${secondId}"]`).focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction((id) => document.querySelector(`.sn-note-item[data-id="${id}"]`)?.getAttribute("aria-current") === "true", secondId, { timeout: 4000 });
  ok((await page.locator(`.sn-note-item[data-id="${secondId}"]`).getAttribute("aria-current")) === "true",
    "Enter on a focused note button selects it");
  ok((await page.locator(".sn-text").inputValue()) === "Call Ada about the plan", "keyboard selection loads that note");
  await page.locator(`.sn-note-item[data-id="${firstId}"]`).focus();
  await page.keyboard.press("Tab");
  ok(await page.evaluate(() => document.activeElement?.classList.contains("sn-note-item")),
    "Tab moves natively between note buttons");

  log("time-bounded delete and undo restore");
  await page.locator(`.sn-note-item[data-id="${secondId}"]`).click();
  await page.locator(".sn-delete").click();
  await page.locator(".sn-undo").waitFor({ state: "visible" });
  ok((await listIds(page)).length === 1, "delete removes the selected note from the list");
  ok((await page.locator(".sn-undo").innerText()).includes("Undo"), "undo action is offered immediately after delete");
  await shot(page, "sticky-notes-undo.png");
  await page.locator(".sn-undo button").click();
  ok(await poll(page, () => page.evaluate(async () => (await window.__snStore.list()).length === 2)), "Undo restores the note in storage");
  ok((await listIds(page)).includes(secondId), "Undo restores the exact deleted note");
  await page.locator(`.sn-note-item[data-id="${secondId}"]`).click();
  await page.locator(".sn-delete").click();
  await page.locator(".sn-undo").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector(".sn-undo")?.hidden === true, null, { timeout: 11000 });
  ok(!(await page.locator(".sn-undo").isVisible()), "undo expires after the bounded window");
  ok(await page.evaluate((id) => window.__snStore.list().then((notes) => notes.every((note) => note.id !== id)), secondId),
     "expired deletion is permanent in the store");

  log("temporary/failed storage discloses unsaved work and keeps export available");
  await page.evaluate(() => window.__snMount({
    getMode: () => "temporary",
    ready: () => Promise.resolve("temporary"),
    list: () => Promise.resolve([]),
    create: () => Promise.reject(new Error("storage blocked")),
    update: () => Promise.reject(new Error("storage blocked")),
    remove: () => Promise.reject(new Error("storage blocked")),
    restore: () => Promise.reject(new Error("storage blocked")),
    close: () => {},
  }));
  ok((await page.locator(".sn-mode-chip").innerText()).includes("Not saved"), "temporary mode chip discloses unsaved state");
  await page.locator(".sn-new").click();
  ok((await statusText(page)).includes("Not saved"), "failed create reports unsaved status instead of success");
  await page.locator(".sn-text").fill("unsaved but still here");
  const failDownload = page.waitForEvent("download");
  await page.locator(".sn-download").click();
  ok((await failDownload).suggestedFilename().endsWith(".txt"), "export still works while storage fails");
  await shot(page, "sticky-notes-unsaved.png");

  log("async canClose guards unsaved work with Cancel/Discard");
  let pending = page.evaluate(() => window.__snHandle.canClose());
  await page.locator('.sn-close-dialog [data-action="cancel"]').click();
  ok((await pending) === false, "Cancel refuses to close unsaved work");
  ok((await page.locator(".sn-text").inputValue()) === "unsaved but still here", "cancelled close keeps the note text");
  pending = page.evaluate(() => window.__snHandle.canClose());
  await page.locator('.sn-close-dialog [data-action="discard"]').click();
  ok((await pending) === true, "Discard permits close after an explicit choice");
  await page.evaluate(() => window.__snMount());

  log("revision conflict from a second connection is never silently overwritten");
  const conflictId = await makeNote(page, "shared note original");
  await page.evaluate((id) => window.__snOther.list().then(async (notes) => {
    const note = notes.find((item) => item.id === id);
    await window.__snOther.update(id, { text: "newer from other window" }, note.revision);
  }), conflictId);
  await page.locator(".sn-text").fill("stale local edit");
  await page.waitForFunction(() => document.querySelector(".sn-status")?.textContent.includes("Conflict"), null, { timeout: 4000 });
  ok((await statusText(page)).includes("Conflict"), "stale autosave reports a conflict");
  ok(await page.evaluate((id) => window.__snStore.list().then((notes) => notes.find((note) => note.id === id).text), conflictId) === "newer from other window",
     "the newer saved note is not overwritten");
  ok(await page.locator(".sn-text").inputValue() === "stale local edit", "local text is preserved for review/copy");
  await shot(page, "sticky-notes-conflict.png");

  log("notes stay separate from files, drafts and settings");
  const isolation = await page.evaluate(async () => {
    const readStore = (name) => new Promise((resolve) => {
      const request = window.__snDb.transaction(name, "readonly").objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result);
    });
    return {
      entries: (await readStore("entries")).length,
      drafts: (await readStore("drafts")).length,
      settingsKeys: (await readStore("settings")).map((row) => row.key),
      sticky: (await readStore("stickyNotes")).length,
    };
  });
  ok(isolation.settingsKeys.length === 0 && isolation.drafts === 0 && isolation.sticky > 0,
    `only the stickyNotes store was written (${JSON.stringify(isolation)})`);

  log("stale autosave completion keeps newer text and a truthful status");
  await page.evaluate(() => {
    const real = window.__snStore;
    const slow = {
      getMode: () => real.getMode(),
      ready: () => real.ready(),
      list: () => real.list(),
      create: (...args) => real.create(...args),
      remove: (...args) => real.remove(...args),
      restore: (...args) => real.restore(...args),
      close: () => real.close(),
      update(id, patch, revision) {
        const call = { id, text: patch.text, revision, done: false };
        window.__snSlowCall = call;
        return new Promise((resolve) => setTimeout(async () => {
          call.result = await real.update(id, patch, revision);
          call.done = true;
          resolve(call.result);
        }, 700));
      },
    };
    return window.__snMount(slow);
  });
  const dirtyMark = await page.evaluate(() => {
    window.__snStatusLog = [];
    const node = document.querySelector(".sn-status");
    window.__snStatusObserver?.disconnect();
    window.__snStatusObserver = new MutationObserver(() => window.__snStatusLog.push(node.textContent));
    window.__snStatusObserver.observe(node, { childList: true, characterData: true, subtree: true });
    return window.__snDirty.length;
  });
  await page.locator(`.sn-note-item[data-id="${firstId}"]`).click();
  await page.locator(".sn-text").fill("A");
  ok(await poll(page, () => page.evaluate(() => Boolean(window.__snSlowCall && !window.__snSlowCall.done))),
    "the real autosave for A is delayed and in flight");
  await page.locator(".sn-text").fill("B");
  ok(await poll(page, () => page.evaluate(() => window.__snSlowCall?.done === true)), "the older A commit completes");
  ok(await poll(page, () => page.evaluate(() => window.__snStatusLog.some((text) => text.includes("earlier version")))),
    `stale completion is explicitly reported before B commits (${JSON.stringify(await page.evaluate(() => window.__snStatusLog))})`);
  ok((await page.locator(".sn-text").inputValue()) === "B", "newer text B is still in the editor");
  ok(await page.evaluate((mark) => window.__snDirty.slice(mark).some((call) => call.value === true), dirtyMark),
    "parent dirty hook stays true for the newer text");
  ok(await poll(page, () => page.evaluate(async (noteId) =>
    (await window.__snStore.list()).find((note) => note.id === noteId)?.text === "B", firstId)),
  "newer text B is eventually autosaved");
  await page.evaluate(() => window.__snMount());

  log("dialogs stay fully on-screen when a compact app is scrolled");
  const narrow = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  const np = await narrow.newPage();
  watch(np);
  await openHarness(np);
  await np.locator(".sn-new").click();
  ok(await poll(np, async () => (await np.locator(".sn-text").inputValue()) === ""), "new note editor is ready");
  await np.locator(".sn-text").fill("scroll test");
  const searchBox = await np.locator(".sn-search").boundingBox();
  ok(searchBox.height >= 44, `search field is at least 44px on touch (${searchBox.height})`);
  await np.evaluate(() => {
    document.querySelector(".sn-app").scrollTop = 9999;
    window.__snClosePromise = window.__snHandle.canClose();
  });
  await np.locator(".sn-dialog").waitFor({ state: "visible" });
  const dialogBox = await np.locator(".sn-dialog").boundingBox();
  const dialogClose = await np.locator(".sn-dialog-x").boundingBox();
  ok(dialogBox.y >= 0 && dialogBox.y + dialogBox.height <= 640,
    `320x640 dialog stays within the viewport (${JSON.stringify(dialogBox)})`);
  ok(dialogClose.width >= 44 && dialogClose.height >= 44 && dialogClose.y >= 0,
    `320x640 dialog close is a 44px reachable target (${JSON.stringify(dialogClose)})`);
  await shot(np, "sticky-dialog-320x640.png");
  await np.setViewportSize({ width: 844, height: 390 });
  await np.reload({ waitUntil: "load" });
  await np.waitForFunction(() => window.__snReady === true, null, { timeout: 8000 });
  await np.locator(".sn-new").click();
  ok(await poll(np, async () => (await np.locator(".sn-text").inputValue()) === ""), "landscape note editor is ready");
  await np.locator(".sn-text").fill("landscape scroll test");
  await np.evaluate(() => {
    document.querySelector(".sn-app").scrollTop = 9999;
    window.__snClosePromise = window.__snHandle.canClose();
  });
  await np.locator(".sn-dialog").waitFor({ state: "visible" });
  const wideBox = await np.locator(".sn-dialog").boundingBox();
  const wideClose = await np.locator(".sn-dialog-x").boundingBox();
  ok(wideBox.y >= 0 && wideBox.y + wideBox.height <= 390,
    `844x390 dialog stays within the viewport (${JSON.stringify(wideBox)})`);
  ok(wideClose.width >= 44 && wideClose.height >= 44 && wideClose.y >= 0,
    `844x390 dialog close is reachable (${JSON.stringify(wideClose)})`);
  await shot(np, "sticky-dialog-844x390.png");
  await narrow.close();

  log("compact layout and dispose through signal");
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  ok(await mp.locator(".sn-new").isVisible() && await mp.locator(".sn-text").isVisible(),
    "compact layout keeps New and the editor reachable");
  await shot(mp, "sticky-notes-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator(".sn-new").isVisible() && await mp.locator(".sn-text").isVisible(),
    "short landscape keeps New and the editor usable");
  await shot(mp, "sticky-notes-landscape-844x390.png");
  await phone.close();

  await page.evaluate(() => window.__snAbort.abort());
  ok((await page.locator(".sn-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__snHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(requests.every((url) => url.startsWith(BASE)), `zero third-party requests (${requests.filter((url) => !url.startsWith(BASE)).join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL STICKY NOTES UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`STICKY NOTES UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
