/* Focused Paint UI evidence. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/paint-ui-browser.mjs [--port=8802] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8802 and mounts the production module with a
   real IndexedDB file service where the scenario needs it. */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8802"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
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
const moduleSource = readFileSync(resolve(ROOT, "findows/js/apps/paint.mjs"), "utf8");
const cssSource = readFileSync(resolve(ROOT, "findows/styles/paint.css"), "utf8");
const iconSource = readFileSync(resolve(ROOT, "findows/assets/icon-paint.svg"), "utf8");
if (!/export\s+async\s+function\s+mount\s*\(/.test(moduleSource)) {
  throw new Error("paint.mjs must export async function mount()");
}
for (const required of ["paint-engine.mjs", "import-export.mjs", "setPointerCapture", "pointercancel", "release()"]) {
  if (!moduleSource.includes(required)) throw new Error(`paint.mjs is missing ${required}`);
}
if (/\b(innerHTML|outerHTML|eval\s*\(|new\s+Function\s*\()/.test(moduleSource)) {
  throw new Error("paint.mjs must not use markup injection or dynamic code");
}
const badSelectors = cssSource
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith("{") && !line.startsWith(".paint-") && !line.startsWith("@") &&
    !/^(from|to|\d+(?:\.\d+)?%)$/.test(line.slice(0, -1).trim()));
if (badSelectors.length) throw new Error(`paint.css has unscoped selectors: ${badSelectors.join(" | ")}`);
if (!iconSource.trimStart().startsWith("<svg") || !iconSource.includes('viewBox="0 0 64 64"') ||
    /<script|onload=|href="https?:/i.test(iconSource)) {
  throw new Error("icon-paint.svg must be a local, original 64×64 SVG without scripts");
}
console.log("static checks: mount export, engine+import wiring, pointer capture/cancel, decode release, scoped CSS, local icon PASS");

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
<title>Paint UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/paint.css">
<style>
  html,body{margin:0;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  .harness-shell{padding:12px}
  .paint-host{width:min(940px,calc(100vw - 24px));height:min(680px,calc(100vh - 36px));margin:0 auto;
    border:1px solid rgba(255,255,255,.22);border-radius:14px;overflow:hidden}
  #app2{margin-top:12px}
  @media (max-width:600px),(max-height:499px){
    .paint-host{width:calc(100vw - 20px);height:min(620px,calc(100vh - 20px))}
  }
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-shell">
    <div id="app" class="paint-host"></div>
    <div id="app2" class="paint-host" hidden></div>
  </div>
</div>
<script type="module">
  const params = new URLSearchParams(location.search);
  const [{ mount }, storageModule, fileModule] = await Promise.all([
    import("/findows/js/apps/paint.mjs"),
    import("/findows/js/storage.mjs"),
    import("/findows/js/file-service.mjs"),
  ]);
  let files;
  if (params.get("temporary") === "1") {
    const unavailable = () => { const e = new Error("Storage unavailable"); e.code = "UNAVAILABLE"; throw e; };
    files = {
      getStorageMode: () => "temporary",
      list: async () => [],
      read: async () => { unavailable(); },
      create: unavailable,
      write: unavailable,
      createImage: unavailable,
      newDraftId: (app) => app + "-temporary",
      createDraft: (record) => record,
      putDraft: unavailable,
      deleteDraft: async () => {},
    };
  } else {
    const storage = storageModule.createStorage();
    await storage.ready();
    files = fileModule.createFileService({ storage });
    window.__paintStorage = storage;
  }
  const writes = [];
  const creates = [];
  let gateWrites = false;
  let releaseWriters = [];
  let gateDrafts = false;
  let releaseDraftResolvers = [];
  const nativeWrite = files.write;
  const nativeCreate = files.create;
  if (typeof nativeWrite === "function") {
    files.write = async (...args) => {
      writes.push(args);
      if (gateWrites) await new Promise((resolve) => { releaseWriters.push(resolve); });
      return nativeWrite(...args);
    };
  }
  if (typeof nativeCreate === "function") {
    files.create = async (...args) => {
      creates.push(args);
      if (gateWrites) await new Promise((resolve) => { releaseWriters.push(resolve); });
      return nativeCreate(...args);
    };
  }
  window.__paintWrites = writes;
  window.__paintCreates = creates;
  window.__paintGateWrites = () => { gateWrites = true; };
  window.__paintReleaseWrite = () => {
    gateWrites = false;
    const resolvers = releaseWriters;
    releaseWriters = [];
    for (const resolve of resolvers) resolve();
  };
  window.__paintGateDrafts = () => { gateDrafts = true; };
  window.__paintReleaseDrafts = () => {
    gateDrafts = false;
    const resolvers = releaseDraftResolvers;
    releaseDraftResolvers = [];
    for (const resolve of resolvers) resolve();
  };
  const dirtyCalls = [];
  const openApps = [];
  const binds = [];
  window.__paintDirtyCalls = dirtyCalls;
  window.__paintOpenApps = openApps;
  window.__paintBinds = binds;
  const services = {
    files,
    setDirty: (id, value) => dirtyCalls.push([id, Boolean(value)]),
    openApp: (...args) => openApps.push(args),
    bindDocument: (id, info) => binds.push([id, info]),
  };
  let draftWrites = 0;
  if (typeof files.putDraft === "function") {
    const originalPutDraft = files.putDraft;
    files.putDraft = async (...args) => {
      draftWrites += 1;
      if (gateDrafts) await new Promise((resolve) => { releaseDraftResolvers.push(resolve); });
      return originalPutDraft(...args);
    };
  }
  window.__paintDraftWrites = () => draftWrites;
  window.__paintAbort = new AbortController();
  window.__paintHandle = await mount({
    container: document.getElementById("app"),
    windowId: "paint-ui-test",
    fileId: params.get("fileId") || null,
    mode: "edit",
    draftId: params.get("draftId") || null,
    services,
    signal: window.__paintAbort.signal,
  });
  window.__mountPaint = (options = {}) => {
    document.getElementById("app2").hidden = false;
    return mount({
      container: document.getElementById("app2"),
      windowId: "paint-ui-second",
      mode: "edit",
      services,
      signal: new AbortController().signal,
      ...options,
    });
  };
  window.__paintReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__paint-ui-harness.html") {
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
console.log(`paint UI harness serving ${ROOT} at ${BASE}`);

let step = 0;
const log = (message) => console.log(`[${String(++step).padStart(2, "0")}] ${message}`);
const ok = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`      PASS ${message}`);
};
const shot = (page, name) => page.screenshot({ path: resolve(OUT, name), fullPage: false });

const consoleErrors = [];
const badResponses = [];
function watch(page) {
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
}

const browser = await chromium.launch({ headless: true });
async function newContext(options = {}) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    window.__paintTimers = new Set();
    const nativeSet = window.setTimeout.bind(window);
    const nativeClear = window.clearTimeout.bind(window);
    window.setTimeout = (...args) => {
      const id = nativeSet(...args);
      window.__paintTimers.add(id);
      return id;
    };
    window.clearTimeout = (id) => {
      window.__paintTimers.delete(id);
      return nativeClear(id);
    };
  });
  return context;
}
async function openHarness(page, query = "") {
  await page.goto(`${BASE}/__paint-ui-harness.html${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__paintReady === true, null, { timeout: 8000 });
}
const statusText = (page) => page.locator(".paint-status").innerText();
const pixel = (page, x, y, root = ".paint-app") =>
  page.evaluate(({ x, y, root }) => {
    const canvas = document.querySelector(`${root} .paint-canvas`);
    return [...canvas.getContext("2d").getImageData(x, y, 1, 1).data];
  }, { x, y, root });
const isWhite = (rgba) => rgba[0] > 245 && rgba[1] > 245 && rgba[2] > 245;
const isRed = (rgba) => rgba[0] > 160 && rgba[1] < 110 && rgba[2] < 110;
const isBlue = (rgba) => rgba[2] > 140 && rgba[0] < 120;
async function clientPoint(page, x, y, root = ".paint-app") {
  const box = await page.locator(`${root} .paint-canvas`).boundingBox();
  return { x: box.x + ((x + 0.5) / 1024) * box.width, y: box.y + ((y + 0.5) / 768) * box.height };
}
async function mouseStroke(page, from, to) {
  const a = await clientPoint(page, ...from);
  const b = await clientPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}
async function createSamplePng(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 200, 100);
    context.fillStyle = "#e5484d";
    context.fillRect(40, 20, 120, 60);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
}
async function savedEntry(page, name, parent = "documents") {
  return page.evaluate(async ({ name, parent }) => {
    const files = await import("/findows/js/file-service.mjs");
    void files;
    const list = await window.__paintFiles.list(parent);
    const entry = list.find((item) => item.name === name);
    if (!entry) return null;
    const blob = await window.__paintFiles.read(entry.id);
    return { id: blob.id, name: blob.name, revision: blob.revision, origin: blob.origin, size: blob.size };
  }, { name, parent });
}

try {
  log("mount contract, real 1024×768 canvas and zoom-to-fit");
  const desktop = await newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  await page.evaluate(() => {
    window.__paintFiles = Object.values(window).find((v) => v && v.getStorageMode && v.createImage) || null;
  });
  // The harness keeps files private; expose a small reader for evidence only.
  await page.evaluate(() => {
    const storage = window.__paintStorage;
    return import("/findows/js/file-service.mjs").then((module) => {
      window.__paintFiles = module.createFileService({ storage });
    });
  });
  const shape = await page.evaluate(() => {
    const handle = window.__paintHandle;
    return {
      canClose: typeof handle?.canClose,
      focus: typeof handle?.focus,
      dispose: typeof handle?.dispose,
      width: document.querySelector(".paint-canvas").width,
      height: document.querySelector(".paint-canvas").height,
    };
  });
  ok(shape.canClose === "function" && shape.focus === "function" && shape.dispose === "function",
     `mount returns canClose/focus/dispose (${JSON.stringify(shape)})`);
  ok(shape.width === 1024 && shape.height === 768, "backing canvas is exactly 1024×768");
  const box = await page.locator(".paint-canvas").boundingBox();
  ok(box.width < 1024 && Math.abs(box.width / box.height - 1024 / 768) < 0.02,
     `canvas is scaled to fit with a 4:3 ratio (${box.width.toFixed(0)}×${box.height.toFixed(0)})`);
  ok((await page.locator(".paint-tool").count()) === 5 &&
     (await page.locator('.paint-tool[data-tool="brush"]').getAttribute("aria-pressed")) === "true",
     "five real tools with brush selected");
  ok((await statusText(page)).includes("1024 × 768") && (await statusText(page)).includes("Not saved"),
     "status exposes canvas size and unsaved state");
  await shot(page, "paint-ui-desktop.png");

  log("pointer drawing, cursor feedback, undo and redo");
  await page.click('.paint-swatch[data-color="#e5484d"]');
  await page.locator(".paint-width").evaluate((node) => {
    node.value = "12";
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await mouseStroke(page, [120, 120], [260, 120]);
  ok(isRed(await pixel(page, 190, 120)), "mouse stroke paints the pointed logical pixel red");
  ok((await statusText(page)).includes("260"), "status cursor tracks the final pointer position");
  await page.click('[data-action="undo"]');
  ok(isWhite(await pixel(page, 190, 120)), "undo restores the exact pixel");
  await page.click('[data-action="redo"]');
  ok(isRed(await pixel(page, 190, 120)), "redo restores the stroke");
  await shot(page, "paint-ui-drawing.png");

  log("typed coordinates, keyboard drawing, arrows and clear");
  await page.click('.paint-tool[data-tool="rect"]');
  await page.click('.paint-swatch[data-color="#16b8a6"]');
  await page.locator(".paint-x").fill("300");
  await page.locator(".paint-y").fill("200");
  await page.click('[data-action="set-cursor"]');
  await page.locator(".paint-canvas").focus();
  await page.keyboard.press("Space");
  const rectDrawn = await page.evaluate(() => {
    const canvas = document.querySelector(".paint-canvas");
    const data = canvas.getContext("2d").getImageData(258, 158, 84, 84).data;
    let found = false;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 90 && data[i + 1] > 120 && data[i + 2] > 100) found = true;
    }
    return found;
  });
  ok(rectDrawn, "Space stamps a rectangle at the typed coordinates");
  const typedStatus = await statusText(page);
  ok(typedStatus.includes("300") && typedStatus.includes("200"),
     `typed cursor position is announced (${JSON.stringify(typedStatus)})`);
  await page.keyboard.press("ArrowRight");
  const arrowStatus = await statusText(page);
  ok(arrowStatus.includes("X 301") && arrowStatus.includes("Y 200"), "arrow key moves the cursor by one pixel");
  await page.keyboard.press("Control+z");
  const rectUndone = await page.evaluate(() => {
    const data = document.querySelector(".paint-canvas").getContext("2d").getImageData(258, 158, 84, 84).data;
    return [...data].every((value, index) => index % 4 === 3 || value > 245);
  });
  ok(rectUndone, "Ctrl+Z cancels or undoes the keyboard stamp");
  await page.keyboard.press("Control+Shift+z");
  await page.click('[data-action="clear"]');
  ok(isWhite(await pixel(page, 190, 120)), "Clear returns the document to the white background");
  await page.click('[data-action="undo"]');
  ok(isRed(await pixel(page, 190, 120)), "Clear is undoable");

  log("Save As writes a generated PNG with optimistic revision");
  await page.click('[data-action="save"]');
  await page.waitForSelector(".paint-dialog .paint-save-name");
  await page.locator(".paint-save-name").fill("drawing.png");
  await page.locator(".paint-save-parent").selectOption("documents");
  await page.click(".paint-dialog .paint-create");
  await page.waitForFunction(() => document.querySelector(".paint-status")?.textContent.includes("Saved"));
  let entry = await savedEntry(page, "drawing.png");
  ok(Boolean(entry) && entry.revision === 1 && entry.origin === "created",
     `Save As creates one generated file at revision 1 (${JSON.stringify(entry)})`);
  const savedPixels = await page.evaluate(async (id) => {
    const record = await window.__paintFiles.read(id);
    const bitmap = await createImageBitmap(record.blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return {
      width: canvas.width,
      height: canvas.height,
      red: [...canvas.getContext("2d").getImageData(190, 120, 1, 1).data],
    };
  }, entry.id);
  ok(savedPixels.width === 1024 && savedPixels.height === 768 && isRed(savedPixels.red),
     "exported PNG decodes at 1024×768 with the drawn pixel preserved");
  ok((await page.evaluate(() => window.__paintDirtyCalls.at(-1)))?.[1] === false,
     "services.setDirty(false) is called only after the commit");
  const bindAfterSave = await page.evaluate(() => window.__paintBinds.at(-1));
  ok(bindAfterSave?.[0] === "paint-ui-test" && bindAfterSave?.[1]?.fileId === entry.id &&
     bindAfterSave?.[1]?.mode === "edit",
     "Save As binds the new generated document for Files → Open");

  log("revision conflict offers reload/copy and never overwrites silently");
  await mouseStroke(page, [500, 300], [620, 300]);
  await page.evaluate(async (id) => {
    const before = await window.__paintFiles.read(id);
    const blank = document.createElement("canvas");
    blank.width = 1024;
    blank.height = 768;
    const context = blank.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 1024, 768);
    const blob = await new Promise((resolve) => blank.toBlob(resolve, "image/png"));
    await window.__paintFiles.write(id, { blob, image: { width: 1024, height: 768 } }, before.revision);
  }, entry.id);
  await page.click('[data-action="save"]');
  await page.waitForSelector(".paint-dialog .paint-copy");
  ok((await page.locator(".paint-dialog").innerText()).toLowerCase().includes("newer"),
     "a stale save shows a newer-version conflict dialog");
  await page.click(".paint-dialog .paint-copy");
  await page.locator(".paint-save-name").fill("conflict-copy.png");
  await page.click(".paint-dialog .paint-create");
  await page.waitForFunction(() => document.querySelector(".paint-status")?.textContent.includes("conflict-copy.png"));
  const originalAfter = await page.evaluate(async (id) => {
    const record = await window.__paintFiles.read(id);
    const bitmap = await createImageBitmap(record.blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return [...canvas.getContext("2d").getImageData(560, 300, 1, 1).data];
  }, entry.id);
  ok(isWhite(originalAfter), "the externally updated file is not silently overwritten by the stale save");
  ok(Boolean(await savedEntry(page, "conflict-copy.png")), "Save a copy creates the explicit alternative file");

  log("picker import keeps original bytes and edits require Save As");
  const sampleBase64 = await createSamplePng(page);
  await page.locator(".paint-file-input").setInputFiles({
    name: "sample.png",
    mimeType: "image/png",
    buffer: Buffer.from(sampleBase64, "base64"),
  });
  await page.waitForFunction(() => document.querySelector(".paint-status")?.textContent.includes("sample.png"));
  ok(isRed(await pixel(page, 500, 380)), "validated picker image is fitted into the document");
  ok((await statusText(page)).includes("Not saved"), "an imported picker image starts as an unsaved drawing");
  ok((await page.evaluate(() => window.__paintBinds.at(-1)))?.[1]?.fileId === null,
     "replacing with an unsaved imported document binds a null fileId");
  const originalHash = createHash("sha256").update(Buffer.from(sampleBase64, "base64")).digest("hex");
  await page.click('[data-action="keep-original"]');
  await page.waitForSelector(".paint-original-name");
  await page.locator(".paint-original-name").fill("kept-original.png");
  await page.click(".paint-dialog .paint-create");
  await page.waitForFunction(() => document.querySelector(".paint-status")?.textContent.includes("kept-original.png"));
  const kept = await savedEntry(page, "kept-original.png", "pictures");
  ok(Boolean(kept) && kept.origin === "import", "original bytes are stored only on the explicit keep-original action");
  const keptHash = await page.evaluate(async (id) => {
    const record = await window.__paintFiles.read(id);
    const digest = await crypto.subtle.digest("SHA-256", await record.blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }, kept.id);
  ok(keptHash === originalHash, "the stored original is byte-for-byte identical to the picked file");
  await mouseStroke(page, [700, 500], [800, 500]);
  await page.click('[data-action="save"]');
  await page.locator(".paint-save-name").fill("edited-copy.png");
  await page.click(".paint-dialog .paint-create");
  await page.waitForFunction(() => document.querySelector(".paint-status")?.textContent.includes("edited-copy.png"));
  const keptHashAfter = await page.evaluate(async (id) => {
    const record = await window.__paintFiles.read(id);
    const digest = await crypto.subtle.digest("SHA-256", await record.blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }, kept.id);
  ok(keptHashAfter === originalHash, "editing and Save As never modify the preserved original");
  await shot(page, "paint-ui-import.png");

  log("a stored imported file routes Save to Save As");
  const revBefore = (await savedEntry(page, "kept-original.png", "pictures")).revision;
  await page.evaluate(async (id) => {
    window.__secondHandle = await window.__mountPaint({ fileId: id });
  }, kept.id);
  const second = page.locator("#app2");
  await page.waitForSelector("#app2 .paint-canvas");
  ok((await second.locator(".paint-status").innerText()).toLowerCase().includes("import"),
     "opening an imported record discloses its origin");
  await second.locator('[data-action="save"]').click();
  await page.waitForSelector("#app2 .paint-dialog .paint-save-name");
  await second.locator(".paint-dialog .paint-cancel").click();
  ok((await savedEntry(page, "kept-original.png", "pictures")).revision === revBefore,
     "Save on an imported original cannot write to it");
  ok(!(await page.evaluate((id) => window.__paintBinds.some(([, info]) => info.fileId === id), kept.id)),
     "an imported original is never bound as a writable edit document");
  await page.evaluate(() => {
    window.__secondHandle.dispose();
    document.getElementById("app2").hidden = true;
  });
  await page.evaluate(() => window.scrollTo(0, 0));

  log("async close confirmation and timer cleanup");
  await mouseStroke(page, [820, 600], [900, 600]);
  await page.evaluate(() => { window.__closePromise = window.__paintHandle.canClose(); });
  await page.waitForSelector("#app .paint-dialog .paint-cancel");
  await page.click("#app .paint-dialog .paint-cancel");
  ok((await page.evaluate(() => window.__closePromise)) === false, "Cancel resolves canClose(false) and keeps editing");
  await page.evaluate(() => { window.__closePromise = window.__paintHandle.canClose(); });
  await page.waitForSelector("#app .paint-dialog .paint-discard");
  await page.click("#app .paint-dialog .paint-discard");
  ok((await page.evaluate(() => window.__closePromise)) === true, "Discard resolves canClose(true)");
  ok((await page.evaluate(() => window.__paintDirtyCalls.at(-1)))?.[1] === false, "discard reports a clean document");
  const timersBefore = await page.evaluate(() => window.__paintTimers.size);
  await page.evaluate(() => window.__paintAbort.abort());
  ok((await page.locator("#app .paint-app").count()) === 0, "abort removes the app surface");
  const draftsAtDispose = await page.evaluate(() => window.__paintDraftWrites());
  await page.waitForTimeout(750);
  ok((await page.evaluate(() => window.__paintTimers.size)) <= timersBefore &&
     (await page.evaluate(() => window.__paintDraftWrites())) === draftsAtDispose,
     "abort starts no new timers or draft writes after dispose");
  await page.evaluate(() => window.__paintHandle.dispose());
  ok(true, "a second dispose() is safe");

  log("temporary storage still downloads a real PNG");
  const temporary = await newContext({ viewport: { width: 1100, height: 760 } });
  const tp = await temporary.newPage();
  watch(tp);
  await openHarness(tp, "?temporary=1");
  await tp.click('.paint-swatch[data-color="#4f6df5"]');
  await mouseStroke(tp, [200, 200], [340, 200]);
  await tp.click('[data-action="save"]');
  ok((await statusText(tp)).toLowerCase().includes("not saved"), "temporary mode says the work was not saved");
  ok((await tp.locator(".paint-mode-chip").innerText()).toLowerCase().includes("download a copy"),
     "storage chip tells the visitor to download a copy");
  const [download] = await Promise.all([
    tp.waitForEvent("download"),
    tp.click('[data-action="download"]'),
  ]);
  const downloadPath = await download.path();
  const bytes = readFileSync(downloadPath);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  ok(download.suggestedFilename().endsWith(".png") && width === 1024 && height === 768,
     `download is a 1024×768 PNG even in temporary mode (${download.suggestedFilename()})`);
  await shot(tp, "paint-ui-temporary.png");
  await temporary.close();

  log("touch and compact layout");
  const phone = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  watch(mp);
  await openHarness(mp);
  const controlHeights = await mp.locator(".paint-tool, .paint-swatch, .paint-action").evaluateAll(
    (nodes) => nodes.filter((node) => node.getClientRects().length > 0).map((node) => node.getBoundingClientRect().height));
  ok(controlHeights.every((height) => height >= 44),
     `compact controls are at least 44px (min ${Math.min(...controlHeights).toFixed(1)})`);
  await mp.click('.paint-swatch[data-color="#1f2937"]');
  const tapPoint = await clientPoint(mp, 500, 400);
  await mp.touchscreen.tap(tapPoint.x, tapPoint.y);
  ok(!isWhite(await pixel(mp, 500, 400)), "touch tap paints the logical pixel under the finger");
  await shot(mp, "paint-ui-compact-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok(await mp.locator(".paint-canvas").isVisible() && await mp.locator(".paint-tool").first().isVisible(),
     "short landscape keeps the canvas and tools reachable");
  await shot(mp, "paint-ui-landscape-844x390.png");
  await phone.close();

  log("light theme");
  const light = await newContext({ viewport: { width: 1200, height: 820 } });
  const lp = await light.newPage();
  watch(lp);
  await openHarness(lp, "?theme=light");
  await lp.evaluate(() => { document.getElementById("fw-desktop").dataset.theme = "light"; });
  await lp.waitForTimeout(220);
  await shot(lp, "paint-ui-light.png");
  await light.close();

  log("pending save keeps newer edits dirty and serializes writes");
  const race = await newContext({ viewport: { width: 1200, height: 820 } });
  const rp = await race.newPage();
  watch(rp);
  await openHarness(rp);
  await rp.evaluate(async () => {
    const module = await import("/findows/js/file-service.mjs");
    window.__paintFiles = module.createFileService({ storage: window.__paintStorage });
  });
  await rp.click('.paint-swatch[data-color="#e5484d"]');
  await mouseStroke(rp, [100, 100], [220, 100]);
  await rp.click('[data-action="save"]');
  await rp.locator(".paint-save-name").fill("race.png");
  await rp.click(".paint-dialog .paint-create");
  await rp.waitForFunction(() => document.querySelector(".paint-status")?.textContent.includes("race.png"));
  await mouseStroke(rp, [300, 300], [420, 300]);
  await rp.evaluate(() => window.__paintGateWrites());
  await rp.click('[data-action="save"]');
  await rp.waitForFunction(() => window.__paintWrites.length === 1);
  await rp.locator('[data-action="save"]').evaluate((node) => node.click());
  await mouseStroke(rp, [600, 500], [700, 500]);
  await rp.evaluate(() => {
    window.__raceClose = window.__paintHandle.canClose();
    window.__raceCloseDone = false;
    window.__raceClose.then(() => { window.__raceCloseDone = true; });
  });
  await rp.waitForTimeout(120);
  ok(!(await rp.evaluate(() => window.__raceCloseDone)),
     "canClose waits for a pending real files.write");
  await rp.evaluate(() => window.__paintReleaseWrite());
  await rp.waitForTimeout(750);
  ok((await rp.evaluate(() => window.__paintWrites.length)) === 1,
     `a second Save cannot start a duplicate write (${await rp.evaluate(() => window.__paintWrites.length)})`);
  ok((await statusText(rp)).includes("Not saved"),
     "a newer edit made during the save is still reported as unsaved");
  await rp.waitForSelector(".paint-dialog .paint-cancel");
  await rp.click(".paint-dialog .paint-cancel");
  ok((await rp.evaluate(() => window.__raceClose)) === false,
     "close stays cancelled because the latest drawing is still dirty");
  const draftPixel = await rp.evaluate(async () => {
    const drafts = await window.__paintFiles.listDrafts();
    const blob = drafts.find((draft) => draft.appId === "paint")?.payload?.blob;
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return [...canvas.getContext("2d").getImageData(650, 500, 1, 1).data];
  });
  ok(Boolean(draftPixel) && isRed(draftPixel),
     `the newer stroke is recoverable from the draft (${JSON.stringify(draftPixel)})`);
  await race.close();

  log("edit-copy mode saves only to a new file");
  const copy = await newContext({ viewport: { width: 1200, height: 820 } });
  const cp = await copy.newPage();
  watch(cp);
  await openHarness(cp);
  await cp.evaluate(async () => {
    const module = await import("/findows/js/file-service.mjs");
    window.__paintFiles = module.createFileService({ storage: window.__paintStorage });
  });
  {
    await cp.click('.paint-swatch[data-color="#4f6df5"]');
    await mouseStroke(cp, [150, 150], [280, 150]);
    await cp.click('[data-action="save"]');
    await cp.locator(".paint-save-name").fill("source-copy.png");
    await cp.click(".paint-dialog .paint-create");
    await cp.waitForFunction(() => document.querySelector(".paint-status")?.textContent.includes("source-copy.png"));
  }
  const sourceEntry = await savedEntry(cp, "source-copy.png");
  const sourceHash = await cp.evaluate(async (id) => {
    const record = await window.__paintFiles.read(id);
    const digest = await crypto.subtle.digest("SHA-256", await record.blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }, sourceEntry.id);
  await cp.evaluate(async (id) => {
    window.__copyHandle = await window.__mountPaint({ fileId: id, mode: "edit-copy" });
  }, sourceEntry.id);
  await cp.waitForSelector("#app2 .paint-canvas");
  const copyStatus = await cp.locator("#app2 .paint-status").innerText();
  ok(copyStatus.includes("Copy of source-copy.png") && copyStatus.includes("Not saved"),
     `edit-copy opens a distinct unsaved title (${JSON.stringify(copyStatus)})`);
  const copyBind = await cp.evaluate(() => window.__paintBinds.at(-1));
  ok(copyBind?.[0] === "paint-ui-second" && copyBind?.[1]?.fileId === null,
     "edit-copy binds as an unsaved document, not the source file");
  await cp.locator('#app2 [data-action="save"]').click();
  await cp.waitForSelector("#app2 .paint-dialog .paint-save-name");
  await cp.locator("#app2 .paint-save-name").fill("edited-from-copy.png");
  await cp.click("#app2 .paint-dialog .paint-create");
  await cp.waitForFunction(() => document.querySelector("#app2 .paint-status")?.textContent.includes("edited-from-copy.png"));
  const sourceAfter = await savedEntry(cp, "source-copy.png");
  const sourceHashAfter = await cp.evaluate(async (id) => {
    const record = await window.__paintFiles.read(id);
    const digest = await crypto.subtle.digest("SHA-256", await record.blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }, sourceEntry.id);
  ok(sourceAfter.revision === sourceEntry.revision && sourceHashAfter === sourceHash,
     "the source PNG revision and SHA-256 bytes are unchanged after edit-copy Save As");
  ok(Boolean(await savedEntry(cp, "edited-from-copy.png")),
     "edit-copy Save As creates the new editable PNG");
  await copy.close();

  log("dispose after a committed Save does not resurrect a draft");
  const durable = await newContext({ viewport: { width: 1200, height: 820 } });
  const dp = await durable.newPage();
  watch(dp);
  await openHarness(dp);
  await dp.evaluate(async () => {
    const module = await import("/findows/js/file-service.mjs");
    window.__paintFiles = module.createFileService({ storage: window.__paintStorage });
  });
  const paintDrafts = () => dp.evaluate(async () =>
    (await window.__paintFiles.listDrafts()).filter((draft) => draft.appId === "paint"));
  await dp.click('.paint-swatch[data-color="#e5484d"]');
  await mouseStroke(dp, [100, 100], [220, 100]);
  await dp.click('[data-action="save"]');
  await dp.locator(".paint-save-name").fill("dispose-saved.png");
  await dp.click(".paint-dialog .paint-create");
  await dp.waitForFunction(() => document.querySelector(".paint-status")?.textContent.includes("dispose-saved.png"));
  ok((await paintDrafts()).length === 0, "successful Save As leaves no Paint draft");
  await mouseStroke(dp, [300, 300], [420, 300]);
  ok((await statusText(dp)).includes("Not saved"), "a newer stroke is dirty before the delayed Save");
  await dp.evaluate(() => { window.__paintGateWrites(); window.__paintGateDrafts(); });
  await dp.click('[data-action="save"]');
  await dp.waitForFunction(() => window.__paintWrites.length === 1);
  await dp.evaluate(() => window.__paintAbort.abort());
  await dp.evaluate(() => window.__paintReleaseWrite());
  await dp.waitForTimeout(300);
  await dp.evaluate(() => window.__paintReleaseDrafts());
  await dp.waitForTimeout(500);
  const draftsAfterDispose = await paintDrafts();
  ok(draftsAfterDispose.length === 0,
     `dispose after the in-flight commit resolves does not recreate a draft (drafts ${draftsAfterDispose.length}, putDraft calls ${await dp.evaluate(() => window.__paintDraftWrites())})`);
  await durable.close();

  log("no console errors and no failed responses");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  log("ALL PAINT UI CHECKS PASSED");
  await desktop.close();
} catch (error) {
  console.error(`PAINT UI CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
