/* Focused real-browser evidence for the Files UI. Dev-only; never shipped.
   Usage: node tests/findows/files-ui-browser.mjs [--port=8799] [--playwright=...]
   Serves this repo on 127.0.0.1:8799 with injectable services and asserts
   accessibility, storage failures, trash/restore, open associations and exports.
   Requires Node 20+ and an installed Playwright/Chromium. */
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8799"));
const SHOTS = arg("shots", "");
const playwrightModule = arg("playwright", "") || process.env.PLAYWRIGHT_MODULE;
if (playwrightModule) process.env.FINDOWS_PLAYWRIGHT_MODULE = playwrightModule;

const { chromium } = loadPlaywright();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const HARNESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Files UI harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/files.css">
<style>html,body{margin:0;height:100%;overflow:hidden}#fw-desktop{height:100vh;width:100vw}#app{height:100%}</style>
</head><body><div id="fw-desktop" data-theme="dark"><div id="app"></div></div></body></html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__files-harness.html") {
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

await new Promise((resolveReady, rejectReady) => {
  server.once("error", rejectReady);
  server.listen(PORT, "127.0.0.1", resolveReady);
});
const BASE = `http://127.0.0.1:${PORT}`;
console.log(`files-ui harness serving ${ROOT} at ${BASE}`);

