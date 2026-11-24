/* Focused Notepad UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/notepad-browser.mjs [--port=8798] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8798 and mounts the production module in a
   harness with injectable services backed by the real file service / IndexedDB.
   No fixture data is shipped: every file and draft in the checks is created in
   the browser through the real storage API. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8798"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
const PLAYWRIGHT = arg("playwright", "") || process.env.FINDOWS_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || undefined;

mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright(PLAYWRIGHT);

/* Static contract checks run before any browser work, so a missing app is red. */
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/notepad.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/notepad.css"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("notepad.mjs must export async function mount()");
}
if (/\b(document|window)\.addEventListener\s*\(/.test(moduleSource)) {
  throw new Error("notepad.mjs must not register window/document listeners");
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("notepad.mjs must not use markup injection or dynamic code");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".np-") && !line.startsWith("@"));
if (badSelectors.length) {
  throw new Error(`notepad.css has unscoped selectors: ${badSelectors.join(" | ")}`);
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
<title>Notepad UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/notepad.css">
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
  import { createStorage, STORAGE_CODES, StorageError } from "/findows/js/storage.mjs";
  import { createFileService } from "/findows/js/file-service.mjs";
  import { mount } from "/findows/js/apps/notepad.mjs";

  const storage = createStorage();
  window.__npStorageMode = await storage.ready();
  const files = createFileService({ storage });
  const calls = { openApp: [], dirty: [] };
  const services = {
    files,
    openApp(appId, options) { calls.openApp.push({ appId, options }); return Promise.resolve(null); },
    setDirty(windowId, value) { calls.dirty.push({ windowId, value }); },
  };
  window.__npStorage = storage;
  window.__npFiles = files;
  window.__npServices = services;
  window.__npCalls = calls;
  window.__npError = (code, message) => new StorageError(code, message);
  window.__npHandle = null;
  window.__npAbort = null;
  window.__npMount = async (options = {}) => {
    if (window.__npHandle) { window.__npHandle.dispose(); window.__npAbort.abort(); }
    window.__npAbort = new AbortController();
    window.__npHandle = await mount({
      container: document.getElementById("app"),
      windowId: options.windowId || "notepad-ui-test",
      fileId: options.fileId ?? null,
      draftId: options.draftId ?? null,
      mode: "edit",
      services,
      signal: window.__npAbort.signal,
    });
    window.__npReady = true;
    return true;
  };
  await window.__npMount();
  window.__npReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__notepad-ui-harness.html") {
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
console.log(`notepad UI harness serving ${ROOT} at ${BASE}`);

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
  await page.goto(`${BASE}/__notepad-ui-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__npReady === true, null, { timeout: 8000 });
}
const editorValue = (page) => page.locator(".np-editor").inputValue();
const statusText = (page) => page.locator(".np-status").innerText();
async function poll(page, predicate, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

async function installDelayedWrite(page, delay = 700) {
  await overrideFiles(page, "write", `(id, payload, revision, options) => {
    const record = { id, payload, revision, options, done: false };
    window.__npWriteCalls = (window.__npWriteCalls || []).concat([record]);
    window.__npDelayed = record;
    setTimeout(async () => {
      record.entry = await window.__npOverrides.write(id, payload, revision, options);
      record.done = true;
    }, ${delay});
    return new Promise((resolve) => {
      const wait = setInterval(() => {
        if (!record.done) return;
        clearInterval(wait);
        resolve(record.entry);
      }, 20);
    });
  }`);
  await page.evaluate(() => { window.__npWriteCalls = []; window.__npDelayed = null; });
}

async function makeFile(page, name, text) {
  return page.evaluate(async ({ name, text }) => {
    const entry = await window.__npFiles.createText({ parentId: "documents", name, text });
    return { id: entry.id, revision: entry.revision, name: entry.name };
  }, { name, text });
}

async function overrideFiles(page, method, fnSource) {
  await page.evaluate(({ method, fnSource }) => {
    if (!window.__npFilesOriginals) window.__npFilesOriginals = {};
    if (!window.__npFilesOriginals[method]) window.__npFilesOriginals[method] = window.__npFiles[method];
    const original = window.__npFilesOriginals[method];
    if (!window.__npOverrides) window.__npOverrides = {};
    window.__npOverrides[method] = original;
    window.__npFiles[method] = new Function("return " + fnSource)();
  }, { method, fnSource });
}
async function restoreFiles(page, method) {
  await page.evaluate(({ method }) => {
    window.__npFiles[method] = window.__npOverrides[method];
  }, { method });
}

const browser = await chromium.launch({ headless: true });
try {
  log("mount contract, accessible editor and initial saved content");
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  const shape = await page.evaluate(() => {
    const handle = window.__npHandle;
    return { canClose: typeof handle?.canClose, focus: typeof handle?.focus, dispose: typeof handle?.dispose };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
    `mount returns async canClose/focus/dispose (${JSON.stringify(shape)})`);
  const editorAttrs = await page.locator(".np-editor").evaluate((node) => ({
    tag: node.tagName.toLowerCase(),
    label: node.getAttribute("aria-label"),
    spellcheck: node.getAttribute("aria-describedby"),
  }));
  ok(editorAttrs.tag === "textarea" && Boolean(editorAttrs.label) && Boolean(editorAttrs.spellcheck),
    `document is a labelled textarea with a description (${JSON.stringify(editorAttrs)})`);
  ok(await page.locator(".np-recover").isVisible(), "Recover drafts entry is visible in the toolbar");
  ok((await statusText(page)).includes("Ln 1, Col 1"), "initial line/column status is Ln 1, Col 1");
  await page.locator("#outside").focus();
  await page.evaluate(() => window.__npHandle.focus());
  ok(await page.evaluate(() => document.activeElement?.classList.contains("np-editor")),
    "handle.focus() returns focus to the document editor");
  await shot(page, "notepad-ui-desktop-dark.png");

  log("saved Unicode file loads and Files/openApp wiring is used");
  const note = await makeFile(page, "emoji note.txt", "héllo 😀\nsecond line");
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  ok((await editorValue(page)) === "héllo 😀\nsecond line",
    `UTF-8 emoji text round-trips from the real file service (got ${JSON.stringify(await editorValue(page))}, err ${JSON.stringify(await page.locator(".np-error").textContent())}, status ${JSON.stringify(await statusText(page))})`);
  ok((await statusText(page)).includes("emoji note.txt"), "status names the open document");
  await page.locator(".np-open").click();
  await page.locator(".np-open-dialog").waitFor({ state: "visible" });
  ok(await page.locator(".np-open-dialog").isVisible(), "Open shows an in-app dialog");
  const listed = await page.locator(`.np-open-item[data-file-id="${note.id}"]`).count();
  ok(listed === 1, "Open lists files from the real file service");
  await page.locator(`.np-open-item[data-file-id="${note.id}"]`).click();
  await page.locator('.np-open-dialog [data-action="open-new"]').click();
  const openCalls = await page.evaluate(() => window.__npCalls.openApp);
  ok(openCalls.some((call) => call.appId === "notepad" && call.options?.fileId === note.id && call.options?.mode === "edit"),
    `selecting a file calls openApp('notepad', {fileId, mode:'edit'}) (${JSON.stringify(openCalls)})`);
  await page.locator('.np-toolbar [data-action="files"]').click();
  const filesCalls = await page.evaluate(() => window.__npCalls.openApp);
  ok(filesCalls.some((call) => call.appId === "files" && call.options?.mode === "browse"),
    "Files launcher opens the Files app through openApp");
  await page.locator(".np-new").click();
  const newCalls = await page.evaluate(() => window.__npCalls.openApp);
  ok(newCalls.some((call) => call.appId === "notepad" && call.options?.fileId == null),
    "New opens a fresh untitled editor through openApp");

  log("dirty autosave, per-editor draft and line/column status");
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  await page.locator(".np-editor").fill("line one\nline two\nabc");
  await page.locator(".np-editor").evaluate((node) => node.setSelectionRange(20, 20));
  await page.locator(".np-editor").dispatchEvent("select");
  await page.waitForTimeout(600);
  ok((await statusText(page)).includes("Ln 3, Col 3"), "caret move updates line/column status");
  const drafts = await page.evaluate(() => window.__npFiles.listDrafts());
  const ownDraft = drafts.find((draft) => draft.appId === "notepad");
  ok(drafts.length === 1 && ownDraft?.fileId === note.id && ownDraft?.baseRevision === note.revision &&
     ownDraft.payload.text === "line one\nline two\nabc",
     `one recoverable draft is written with baseRevision (${JSON.stringify(drafts.map((d) => ({ id: d.draftId, base: d.baseRevision })))})`);
  const dirtyCalls = await page.evaluate(() => window.__npCalls.dirty);
  ok(dirtyCalls.some((call) => call.windowId === "notepad-ui-test" && call.value === true),
    "setDirty(windowId, true) is called while dirty");

  log("literal markup stays text and makes no request");
  await page.locator(".np-editor").fill("<img src=x onerror=alert(1)>");
  ok((await editorValue(page)) === "<img src=x onerror=alert(1)>", "markup appears as literal text");
  const beforeRequests = requests.length;
  await page.waitForTimeout(150);
  ok(requests.length === beforeRequests, "typing markup fires no image or script request");
  ok((await page.locator(".np-editor img").count()) === 0, "no element is created from document text");

  log("find next wraps around with case option and reports matches");
  await page.locator(".np-editor").fill("alpha beta alpha beta alpha");
  await page.keyboard.press("Control+f");
  ok(await page.locator(".np-findbar").isVisible(), "Ctrl+F opens the scoped find bar");
  await page.locator(".np-find-input").fill("alpha");
  await page.locator(".np-find-next").click();
  let selection = await page.locator(".np-editor").evaluate((node) => ({ start: node.selectionStart, end: node.selectionEnd }));
  ok(selection.start === 0 && selection.end === 5, "first Find next selects the first match");
  ok((await statusText(page)).includes("1 of 3"), `status reports ordinal and total matches (${JSON.stringify(await statusText(page))})`);
  await page.locator(".np-find-next").click();
  selection = await page.locator(".np-editor").evaluate((node) => ({ start: node.selectionStart, end: node.selectionEnd }));
  ok(selection.start === 11, "find advances to the next match");
  await page.locator(".np-find-next").click();
  await page.locator(".np-find-next").click();
  selection = await page.locator(".np-editor").evaluate((node) => ({ start: node.selectionStart, end: node.selectionEnd }));
  ok(selection.start === 0 && (await statusText(page)).includes("1 of 3"), "find wraps to the first match");
  await page.locator(".np-find-input").fill("ALPHA");
  await page.locator(".np-editor").evaluate((node) => node.setSelectionRange(0, 0));
  await page.locator(".np-find-next").click();
  ok((await statusText(page)).includes("1 of 3"), "case-insensitive find still matches lowercase text");
  await page.locator(".np-find-case").click();
  await page.locator(".np-find-next").click();
  ok((await statusText(page)).includes("No matches"), "case-sensitive find reports no matches");
  await page.keyboard.press("Escape");
  ok(!(await page.locator(".np-findbar").isVisible()), "Escape closes the find bar without closing the editor");
  await shot(page, "notepad-ui-find.png");

  log("word wrap toggle and keyboard shortcut scoping");
  const wrapBefore = await page.locator(".np-editor").getAttribute("wrap");
  await page.locator(".np-wrap-toggle").click();
  ok((await page.locator(".np-editor").getAttribute("wrap")) !== wrapBefore, "word-wrap toggle changes the textarea wrap mode");
  ok((await page.locator(".np-wrap-toggle").getAttribute("aria-pressed")) === "true", "toggle exposes pressed state");
  const passive = await page.evaluate(() => {
    const area = document.querySelector(".np-editor");
    area.focus();
    const fire = (init) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      area.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const ime = fire({ key: "s", isComposing: true, ctrlKey: true });
    const imeCode = fire({ key: "s", ctrlKey: true, keyCode: 229 });
    const newTab = fire({ key: "n", ctrlKey: true });
    const closeTab = fire({ key: "w", ctrlKey: true });
    const back = fire({ key: "ArrowLeft", altKey: true });
    const tab = fire({ key: "Tab" });
    return { ime, imeCode, newTab, closeTab, back, tab };
  });
  ok(!passive.ime && !passive.imeCode && !passive.newTab && !passive.closeTab && !passive.back && !passive.tab,
    `IME and browser navigation keys are not intercepted (${JSON.stringify(passive)})`);
  const beforeOutside = await editorValue(page);
  await page.locator("#outside").focus();
  await page.keyboard.type("typed outside");
  await page.keyboard.press("Control+s");
  ok((await editorValue(page)) === beforeOutside, "keys outside the app never reach the editor");

  log("Save commits through a real revision-checked write and clears only its draft");
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  await page.locator(".np-editor").fill("saved via notepad ✓");
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => document.querySelector(".np-status")?.textContent.includes("Saved"), null, { timeout: 4000 });
  const savedEntry = await page.evaluate((id) => window.__npFiles.read(id), note.id);
  ok(savedEntry.text === "saved via notepad ✓" && savedEntry.revision === note.revision + 1,
    `Save commits text and bumps revision (${savedEntry.revision})`);
  const afterSaveDrafts = await page.evaluate(() => window.__npFiles.listDrafts());
  ok(!afterSaveDrafts.some((draft) => draft.payload?.text === "saved via notepad ✓") && afterSaveDrafts.length > 0,
     "Save deletes only the editor's own draft and leaves other tabs' drafts alone");
  ok((await page.evaluate(() => window.__npCalls.dirty)).some((call) => call.value === false), "setDirty(false) after save");

  log("guarded dirty close: Cancel keeps work, Discard removes work, Save closes");
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  await page.locator(".np-editor").fill("keep this text");
  let pending = page.evaluate(() => window.__npHandle.canClose());
  await page.locator('.np-close-dialog [data-action="cancel"]').click();
  ok((await pending) === false && (await editorValue(page)) === "keep this text", "Cancel refuses close without losing edits");
  pending = page.evaluate(() => window.__npHandle.canClose());
  await page.locator('.np-close-dialog [data-action="discard"]').click();
  ok((await pending) === true, "Discard permits close");
  const afterDiscard = await page.evaluate(() => window.__npFiles.listDrafts());
  ok(!afterDiscard.some((draft) => draft.payload?.text === "keep this text"), "Discard removes the editor's draft");
  await page.locator(".np-editor").fill("close via save");
  pending = page.evaluate(() => window.__npHandle.canClose());
  await page.locator('.np-close-dialog [data-action="save"]').click();
  ok((await pending) === true, "Save resolves a guarded close after commit");
  ok((await page.evaluate((id) => window.__npFiles.read(id), note.id)).text === "close via save", "close-save writes the text");

  log("Save As creates a distinct file and clears the draft");
  await page.locator(".np-editor").fill("a copy for documents");
  await page.locator(".np-save-as").click();
  await page.locator(".np-save-dialog").waitFor({ state: "visible" });
  ok(await page.locator(".np-save-dialog").isVisible(), "Save As opens the naming dialog");
  await page.locator(".np-save-name").fill("copy.txt");
  await page.locator('.np-save-dialog [data-action="create"]').click();
  await page.waitForFunction(() => document.querySelector(".np-status")?.textContent.includes("Saved"), null, { timeout: 4000 });
  const copy = await page.evaluate(async () => (await window.__npFiles.list("documents")).find((entry) => entry.name === "copy.txt"));
  ok(copy && copy.text === "a copy for documents", "Save As creates a new text record with the current text");
  const afterCopy = await page.evaluate(() => window.__npFiles.listDrafts());
  ok(!afterCopy.some((draft) => draft.payload?.text === "a copy for documents"), "Save As clears only its own draft");

  log("revision conflict offers review/copy/export and never overwrites");
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  await page.locator(".np-editor").fill("draft that must not overwrite");
  await overrideFiles(page, "write", `() => Promise.reject(window.__npError("REVISION_CONFLICT", "stale revision"))`);
  await page.locator(".np-save").click();
  await page.locator(".np-recovery-dialog").waitFor({ state: "visible" });
  ok((await page.locator(".np-recovery-dialog").innerText()).includes("Nothing was overwritten"),
    `conflict panel states nothing was overwritten (${(await page.locator(".np-recovery-dialog").innerText()).slice(0, 120)})`);
  ok(!(await statusText(page)).includes("Saved"), "conflict never reports a successful save");
  const downloadWait = page.waitForEvent("download");
  await page.locator('.np-recovery-dialog [data-action="download"]').click();
  const download = await downloadWait;
  ok(download.suggestedFilename().endsWith(".txt"), `Download a copy exports a .txt file (${download.suggestedFilename()})`);
  const unchanged = await page.evaluate((id) => window.__npFiles.read(id), note.id);
  ok(unchanged.text !== "draft that must not overwrite", "conflicting draft did not change saved content");
  await page.locator('.np-recovery-dialog [data-action="cancel"]').click();
  await restoreFiles(page, "write");

  log("quota and unavailable storage keep work exportable and say Not saved");
  await overrideFiles(page, "write", `() => Promise.reject(window.__npError("QUOTA", "Browser storage is full"))`);
  await page.locator(".np-save").click();
  await page.locator(".np-recovery-dialog").waitFor({ state: "visible" });
  ok((await page.locator(".np-recovery-dialog").innerText()).includes("download a copy"), "quota panel points to export");
  await page.locator('.np-recovery-dialog [data-action="cancel"]').click();
  await restoreFiles(page, "write");
  await overrideFiles(page, "getStorageMode", `() => "temporary"`);
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  ok((await page.locator(".np-mode-chip").innerText()).includes("Not saved"), "temporary mode chip discloses unsaved state");
  const exportWait = page.waitForEvent("download");
  await page.locator(".np-download").click();
  ok((await exportWait).suggestedFilename().endsWith(".txt"), "export works while storage is unavailable");
  await restoreFiles(page, "getStorageMode");

  log("local import validates UTF-8 and the 2 MiB ceiling");
  await page.evaluate(() => window.__npMount());
  await page.locator(".np-file-input").setInputFiles({ name: "imported.txt", mimeType: "text/plain", buffer: Buffer.from("imported ✓\nline2", "utf8") });
  await page.waitForFunction(() => document.querySelector(".np-editor")?.value.includes("imported"), null, { timeout: 4000 });
  ok((await editorValue(page)) === "imported ✓\nline2", "valid UTF-8 text file is imported into the editor");
  ok((await statusText(page)).includes("Not saved"), "imported text is marked unsaved");
  await page.locator(".np-file-input").setInputFiles({ name: "huge.txt", mimeType: "text/plain", buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 65) });
  ok((await page.locator(".np-error").innerText()).includes("2 MiB"), "oversized import shows an explicit limit error");
  ok((await editorValue(page)) === "imported ✓\nline2", "rejected import leaves current work intact");
  await page.locator(".np-file-input").setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from([0x61, 0xff, 0x62]) });
  await page.locator(".np-close-dialog").waitFor({ state: "visible" });
  await page.locator('.np-close-dialog [data-action="discard"]').click();
  await page.locator(".np-error").waitFor({ state: "visible" });
  ok((await page.locator(".np-error").innerText()).includes("UTF-8"), "invalid UTF-8 import is rejected");
  await shot(page, "notepad-ui-import-error.png");

  log("draft recovery is explicit: classification, review and resume");
  const recoveryFile = await makeFile(page, "recovery.txt", "saved version");
  const draftId = await page.evaluate(({ fileId }) => {
    const draft = window.__npFiles.createDraft({ appId: "notepad", fileId, baseRevision: 1, payload: { text: "draft version" } });
    window.__npFiles.putDraft(draft);
    return draft.draftId;
  }, { fileId: recoveryFile.id });
  await page.evaluate(({ fileId, draftId }) => window.__npMount({ fileId, draftId }), { fileId: recoveryFile.id, draftId });
  ok(await page.locator(".np-recovery-panel").isVisible(), "mounting a draft shows recovery UI instead of silently applying it");
  ok((await editorValue(page)) === "saved version", "saved text stays in the editor until the user resumes the draft");
  ok((await page.locator(".np-recovery-panel").innerText()).includes("same saved version"), "current draft is described as matching the saved version");
  await page.locator('.np-recovery-panel [data-action="resume"]').click();
  ok((await editorValue(page)) === "draft version", "explicit Resume applies the draft text");
  await page.evaluate(({ id }) => window.__npFiles.write(id, { text: "newer saved version" }, 1), { id: recoveryFile.id });
  await page.evaluate(({ fileId, draftId }) => window.__npMount({ fileId, draftId }), { fileId: recoveryFile.id, draftId });
  ok((await page.locator(".np-recovery-panel").innerText()).includes("newer"), "stale draft is identified against the newer revision");
  await page.locator('.np-recovery-panel [data-action="review"]').click();
  ok((await page.locator(".np-review").innerText()).includes("draft version") &&
     (await page.locator(".np-review").innerText()).includes("newer saved version"),
     "Review shows both versions side by side");
  await page.evaluate(async ({ id }) => {
    const entry = await window.__npFiles.read(id);
    await window.__npFiles.trash(id, entry.revision);
  }, { id: recoveryFile.id });
  await page.evaluate(({ draftId }) => window.__npMount({ fileId: null, draftId }), { draftId });
  ok((await page.locator(".np-recovery-panel").innerText()).includes("no longer"), "orphaned draft is disclosed when its source is missing");
  const copyWait = page.waitForEvent("download");
  await page.locator('.np-recovery-panel [data-action="download"]').click();
  ok((await copyWait).suggestedFilename().endsWith(".txt"), "orphaned draft can be exported as a copy");

  log("Recover drafts entry lists real drafts and keeps separate tabs separate");
  await page.evaluate(() => window.__npMount());
  await page.locator(".np-editor").fill("tab A work");
  await page.waitForFunction(async () => (await window.__npFiles.listDrafts()).some((draft) => draft.payload?.text === "tab A work"), null, { timeout: 4000 });
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  await page.locator(".np-editor").fill("tab B work");
  await page.waitForFunction(async () => (await window.__npFiles.listDrafts()).some((draft) => draft.payload?.text === "tab B work"), null, { timeout: 4000 });
  const allDrafts = await page.evaluate(() => window.__npFiles.listDrafts());
  ok(new Set(allDrafts.map((draft) => draft.draftId)).size === allDrafts.length, "two editors own distinct draft IDs");
  await page.locator(".np-recover").click();
  await page.waitForFunction(() => document.querySelectorAll(".np-drafts-dialog .np-draft-item").length >= 2, null, { timeout: 4000 });
  const draftItemCount = await page.locator(".np-drafts-dialog .np-draft-item").count();
  ok(draftItemCount >= 2, `Recover drafts lists every real notepad draft (${draftItemCount})`);
  await shot(page, "notepad-ui-recover.png");
  await page.locator('.np-drafts-dialog .np-dialog-actions [data-action="close"]').click();

  log("delayed commit keeps newer edits dirty/draftable and serializes duplicate saves");
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  await page.locator(".np-editor").fill("snapshot before slow commit");
  await overrideFiles(page, "write", `(id, payload, revision, options) => {
    const record = { id, payload, revision, options, done: false };
    window.__npWriteCalls = (window.__npWriteCalls || []).concat([record]);
    window.__npDelayed = record;
    setTimeout(async () => {
      record.entry = await window.__npOverrides.write(id, payload, revision, options);
      record.done = true;
    }, 700);
    return new Promise((resolve) => {
      const wait = setInterval(() => {
        if (!record.done) return;
        clearInterval(wait);
        resolve(record.entry);
      }, 20);
    });
  }`);
  await page.evaluate(() => { window.__npWriteCalls = []; });
  await page.locator(".np-save").click();
  await page.waitForFunction(() => Boolean(window.__npDelayed?.done === false), null, { timeout: 4000 });
  ok(await page.locator(".np-save").isDisabled() && await page.locator(".np-save-as").isDisabled(),
    "Save and Save As are disabled while a commit is pending");
  await page.evaluate(() => {
    document.querySelector(".np-save").click();
    document.querySelector(".np-save-as").click();
  });
  await page.locator(".np-editor").fill("newer text typed during commit");
  ok(await poll(page, () => page.evaluate(() => document.querySelector(".np-status")?.textContent.includes("earlier version"))),
    "completion explicitly says an earlier version was saved");
  const duplicateWrites = await page.evaluate(() => window.__npWriteCalls.length);
  ok(duplicateWrites === 1, `duplicate actions did not start a second write (${duplicateWrites})`);
  const committed = await page.evaluate((id) => window.__npFiles.read(id), note.id);
  ok(committed.text === "snapshot before slow commit", "the captured snapshot is what gets committed");
  ok((await editorValue(page)) === "newer text typed during commit", "newer typed text remains in the editor");
  ok((await statusText(page)).includes("Not saved"), "status still reports unsaved after a stale snapshot commit");
  ok(await poll(page, () => page.evaluate(async () =>
    (await window.__npFiles.listDrafts()).some((draft) => draft.payload?.text === "newer text typed during commit"))),
    "the newer text remains draftable");
  const dirtyTail = await page.evaluate(() => window.__npCalls.dirty.slice(-3));
  ok(dirtyTail.some((call) => call.value === true), "parent dirty hook stays true for the newer text");
  let pendingClose = page.evaluate(() => window.__npHandle.canClose());
  await page.locator(".np-close-dialog").waitFor({ state: "visible" });
  await page.locator('.np-close-dialog [data-action="cancel"]').click();
  ok((await pendingClose) === false, "close still prompts while newer text is unsaved");
  await restoreFiles(page, "write");

  log("a stale completion after switching documents does not touch the new document");
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  await page.locator(".np-editor").fill("old snapshot before switch");
  await overrideFiles(page, "write", `(id, payload, revision, options) => {
    const record = { id, payload, revision, options, done: false };
    window.__npWriteCalls = (window.__npWriteCalls || []).concat([record]);
    window.__npDelayed = record;
    setTimeout(async () => {
      record.entry = await window.__npOverrides.write(id, payload, revision, options);
      record.done = true;
    }, 700);
    return new Promise((resolve) => {
      const wait = setInterval(() => {
        if (!record.done) return;
        clearInterval(wait);
        resolve(record.entry);
      }, 20);
    });
  }`);
  await page.evaluate(() => { window.__npWriteCalls = []; });
  await page.locator(".np-save").click();
  await page.waitForFunction(() => Boolean(window.__npDelayed?.done === false), null, { timeout: 4000 });
  await page.evaluate((fileId) => window.__npMount({ fileId }), copy.id);
  ok(await poll(page, () => page.evaluate(() => window.__npWriteCalls.some((record) => record.done))),
    "the delayed stale write eventually completes");
  ok((await editorValue(page)) === "a copy for documents" && (await statusText(page)).includes("Saved"),
    "the switched document keeps its own text and saved state");
  await restoreFiles(page, "write");

  log("close waits for an in-flight save and does not resurrect its draft");
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  await page.locator(".np-editor").fill("close waits snapshot");
  await installDelayedWrite(page);
  await page.locator(".np-save").click();
  await page.waitForFunction(() => window.__npDelayed?.done === false, null, { timeout: 4000 });
  const waitingClose = page.evaluate(() => window.__npHandle.canClose());
  await page.waitForTimeout(250);
  const prematureDialog = await page.locator(".np-close-dialog").count();
  if (prematureDialog) await page.locator('.np-close-dialog [data-action="cancel"]').click();
  ok(prematureDialog === 0, "no close dialog replaced the pending save");
  ok(await poll(page, () => page.evaluate(() => window.__npWriteCalls.some((record) => record.done))),
    "the delayed real write completes while close is waiting");
  ok((await waitingClose) === true, "canClose waits for the in-flight save, then closes without a prompt");
  await page.evaluate(() => window.__npHandle.dispose());
  ok(await poll(page, () => page.evaluate(async () =>
    !(await window.__npFiles.listDrafts()).some((draft) => draft.payload?.text === "close waits snapshot"))),
    "a real successful close leaves no resurrected draft");
  await restoreFiles(page, "write");

  log("changed text during a pending save stays dirty and close still asks");
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  await page.locator(".np-editor").fill("earlier close snapshot");
  await installDelayedWrite(page);
  await page.locator(".np-save").click();
  await page.waitForFunction(() => window.__npDelayed?.done === false, null, { timeout: 4000 });
  const askingClose = page.evaluate(() => window.__npHandle.canClose());
  await page.waitForTimeout(250);
  const prematureAsk = await page.locator(".np-close-dialog").count();
  ok(prematureAsk === 0, "close does not prompt before the pending write completes");
  await page.locator(".np-editor").fill("later close edit");
  ok(await poll(page, () => page.evaluate(() => window.__npWriteCalls.some((record) => record.done))),
    "the earlier snapshot commits");
  await page.locator(".np-close-dialog").waitFor({ state: "visible", timeout: 2500 }).catch(() => {});
  const dialogShown = (await page.locator(".np-close-dialog").count()) > 0;
  ok(dialogShown, "close asks again because the newer text is still unsaved");
  if (dialogShown) {
    await page.locator('.np-close-dialog [data-action="cancel"]').click();
    ok((await askingClose) === false, "Cancel on the renewed close prompt keeps the editor open");
  }
  ok((await editorValue(page)) === "later close edit" && (await statusText(page)).includes("Not saved"),
    "cancelled close keeps the newer text and dirty state");
  await restoreFiles(page, "write");

  log("a pending Save As dialog is refused rather than replaced by close");
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  await page.locator(".np-save-as").click();
  await page.locator(".np-save-dialog").waitFor({ state: "visible" });
  ok((await page.evaluate(() => window.__npHandle.canClose())) === false,
    "canClose safely refuses while the naming dialog owns the window");
  ok(await page.locator(".np-save-dialog").isVisible() && (await page.locator(".np-close-dialog").count()) === 0,
    "the Save As dialog is still present and was not replaced by a close prompt");
  await page.locator('.np-save-dialog [data-action="cancel"]').click();

  log("forced dispose behind a pending save does not resurrect the same draft");
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  await page.locator(".np-editor").fill("dispose behind save");
  await installDelayedWrite(page);
  await page.locator(".np-save").click();
  await page.waitForFunction(() => window.__npDelayed?.done === false, null, { timeout: 4000 });
  await page.evaluate(() => window.__npHandle.dispose());
  ok(await poll(page, () => page.evaluate(() => window.__npWriteCalls.some((record) => record.done))),
    "the pending real write still completes after destruction");
  await page.waitForTimeout(350);
  ok(await poll(page, () => page.evaluate(async () =>
    !(await window.__npFiles.listDrafts()).some((draft) => draft.payload?.text === "dispose behind save"))),
    "forced dispose does not write the same draft behind the successful save");
  await restoreFiles(page, "write");

  log("Save As Escape returns focus to a real Notepad control");
  await page.evaluate((fileId) => window.__npMount({ fileId }), note.id);
  await page.locator(".np-save-as").focus();
  await page.keyboard.press("Enter");
  await page.locator(".np-save-dialog").waitFor({ state: "visible" });
  const dialogFocus = await page.evaluate(() => document.activeElement?.className || "");
  ok(dialogFocus.includes("np-save-") || dialogFocus.includes("np-dialog"),
    `focus enters the Save As dialog (${JSON.stringify(dialogFocus)})`);
  await page.keyboard.press("Escape");
  await page.locator(".np-save-dialog").waitFor({ state: "hidden" });
  await page.waitForTimeout(80);
  const afterEscape = await page.evaluate(() => ({
    body: document.activeElement === document.body,
    tag: document.activeElement?.tagName,
    cls: document.activeElement?.className || "",
    saveDisabled: document.querySelector(".np-save")?.disabled,
  }));
  ok(!afterEscape.body, `Escape focus is not dropped to body (${JSON.stringify(afterEscape)})`);
  ok(afterEscape.cls.includes("np-editor") || afterEscape.cls.includes("np-save"),
    `focus returns to a Notepad control (${JSON.stringify(afterEscape)})`);
  ok(afterEscape.saveDisabled === false, "Escape settles the save lock and re-enables Save");

  log("light theme, compact layout and dispose through signal");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await shot(page, "notepad-ui-desktop-light.png");
  await page.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "dark"; });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  ok(await mp.locator(".np-editor").isVisible() && await mp.locator(".np-save").isVisible(),
    "compact layout keeps the editor and Save reachable");
  await mp.locator(".np-editor").fill("touch note");
  ok((await mp.locator(".np-editor").inputValue()) === "touch note", "touch context can edit the document");
  await shot(mp, "notepad-ui-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator(".np-editor").isVisible() && await mp.locator(".np-save").isVisible(),
    "short landscape keeps editor and Save reachable");
  await shot(mp, "notepad-ui-landscape-844x390.png");
  await phone.close();

  await page.evaluate(() => { window.__npAbort.abort(); });
  ok((await page.locator(".np-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__npHandle.dispose());
  ok(true, "a second dispose() is safe");
  ok(requests.every((url) => url.startsWith(BASE)), `zero third-party requests (${requests.filter((url) => !url.startsWith(BASE)).join(" | ") || "none"})`);
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL NOTEPAD UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`NOTEPAD UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
