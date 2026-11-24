/* Focused repair evidence for the Files stale-load race and Files/Minesweeper touch targets.
   Dev-only; never shipped as site runtime.
   Usage: FINDOWS_PLAYWRIGHT_MODULE=<path> node tests/findows/files-mines-repair-browser.mjs [--port=8898] [--out=DIR] [--playwright=PATH]
   Serves this worktree on 127.0.0.1:8898 and mounts the real Files and Minesweeper
   modules with injectable in-page services. */
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8898"));
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright(
  arg("playwright", "") || process.env.FINDOWS_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE,
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
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Files/Mines repair harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/files.css">
<link rel="stylesheet" href="/findows/styles/minesweeper.css">
<style>
  html,body{margin:0;height:100%;overflow:hidden;background:#0b1230;color:#f5f8ff;font:14px/1.4 system-ui,sans-serif}
  #fw-desktop{height:100vh;width:100vw}
  .harness-bar{padding:6px 10px;font-size:11px}
  #app{height:calc(100vh - 34px)}
</style>
</head>
<body>
<div id="fw-desktop" data-theme="dark" data-layout="wide">
  <div class="harness-bar"><button id="outside" type="button">Outside control</button></div>
  <div id="app"></div>
</div>
<script type="module">
import { mount as mountFiles } from "/findows/js/apps/files.mjs";
import { mount as mountMines } from "/findows/js/apps/minesweeper.mjs";

const at = 1700000000000;
const E = (id, parentId, name, kind, extra = {}) => ({
  id, parentId, name, kind, mediaType: kind === "folder" ? null : "text/plain",
  size: 1, createdAt: at, updatedAt: at, revision: 1, trashedAt: null, ...extra,
});
const baseEntries = () => new Map([
  ["root", E("root", null, "Findows", "folder")],
  ["desktop", E("desktop", "root", "Desktop", "folder")],
  ["documents", E("documents", "root", "Documents", "folder")],
  ["pictures", E("pictures", "root", "Pictures", "folder")],
  ["A", E("A", "root", "A folder", "folder")],
  ["B", E("B", "root", "B folder", "folder")],
  ["note", E("note", "documents", "note.txt", "file", { revision: 3 })],
  ["old", E("old", "documents", "old.txt", "file", { revision: 7, trashedAt: at })],
]);

window.__mountFiles = async (config = {}) => {
  const entries = baseEntries();
  const calls = { list: [], trash: [], restore: [], create: [] };
  window.__filesCalls = calls;
  window.__pendingLists = {};
  const copy = (entry) => ({ ...entry });
  const siblings = (parentId) => [...entries.values()].filter((e) => e.parentId === parentId && e.trashedAt == null);
  const files = {
    ready: async () => "persistent",
    getStorageMode: () => "persistent",
    getModeReason: () => null,
    read: async (id) => {
      const entry = entries.get(id);
      if (!entry) throw new Error("MISSING");
      return copy(entry);
    },
    list: async (id) => {
      calls.list.push(id);
      if (config.controlled && (id === "A" || id === "B")) {
        return new Promise((resolveList) => { window.__pendingLists[id] = resolveList; });
      }
      return siblings(id).sort((a, b) => a.name.localeCompare(b.name)).map(copy);
    },
    listTrash: async () => [...entries.values()].filter((e) => e.trashedAt != null).map(copy),
    create: async (input) => {
      calls.create.push({ ...input });
      const entry = E("made-" + calls.create.length, input.parentId, input.name, "folder");
      entries.set(entry.id, entry);
      return copy(entry);
    },
    trash: async (id, revision) => {
      calls.trash.push([id, revision]);
      const entry = entries.get(id);
      entry.trashedAt = at;
      entry.revision = revision + 1;
      return copy(entry);
    },
    restore: async (id, revision, options = {}) => {
      calls.restore.push([id, revision]);
      const entry = entries.get(id);
      if (revision !== entry.revision) throw new Error("REVISION_CONFLICT");
      entry.trashedAt = null;
      if (options.name) entry.name = options.name;
      entry.revision = revision + 1;
      return { entry: copy(entry), destinationId: entry.parentId, usedSafeParent: false };
    },
    rename: async (id, name, revision) => {
      const entry = entries.get(id);
      entry.name = name; entry.revision = revision + 1;
      return copy(entry);
    },
    move: async (id, parentId, revision) => {
      const entry = entries.get(id);
      entry.parentId = parentId; entry.revision = revision + 1;
      return copy(entry);
    },
    purge: async (id, revision) => { calls.purge = [[id, revision]]; entries.delete(id); return { purgedIds: [id] }; },
  };
  window.__filesAbort = new AbortController();
  window.__filesHandle = await mountFiles({
    container: document.getElementById("app"),
    windowId: "files-repair-test",
    fileId: null,
    services: { files, openApp: () => {} },
    signal: window.__filesAbort.signal,
  });
  return true;
};

window.__mountMines = async () => {
  window.__minesAbort = new AbortController();
  window.__minesHandle = await mountMines({
    container: document.getElementById("app"),
    windowId: "mines-repair-test",
    fileId: null,
    services: {},
    signal: window.__minesAbort.signal,
  });
  return true;
};
</script>
</body>
</html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__files-mines-repair-harness.html") {
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
console.log(`files/mines repair harness serving ${ROOT} at ${BASE}`);

let step = 0;
const log = (message) => console.log(`\n[${String(++step).padStart(2, "0")}] ${message}`);
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
async function openHarness(page) {
  await page.goto(`${BASE}/__files-mines-repair-harness.html`, { waitUntil: "load" });
}

const browser = await chromium.launch({ headless: true });
try {
  log("stale folder listing: A then B, resolve B first, then A");
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  watch(page);
  await openHarness(page);
  await page.evaluate(() => window.__mountFiles({ controlled: true }));
  await page.locator('.files-name[data-entry-id="A"]').click();
  await page.locator('.files-name[data-entry-id="B"]').click();
  await page.waitForFunction(() => window.__pendingLists.A && window.__pendingLists.B, null, { timeout: 3000 });
  const pending = await page.evaluate(() => ({ calls: window.__filesCalls.list, keys: Object.keys(window.__pendingLists) }));
  ok(pending.keys.includes("A") && pending.keys.includes("B"),
    `both folder listings are in flight (${JSON.stringify(pending)})`);
  await page.evaluate(() => {
    const row = (id, name) => ({ id, parentId: "B", name, kind: "file", mediaType: "text/plain",
      size: 1, createdAt: 1, updatedAt: 1, revision: 1, trashedAt: null });
    window.__pendingLists.B([row("fresh", "fresh-B")]);
    window.__pendingLists.A([row("stale", "stale-A")]);
  });
  await page.waitForTimeout(120);
  const listing = await page.evaluate(() => ({
    crumbs: [...document.querySelectorAll(".files-crumb")].map((n) => n.textContent),
    names: [...document.querySelectorAll(".files-name")].map((n) => n.textContent),
  }));
  ok(listing.crumbs.at(-1) === "B folder" && listing.names.includes("fresh-B") && !listing.names.includes("stale-A"),
    `breadcrumb B shows only the B listing (${JSON.stringify(listing)})`);

  log("trash/restore revision flow still works");
  await page.evaluate(() => window.__filesAbort.abort());
  await openHarness(page);
  await page.evaluate(() => window.__mountFiles({ controlled: false }));
  await page.locator('.files-place[data-place="documents"]').click();
  await page.locator('.files-name[data-entry-id="note"]').click();
  await page.locator('.files-row[data-id="note"] [data-act="trash"]').click();
  await page.locator('.files-dialog [data-act="confirm"]').click();
  await page.waitForTimeout(80);
  await page.locator('.files-place[data-place="__trash__"]').click();
  await page.waitForTimeout(80);
  await page.locator('.files-row[data-id="note"] [data-act="restore"]').click();
  await page.waitForTimeout(80);
  const revisions = await page.evaluate(() => ({
    trash: window.__filesCalls.trash, restore: window.__filesCalls.restore,
    status: document.querySelector(".files-status")?.textContent || "",
  }));
  ok(JSON.stringify(revisions.trash) === '[["note",3]]' && JSON.stringify(revisions.restore) === '[["note",4]]' &&
     revisions.status.includes("Restored"),
    `trash r3 then restore r4 with success status (${JSON.stringify(revisions)})`);
  await desktop.close();

  const viewports = [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ];

  log("Files touch targets and dialog focus at 320x640, 390x844, 844x390");
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const p = await context.newPage();
    watch(p);
    await openHarness(p);
    await p.evaluate(() => window.__mountFiles({ controlled: false }));
    const label = `${viewport.width}x${viewport.height}`;
    const sizes = await p.evaluate(() => {
      const min = (selector) => {
        const nodes = [...document.querySelectorAll(selector)].filter((n) => n.getClientRects().length);
        return nodes.length ? Math.min(...nodes.map((n) => n.getBoundingClientRect().height)) : null;
      };
      return {
        place: min(".files-place"), button: min(".files-toolbar .files-button"),
        crumb: min(".files-crumb"), name: min(".files-name"), rowAction: min(".files-row-action"),
      };
    });
    ok(Object.values(sizes).every((value) => typeof value === "number" && value >= 44),
      `${label}: places/buttons/crumbs/names/row actions all >=44px (${JSON.stringify(sizes)})`);

    if (viewport.width === 844) {
      const placeReach = await p.evaluate(() => ({
        innerHeight: window.innerHeight,
        places: [...document.querySelectorAll(".files-place")].map((n) => ({
          place: n.dataset.place, top: Math.round(n.getBoundingClientRect().top),
          bottom: Math.round(n.getBoundingClientRect().bottom),
        })),
      }));
      ok(placeReach.places.every((r) => r.top >= 0 && r.bottom <= placeReach.innerHeight),
        `844x390: every Places control is inside the viewport (${JSON.stringify(placeReach)})`);
      await p.locator('.files-place[data-place="documents"]').tap();
      ok((await p.locator('.files-crumb[aria-current="page"]').innerText()) === "Documents",
        "844x390: tapping Documents navigates to that folder");
    }

    await p.locator('.files-toolbar [data-act="new-folder"]').tap();
    await p.locator(".files-dialog").waitFor({ state: "visible", timeout: 3000 });
    const dialogSizes = await p.evaluate(() => {
      const height = (selector) => Math.min(...[...document.querySelectorAll(selector)]
        .filter((n) => n.getClientRects().length).map((n) => n.getBoundingClientRect().height));
      return { input: height(".files-input"), cancel: height('.files-dialog [data-act="cancel"]'),
        confirm: height('.files-dialog [data-act="confirm"]') };
    });
    ok(Object.values(dialogSizes).every((value) => value >= 44),
      `${label}: dialog input and actions >=44px (${JSON.stringify(dialogSizes)})`);
    for (let i = 0; i < 6; i += 1) {
      await p.keyboard.press("Tab");
      const inside = await p.evaluate(() => {
        const dialog = document.querySelector(".files-dialog");
        return Boolean(dialog && dialog.contains(document.activeElement));
      });
      ok(inside, `${label}: Tab ${i + 1} stays inside the dialog`);
    }
    await p.keyboard.press("Escape");
    ok((await p.locator(".files-dialog").count()) === 0 &&
       (await p.evaluate(() => document.activeElement?.dataset?.act)) === "new-folder",
      `${label}: Escape closes and restores focus to the New folder button`);
    await context.close();
  }

  log("Minesweeper touch cells, buttons, board and tap flag mode");
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const p = await context.newPage();
    watch(p);
    await openHarness(p);
    await p.evaluate(() => window.__mountMines());
    const label = `${viewport.width}x${viewport.height}`;
    const metrics = await p.evaluate(() => {
      const cells = [...document.querySelectorAll(".ms-cell")].map((n) => n.getBoundingClientRect());
      const buttons = [...document.querySelectorAll(".ms-button")].map((n) => n.getBoundingClientRect());
      const wrap = document.querySelector(".ms-board-wrap");
      const board = document.querySelector(".ms-board");
      return {
        cells: cells.length, minCell: Math.min(...cells.map((r) => r.width)),
        minButton: Math.min(...buttons.map((r) => r.height)),
        wrapHeight: wrap.clientHeight, boardHeight: Math.round(board.getBoundingClientRect().height),
        scrollWidth: wrap.scrollWidth, clientWidth: wrap.clientWidth,
      };
    });
    ok(metrics.cells === 81 && metrics.minCell >= 44 && metrics.minButton >= 44,
      `${label}: 81 cells and both buttons >=44px (${JSON.stringify(metrics)})`);
    ok(metrics.boardHeight >= 400 && metrics.wrapHeight >= 400,
      `${label}: full board is laid out, not a short scroll strip (${JSON.stringify(metrics)})`);

    await p.locator(".ms-mode").tap();
    await p.locator('.ms-cell[data-index="40"]').tap();
    ok((await p.locator('.ms-cell[data-index="40"]').getAttribute("aria-pressed")) === "true",
      `${label}: plain tap in flag mode still places a flag`);
    await p.locator('.ms-cell[data-index="40"]').focus();
    await p.keyboard.press("ArrowRight");
    ok((await p.evaluate(() => document.activeElement?.dataset?.index)) === "41",
      `${label}: arrow focus still moves one cell right`);
    await context.close();
  }

  log("error hygiene");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);
  log("ALL FILES/MINES REPAIR CHECKS PASSED");
} catch (error) {
  console.error(`FILES/MINES REPAIR CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((closeDone) => server.close(closeDone));
}