let failures = 0;
function report(label, checks) {
  for (const entry of checks || []) {
    console.log(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.label}${entry.info ? ` — ${entry.info}` : ""}`);
    if (!entry.pass) failures++;
  }
}
const check = (checks, label, pass, info = "") => checks.push({ label, pass: Boolean(pass), info: String(info) });

async function scenario(browser, label, run) {
  console.log(`\n[${label}]`);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`  pageerror: ${error.message}`));
    await page.goto(`${BASE}/__files-harness.html`, { waitUntil: "load" });
    const checks = await run(page, context);
    report(label, checks);
    return checks;
  } catch (error) {
    report(label, [{ label: "scenario completed", pass: false, info: error?.stack || String(error) }]);
    return [];
  } finally {
    await context.close();
  }
}

/** Install a deterministic, injectable file service and mount the real Files module. */
async function mountFake(page, config = {}) {
  await page.evaluate(async (config) => {
    const { mount } = await import("/findows/js/apps/files.mjs");
    const { StorageError } = await import("/findows/js/storage.mjs");
    const at = 1700000000000;
    const E = (id, parentId, name, kind, extra = {}) => ({
      id, parentId, name, kind,
      mediaType: kind === "folder" ? null : extra.mediaType || "text/plain",
      size: extra.size ?? 0,
      createdAt: at, updatedAt: at, revision: extra.revision ?? 1,
      trashedAt: null, origin: extra.origin ?? null, ...extra,
    });
    const entries = new Map();
    const seeds = [
      E("root", null, "Findows", "folder"),
      E("desktop", "root", "Desktop", "folder"),
      E("documents", "root", "Documents", "folder"),
      E("pictures", "root", "Pictures", "folder"),
      E("empty", "documents", "Empty", "folder"),
      E("txt-1", "documents", "My note: v1.txt", "file", { mediaType: "text/plain", text: "hello", size: 5 }),
      E("img-1", "documents", "photo.png", "file", {
        mediaType: "image/png", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
        size: 3, origin: "import", image: { width: 2, height: 2 },
      }),
      E("pdf-1", "documents", "manual.pdf", "file", {
        mediaType: "application/pdf", blob: new Blob([new Uint8Array([4])], { type: "application/pdf" }), size: 1,
      }),
    ];
    for (const entry of seeds) entries.set(entry.id, entry);

    const flags = Object.assign({ blocked: false, restoreConflictOnce: false, restoreSafeParent: false, renameFail: false }, config.flags || {});
    const calls = { openApp: [], create: [], rename: [], move: [], trash: [], restore: [], purge: [], retry: 0, downloads: [], downloadName: null };
    const fail = (code, message) => { throw new StorageError(code, message); };
    const copy = (entry) => ({ ...entry });
    const siblings = (parentId) => [...entries.values()].filter((entry) => entry.parentId === parentId && entry.trashedAt == null);

    const files = {
      getStorageMode: () => (flags.blocked ? "temporary" : "persistent"),
      getModeReason: () => (flags.blocked ? "UNAVAILABLE:absent" : null),
      ready: async () => (flags.blocked ? "temporary" : "persistent"),
      retry: async () => {
        calls.retry++;
        if (config.retryRecovers) flags.blocked = false;
        return flags.blocked ? "temporary" : "persistent";
      },
      list: async (parentId) => {
        if (flags.blocked) fail("UNAVAILABLE", "Not saved — browser storage is unavailable. Download a copy.");
        const parent = entries.get(parentId);
        if (!parent) fail("MISSING", "That folder no longer exists.");
        return siblings(parentId).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1)).map(copy);
      },
      listTrash: async () => {
        if (flags.blocked) fail("UNAVAILABLE", "Not saved — browser storage is unavailable. Download a copy.");
        return [...entries.values()].filter((entry) => entry.trashedAt != null).map(copy);
      },
      read: async (id) => {
        if (flags.blocked) fail("UNAVAILABLE", "Not saved — browser storage is unavailable. Download a copy.");
        const entry = entries.get(id);
        if (!entry) fail("MISSING", "That file or folder no longer exists.");
        return copy(entry);
      },
      create: async (input) => {
        calls.create.push({ ...input });
        if (siblings(input.parentId).some((entry) => entry.name.toLowerCase() === input.name.trim().toLowerCase())) {
          fail("NAME_CONFLICT", `“${input.name}” already exists in this folder.`);
        }
        const entry = E(`made-${calls.create.length}`, input.parentId, input.name.trim(), "folder");
        entries.set(entry.id, entry);
        return copy(entry);
      },
      rename: async (id, name, expectedRevision) => {
        calls.rename.push({ id, name, expectedRevision });
        if (flags.renameFail) fail("QUOTA", "Browser storage is full. Nothing was saved; download a copy.");
        const entry = entries.get(id);
        if (!entry) fail("MISSING", "That item no longer exists.");
        if (siblings(entry.parentId).some((e) => e.id !== id && e.name.toLowerCase() === name.trim().toLowerCase())) {
          fail("NAME_CONFLICT", `“${name}” already exists in this folder.`);
        }
        entry.name = name.trim();
        entry.revision = expectedRevision + 1;
        return copy(entry);
      },
      move: async (id, parentId, expectedRevision) => {
        calls.move.push({ id, parentId, expectedRevision });
        const entry = entries.get(id);
        if (!entry) fail("MISSING", "That item no longer exists.");
        if (siblings(parentId).some((e) => e.id !== id && e.name.toLowerCase() === entry.name.toLowerCase())) {
          fail("NAME_CONFLICT", `“${entry.name}” already exists in that folder.`);
        }
        entry.parentId = parentId;
        entry.revision = expectedRevision + 1;
        return copy(entry);
      },
      trash: async (id, expectedRevision) => {
        calls.trash.push({ id, expectedRevision });
        const entry = entries.get(id);
        if (!entry) fail("MISSING", "That item no longer exists.");
        entry.trashedAt = at;
        entry.revision = expectedRevision + 1;
        return copy(entry);
      },
      restore: async (id, expectedRevision, options = {}) => {
        calls.restore.push({ id, expectedRevision, options });
        const entry = entries.get(id);
        if (!entry) fail("MISSING", "That item no longer exists.");
        if (flags.restoreConflictOnce && !flags.restoreConflictDone) {
          flags.restoreConflictDone = true;
          fail("NAME_CONFLICT", `“${entry.name}” already exists in the original folder. Choose another name.`);
        }
        const name = options.name === undefined ? entry.name : options.name;
        if (siblings(entry.parentId).some((e) => e.id !== id && e.name.toLowerCase() === name.trim().toLowerCase())) {
          fail("NAME_CONFLICT", `“${name}” already exists in the original folder. Choose another name.`);
        }
        entry.name = name.trim();
        entry.trashedAt = null;
        entry.revision = expectedRevision + 1;
        const destinationId = flags.restoreSafeParent ? "documents" : entry.parentId;
        if (flags.restoreSafeParent) entry.parentId = destinationId;
        return { entry: copy(entry), destinationId, usedSafeParent: Boolean(flags.restoreSafeParent) };
      },
      purge: async (id, expectedRevision) => {
        calls.purge.push({ id, expectedRevision });
        const entry = entries.get(id);
        if (!entry) fail("MISSING", "That item no longer exists.");
        entries.delete(id);
        return { purgedIds: [id] };
      },
      listDrafts: async () => [],
      getAppForFile: (entry) => {
        if (!entry || entry.trashedAt != null) return null;
        if (entry.kind === "folder") return { appId: "files", mode: "browse" };
        if (entry.mediaType === "text/plain") return { appId: "notepad", mode: "edit" };
        if (["image/png", "image/jpeg", "image/webp"].includes(entry.mediaType)) return { appId: "paint", mode: "edit" };
        return null;
      },
    };

    const realCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = realCreate(blob);
      calls.downloads.push({ type: blob.type, size: blob.size });
      return url;
    };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        calls.downloadName = this.download;
        return;
      }
      return realClick.call(this);
    };

    const services = { files, ...(config.noOpenApp ? {} : { openApp: (appId, options) => calls.openApp.push({ appId, options }) }) };
    const controller = new AbortController();
    window.__CALLS__ = calls;
    window.__FLAGS__ = flags;
    window.__SERVICES__ = services;
    const handle = await mount({
      container: document.getElementById("app"),
      windowId: "w-files",
      fileId: config.fileId ?? null,
      mode: config.mode ?? "browse",
      draftId: null,
      services,
      signal: controller.signal,
    });
    window.__HANDLE__ = handle;
    window.__ABORT__ = () => controller.abort();
  }, config);
}

const browser = await chromium.launch({ headless: true });
try {
  /* 1. Reserved places, breadcrumbs, real types/sizes and empty states. */
  await scenario(browser, "reserved folders, breadcrumbs, types and empty states", async (page) => {
    const checks = [];
    await mountFake(page);
    await page.locator(".files-row[data-id='desktop']").waitFor();
    check(checks, "Findows root lists only seeded reserved folders", (await page.locator(".files-row").count()) === 3, `${await page.locator(".files-row").count()} rows`);
    check(checks, "breadcrumbs start at the Findows root", (await page.locator("[data-role='crumbs']").innerText()).includes("Findows"));
    check(checks, "Places offers the real reserved folders and Recycle Bin", (await page.locator(".files-place").count()) === 4, `${await page.locator(".files-place").count()} places`);
    check(checks, "no device file input or ambient browsing control exists", (await page.locator("input[type='file']").count()) === 0);

    await page.locator(".files-place[data-place='documents']").click();
    await page.locator(".files-row[data-id='txt-1']").waitFor();
    check(checks, "breadcrumbs follow parent ids", (await page.locator("[data-role='crumbs']").innerText()).includes("Documents"));
    check(checks, "text file shows its real type and byte size", (await page.locator(".files-row[data-id='txt-1'] .files-type").innerText()) === "Text document" && (await page.locator(".files-row[data-id='txt-1'] .files-size").innerText()) === "5 bytes");
    check(checks, "image file shows its real type", (await page.locator(".files-row[data-id='img-1'] .files-type").innerText()) === "PNG image");
    check(checks, "unsupported type is labelled plainly", (await page.locator(".files-row[data-id='pdf-1'] .files-type").innerText()) === "File");

    await page.locator(".files-row[data-id='empty'] .files-name").click();
    await page.locator("[data-role='empty']:visible").waitFor();
    check(checks, "empty folder has an explicit empty state", (await page.locator("[data-role='empty']").innerText()).includes("empty"));
    check(checks, "no invented files appear in an empty folder", (await page.locator(".files-row").count()) === 0);
    return checks;
  });

  /* 2. New folder, rename, move, trash, restore retry, safe destination, purge. */
  await scenario(browser, "mutations, recycle bin and explicit confirmation", async (page) => {
    const checks = [];
    await mountFake(page, { flags: { restoreConflictOnce: true, renameFail: false } });
    await page.locator(".files-place[data-place='documents']").click();
    await page.locator(".files-row[data-id='txt-1']").waitFor();

    await page.locator(".files-toolbar [data-act='new-folder']").click();
    await page.locator(".files-dialog input[type='text']").fill("Project");
    await page.locator(".files-dialog [data-act='confirm']").click();
    await page.locator(".files-row[data-id='made-1']").waitFor();
    check(checks, "new folder is created in the current folder", (await page.evaluate(() => window.__CALLS__.create[0].parentId)) === "documents");

    await page.locator(".files-row[data-id='made-1'] [data-act='rename']").click();
    await page.locator(".files-dialog input[type='text']").fill("Notes");
    await page.locator(".files-dialog [data-act='confirm']").click();
    await page.locator(".files-row[data-id='made-1'] .files-name", { hasText: "Notes" }).waitFor();
    check(checks, "rename passes the stable id and current revision", JSON.stringify(await page.evaluate(() => window.__CALLS__.rename[0])) === JSON.stringify({ id: "made-1", name: "Notes", expectedRevision: 1 }));

    await page.locator(".files-row[data-id='made-1'] [data-act='move']").click();
    await page.locator(".files-dialog select").selectOption("pictures");
    await page.locator(".files-dialog [data-act='confirm']").click();
    await page.locator(".files-row[data-id='made-1']").waitFor({ state: "detached" });
    check(checks, "move keeps the same stable id", (await page.evaluate(() => window.__CALLS__.move[0].id)) === "made-1");
    await page.locator(".files-place[data-place='pictures']").click();
    await page.locator(".files-row[data-id='made-1']").waitFor();

    await page.locator(".files-row[data-id='made-1'] [data-act='trash']").click();
    await page.locator(".files-dialog [data-act='confirm']").click();
    await page.locator(".files-row[data-id='made-1']").waitFor({ state: "detached" });
    await page.locator(".files-toolbar [data-act='trash']").click();
    await page.locator(".files-row[data-id='made-1']").waitFor();
    check(checks, "trashed item appears in the Recycle Bin", (await page.locator(".files-row[data-id='made-1'] .files-name").innerText()) === "Notes");

    await page.locator(".files-row[data-id='made-1'] [data-act='restore']").click();
    await page.locator(".files-error:visible").waitFor();
    check(checks, "restore name conflict is a visible typed error", (await page.locator(".files-error").innerText()).includes("NAME_CONFLICT"));
    await page.locator(".files-dialog input[type='text']").fill("Notes (restored)");
    await page.locator(".files-dialog [data-act='confirm']").click();
    await page.locator(".files-dialog").waitFor({ state: "detached" });
    check(checks, "rename retry calls restore with an explicit unused name", (await page.evaluate(() => window.__CALLS__.restore[1].options.name)) === "Notes (restored)");

    await page.evaluate(() => { window.__FLAGS__.restoreConflictOnce = false; window.__FLAGS__.restoreSafeParent = true; });
    await page.locator(".files-place[data-place='documents']").click();
    await page.locator(".files-row[data-id='txt-1'] [data-act='trash']").click();
    await page.locator(".files-dialog [data-act='confirm']").click();
    await page.locator(".files-row[data-id='txt-1']").waitFor({ state: "detached" });
    await page.locator(".files-toolbar [data-act='trash']").click();
    await page.locator(".files-row[data-id='txt-1'] [data-act='restore']").click();
    await page.locator(".files-dialog").waitFor({ state: "detached" });
    const status = await page.locator(".files-status").innerText();
    check(checks, "safe destination is disclosed after restore", status.includes("Documents") && status.toLowerCase().includes("no longer"), status);

    await page.locator(".files-place[data-place='documents']").click();
    await page.locator(".files-row[data-id='txt-1'] [data-act='trash']").click();
    await page.locator(".files-dialog [data-act='confirm']").click();
    await page.locator(".files-toolbar [data-act='trash']").click();
    const before = await page.evaluate(() => window.__CALLS__.purge.length);
    await page.locator(".files-row[data-id='txt-1'] [data-act='purge']").click();
    await page.locator(".files-dialog input[type='checkbox']").waitFor();
    check(checks, "purge is not called before explicit confirmation", (await page.evaluate(() => window.__CALLS__.purge.length)) === before);
    await page.locator(".files-dialog input[type='checkbox']").check();
    await page.locator(".files-dialog [data-act='confirm']").click();
    check(checks, "confirmed purge acts on the trash root's stable id", (await page.evaluate(() => window.__CALLS__.purge[0].id)) === "txt-1");

    await page.evaluate(() => { window.__FLAGS__.renameFail = true; });
    await page.locator(".files-place[data-place='pictures']").click();
    await page.locator(".files-row[data-id='made-1'] [data-act='rename']").click();
    await page.locator(".files-dialog input[type='text']").fill("Will fail");
    await page.locator(".files-dialog [data-act='confirm']").click();
    await page.locator(".files-dialog [data-role='dialog-error']:visible").waitFor();
    check(checks, "quota failure is visible and does not announce success", (await page.locator(".files-dialog [data-role='dialog-error']").innerText()).includes("QUOTA"));
    return checks;
  });

  /* 3. Real associations, stable file ids, safe downloads and missing actions. */
  await scenario(browser, "open associations, stable ids and safe downloads", async (page) => {
    const checks = [];
    await mountFake(page);
    await page.locator(".files-place[data-place='documents']").click();
    await page.locator(".files-row[data-id='txt-1'] [data-act='open']").click();
    check(checks, "text file opens through its real association and stable id", JSON.stringify(await page.evaluate(() => window.__CALLS__.openApp[0])) === JSON.stringify({ appId: "notepad", options: { fileId: "txt-1", mode: "edit", draftId: null, source: "files" } }), JSON.stringify(await page.evaluate(() => window.__CALLS__.openApp[0])));

    await page.locator(".files-row[data-id='img-1'] [data-act='open']").click();
    check(checks, "image file opens through the image association", JSON.stringify(await page.evaluate(() => window.__CALLS__.openApp[1].options)) === JSON.stringify({ fileId: "img-1", mode: "edit", draftId: null, source: "files" }));

    await page.locator(".files-row[data-id='txt-1'] [data-act='download']").click();
    const txtDownload = await page.evaluate(() => ({ name: window.__CALLS__.downloadName, last: window.__CALLS__.downloads.at(-1) }));
    check(checks, "text download uses a safe suggested filename and real blob", txtDownload.name === "My_note__v1.txt" && txtDownload.last.type === "text/plain" && txtDownload.last.size === 5, JSON.stringify(txtDownload));

    await page.locator(".files-row[data-id='img-1'] [data-act='download']").click();
    const imgDownload = await page.evaluate(() => ({ name: window.__CALLS__.downloadName, last: window.__CALLS__.downloads.at(-1) }));
    check(checks, "image download keeps the image type and extension", imgDownload.name === "photo.png" && imgDownload.last.type === "image/png" && imgDownload.last.size === 3, JSON.stringify(imgDownload));

    const before = await page.evaluate(() => window.__CALLS__.openApp.length);
    await page.locator(".files-row[data-id='pdf-1'] [data-act='open']").click();
    await page.locator(".files-error:visible").waitFor();
    check(checks, "unsupported type reports a missing association without inventing an app", (await page.evaluate(() => window.__CALLS__.openApp.length)) === before && (await page.locator(".files-error").innerText()).toLowerCase().includes("no app"));
    return checks;
  });

  /* 4. Missing open action and temporary storage are disclosed, not faked. */
  await scenario(browser, "temporary mode and missing action", async (page) => {
    const checks = [];
    await mountFake(page, { noOpenApp: true, flags: { blocked: true }, retryRecovers: true });
    await page.locator(".files-error:visible").waitFor();
    check(checks, "temporary mode banner is visible", (await page.locator(".files-mode").innerText()).toLowerCase().includes("temporary"));
    check(checks, "storage failure is a visible typed error", (await page.locator(".files-error").innerText()).includes("UNAVAILABLE"));
    check(checks, "temporary mode shows no pretend files", (await page.locator(".files-row").count()) === 0);
    await page.locator("[data-act='retry-storage']").click();
    await page.locator(".files-row[data-id='desktop']").waitFor();
    check(checks, "retry reloads real items once storage recovers", (await page.evaluate(() => window.__CALLS__.retry)) === 1);
    await page.locator(".files-place[data-place='documents']").click();
    await page.locator(".files-row[data-id='txt-1']").waitFor();
    await page.locator(".files-row[data-id='txt-1'] [data-act='open']").click();
    await page.locator(".files-error:visible").waitFor();
    check(checks, "missing openApp action is reported explicitly", (await page.locator(".files-error").innerText()).toLowerCase().includes("can't open") || (await page.locator(".files-error").innerText()).toLowerCase().includes("cannot open"));
    return checks;
  });

  /* 5. Real IndexedDB + file service: association and id come from storage, not fixtures. */
  await scenario(browser, "real file service integration", async (page) => {
    const checks = [];
    await page.evaluate(async () => {
      const { createStorage } = await import("/findows/js/storage.mjs");
      const { createFileService } = await import("/findows/js/file-service.mjs");
      const { mount } = await import("/findows/js/apps/files.mjs");
      const storage = createStorage();
      await storage.ready();
      const files = createFileService({ storage });
      const created = await files.createText({ parentId: "documents", name: "saved-note.txt", text: "persisted" });
      window.__REAL_ID__ = created.id;
      const calls = [];
      window.__CALLS__ = { openApp: calls };
      const handle = await mount({
        container: document.getElementById("app"),
        windowId: "w-real",
        fileId: null,
        mode: "browse",
        services: { files, openApp: (appId, options) => calls.push({ appId, options }) },
        signal: new AbortController().signal,
      });
      window.__HANDLE__ = handle;
    });
    await page.locator(".files-place[data-place='documents']").click();
    const realId = await page.evaluate(() => window.__REAL_ID__);
    await page.locator(`.files-row[data-id='${realId}'] [data-act='open']`).waitFor();
    await page.locator(`.files-row[data-id='${realId}'] [data-act='open']`).click();
    const openCall = await page.evaluate(() => window.__CALLS__.openApp[0]);
    check(checks, "real saved file ID is used for Open", openCall?.options?.fileId === realId, JSON.stringify(openCall));
    check(checks, "association comes from the real file service", openCall?.appId === "notepad" && openCall?.options?.mode === "edit", JSON.stringify(openCall));
    check(checks, "real text content size is displayed", (await page.locator(`.files-row[data-id='${realId}'] .files-size`).innerText()) === "9 bytes");
    return checks;
  });

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await scenario(browser, "visual capture", async (page) => {
      await page.setViewportSize({ width: 1180, height: 760 });
      await mountFake(page);
      await page.locator(".files-place[data-place='documents']").click();
      await page.locator(".files-row[data-id='txt-1']").click();
      await page.screenshot({ path: resolve(SHOTS, "files-desktop.png") });
      await page.setViewportSize({ width: 390, height: 720 });
      await page.screenshot({ path: resolve(SHOTS, "files-narrow.png") });
      return [{ label: "captured desktop and narrow screenshots", pass: true }];
    });
  }

  console.log(`\n${failures === 0 ? "ALL FILES UI BROWSER CHECKS PASSED" : `${failures} FILES UI BROWSER CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (error) {
  console.error(`FILES UI BROWSER CHECK CRASHED: ${error?.stack || error}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
