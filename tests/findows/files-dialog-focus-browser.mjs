/* Focused Files modal-dialog focus regression. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/files-dialog-focus-browser.mjs [--port=8797] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8797, mounts the real Files module with a tiny
   in-page file service, opens the New folder dialog and verifies that Tab and
   Shift+Tab stay inside it and that Escape restores focus to the invoking control. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8797"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright(
  arg("playwright", "") || process.env.PLAYWRIGHT_MODULE,
);

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
<title>Files dialog focus harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/files.css">
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  #fw-desktop{height:100vh;width:100vw}
  .harness-bar{padding:8px 12px;font-size:12px}
  #app{height:calc(100vh - 42px)}
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar"><button id="outside" type="button">Outside control</button> <span>Focus here should be unreachable while the dialog is open.</span></div>
  <div id="app"></div>
</div>
<script type="module">
  import { mount } from "/findows/js/apps/files.mjs";
  const entries = new Map([
    ["root", { id: "root", parentId: null, name: "Findows", kind: "folder", mediaType: null, size: 0, createdAt: 1700000000000, updatedAt: 1700000000000, revision: 1, trashedAt: null }],
    ["documents", { id: "documents", parentId: "root", name: "Documents", kind: "folder", mediaType: null, size: 0, createdAt: 1700000000000, updatedAt: 1700000000000, revision: 1, trashedAt: null }],
  ]);
  const files = {
    ready: async () => "persistent",
    getStorageMode: () => "persistent",
    getModeReason: () => null,
    read: async (id) => {
      const entry = entries.get(id);
      if (!entry) throw new Error("MISSING");
      return { ...entry };
    },
    list: async (id) => [...entries.values()].filter((entry) => entry.parentId === id).map((entry) => ({ ...entry })),
    listTrash: async () => [],
    create: async (input) => {
      const entry = { id: "created", parentId: input.parentId, name: input.name, kind: "folder", mediaType: null, size: 0, createdAt: 1700000000000, updatedAt: 1700000000000, revision: 1, trashedAt: null };
      entries.set(entry.id, entry);
      return { ...entry };
    },
  };
  window.__filesAbort = new AbortController();
  window.__filesHandle = await mount({
    container: document.getElementById("app"),
    windowId: "files-dialog-focus-test",
    fileId: null,
    services: { files, openApp: () => {} },
    signal: window.__filesAbort.signal,
  });
  window.__filesReady = true;
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__files-dialog-focus-harness.html") {
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
console.log(`files dialog focus harness serving ${ROOT} at ${BASE}`);

let step = 0;
const log = (message) => console.log(`[${String(++step).padStart(2, "0")}] ${message}`);
const ok = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`      PASS ${message}`);
};

const consoleErrors = [];
const badResponses = [];
function watch(page) {
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });
}

const invoker = (page) => page.locator('.files-toolbar [data-act="new-folder"]');
async function openDialog(page) {
  await invoker(page).focus();
  await page.keyboard.press("Enter");
  await page.locator(".files-dialog").waitFor({ state: "visible", timeout: 3000 });
}
async function focusState(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector(".files-dialog");
    const active = document.activeElement;
    return {
      present: Boolean(dialog),
      inside: Boolean(dialog && active && dialog.contains(active)),
      tag: active?.tagName?.toLowerCase() || null,
      name: active?.getAttribute("aria-label") || active?.textContent?.trim().slice(0, 40) || null,
      inToolbar: Boolean(active?.closest?.(".files-toolbar")),
      inList: Boolean(active?.closest?.(".files-list, .files-rows, .files-body")),
      isOutside: active?.id === "outside",
    };
  });
}
async function assertTrapped(page, key, times, direction) {
  const seen = [];
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press(key);
    const state = await focusState(page);
    seen.push(`${state.tag}:${state.name}`);
    ok(state.inside && !state.inToolbar && !state.inList && !state.isOutside,
      `${direction} press ${i + 1} keeps focus inside the dialog (${JSON.stringify(state)})`);
  }
  return seen;
}

const browser = await chromium.launch({ headless: true });
try {
  log("mount and open the New folder dialog from its invoking control");
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  watch(page);
  await page.goto(`${BASE}/__files-dialog-focus-harness.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__filesReady === true, null, { timeout: 5000 });
  ok((await page.locator(".files-app").count()) === 1, "real Files app mounted");
  ok((await page.locator(".files-dialog").count()) === 0, "no dialog before the New folder action");
  await openDialog(page);
  const opened = await focusState(page);
  ok(opened.present && opened.inside, `dialog opens with focus inside (${JSON.stringify(opened)})`);
  ok((await page.locator(".files-dialog").getAttribute("aria-modal")) === "true",
    "the dialog declares aria-modal=true");

  log("Tab beyond the last control wraps and never escapes");
  const forward = await assertTrapped(page, "Tab", 8, "Tab");
  ok(new Set(forward).size >= 2, `Tab cycles through more than one control (${JSON.stringify(forward)})`);

  log("Shift+Tab before the first control wraps and never escapes");
  const backward = await assertTrapped(page, "Shift+Tab", 8, "Shift+Tab");
  ok(new Set(backward).size >= 2, `Shift+Tab cycles through more than one control (${JSON.stringify(backward)})`);

  log("Escape closes the dialog and restores focus to the invoking control");
  await page.keyboard.press("Escape");
  ok((await page.locator(".files-dialog").count()) === 0, "Escape closes the dialog");
  const restored = await page.evaluate(() => {
    const active = document.activeElement;
    return { act: active?.dataset?.act || null, cls: active?.className || null,
      inToolbar: Boolean(active?.closest?.(".files-toolbar")) };
  });
  ok(restored.act === "new-folder" && restored.inToolbar,
    `focus returns to the New folder button (${JSON.stringify(restored)})`);

  log("Cancel also cleans up and restores focus");
  await openDialog(page);
  await page.locator('.files-dialog [data-act="cancel"]').click();
  ok((await page.locator(".files-dialog").count()) === 0, "Cancel closes the dialog");
  const cancelRestored = await page.evaluate(() => document.activeElement?.dataset?.act || null);
  ok(cancelRestored === "new-folder", `Cancel restores focus to the invoking control (${cancelRestored})`);

  log("dispose and error hygiene");
  await page.evaluate(() => window.__filesAbort.abort());
  ok((await page.locator(".files-app").count()) === 0, "abort removes the app surface");
  await page.evaluate(() => window.__filesHandle.dispose());
  ok(true, "second dispose is safe");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  log("ALL FILES DIALOG FOCUS CHECKS PASSED");
  await context.close();
} catch (error) {
  console.error(`FILES DIALOG FOCUS CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
