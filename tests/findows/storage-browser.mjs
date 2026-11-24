/* Gate 2 decisive browser evidence for the storage contract. Dev-only; never shipped.
   Usage: node tests/findows/storage-browser.mjs [--browser=chromium|webkit|firefox] [--port=8835]
   Requires Node 20+ and a local Playwright package. Set FINDOWS_PLAYWRIGHT_MODULE
   when it lives outside this checkout. Exported runStorageBrowser() is reused by
   tests/findows/browser/storage-browser.mjs for the WebKit entry point. */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const moduleArg = arg("playwright", "");
if (moduleArg) process.env.FINDOWS_PLAYWRIGHT_MODULE = moduleArg;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const HARNESS_HTML = "<!doctype html><meta charset=\"utf-8\"><title>storage harness</title><body>storage harness</body>";

export async function runStorageBrowser({ browserName = "chromium", port = 8835 } = {}) {
  const PORT = Number(port);
  const playwright = loadPlaywright();
  const browserType = playwright[browserName];
  if (!browserType) throw new Error(`Unsupported browser ${browserName}; choose chromium, firefox, or webkit.`);

  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/__storage-harness.html") {
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
  console.log(`storage harness (${browserName}) serving ${ROOT} at ${BASE}`);

  let failures = 0;
  let total = 0;
  function report(label, checks) {
    for (const entry of checks || []) {
      total++;
      console.log(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.label}${entry.info ? ` — ${entry.info}` : ""}`);
      if (!entry.pass) failures++;
    }
  }

  async function scenario(browser, label, run) {
    console.log(`\n[${label}]`);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => console.log(`  pageerror: ${error.message}`));
      await page.goto(`${BASE}/__storage-harness.html`, { waitUntil: "load" });
      const checks = await run(page, context);
      report(label, checks);
      return checks;
    } finally {
      await context.close();
    }
  }

  const browser = await browserType.launch({ headless: true });
  try {
  /* 1. Two connections, revision conflicts, commit-only success, abort and quota failures. */
  await scenario(browser, "revision conflict, abort and quota", async (page) => {
    return page.evaluate(async () => {
      const mod = await import("/findows/js/storage.mjs");
      const checks = [];
      const check = (label, pass, info = "") => checks.push({ label, pass: Boolean(pass), info: String(info) });
      const attempt = async (promise) => {
        try {
          return { ok: true, value: await promise };
        } catch (error) {
          return { ok: false, code: error?.code || error?.name, message: error?.message };
        }
      };

      const storageA = mod.createStorage();
      const storageB = mod.createStorage();
      const [modeA, modeB] = await Promise.all([storageA.ready(), storageB.ready()]);
      check("two independent connections open persistently", modeA === "persistent" && modeB === "persistent", `${modeA}/${modeB}`);

      const schema = await new Promise((resolve, reject) => {
        const request = indexedDB.open("findows");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const info = { version: db.version, stores: [...db.objectStoreNames] };
          db.close();
          resolve(info);
        };
      });
      check(
        "database is findows version 1 with entries, drafts, settings and stickyNotes",
        schema.version === 1 && schema.stores.join(",") === "drafts,entries,settings,stickyNotes",
        JSON.stringify(schema),
      );

      const root = await storageA.read(mod.RESERVED.ROOT);
      const reservedFolders = await storageA.list(mod.RESERVED.ROOT);
      check("reserved roots are seeded", root.kind === "folder" && ["desktop", "documents", "pictures"].every((id) => reservedFolders.some((entry) => entry.id === id) || reservedFolders.some((entry) => entry.parentId === id)));

      const created = await storageA.create({
        parentId: mod.RESERVED.DOCUMENTS,
        name: "notes.txt",
        kind: "file",
        mediaType: "text/plain",
        text: "one",
        origin: "created",
      });
      check("create begins at revision 1", created.revision === 1 && created.text === "one" && created.parentId === "documents");

      const renamed = await storageA.rename(created.id, "A.txt", 1);
      check("rename commits at revision 2", renamed.revision === 2 && renamed.name === "A.txt");

      const staleMove = await attempt(storageB.move(created.id, mod.RESERVED.PICTURES, 1));
      check("B's stale move is REVISION_CONFLICT, not Saved", !staleMove.ok && staleMove.code === "REVISION_CONFLICT", staleMove.code);

      const afterStale = await storageA.read(created.id);
      check(
        "A's rename remains after B's rejected move",
        afterStale.name === "A.txt" && afterStale.parentId === "documents" && afterStale.revision === 2,
        `${afterStale.name}/${afterStale.parentId}/r${afterStale.revision}`,
      );

      const retried = await attempt(storageB.move(created.id, mod.RESERVED.PICTURES, 2));
      check(
        "retry with the current revision succeeds",
        retried.ok && retried.value.parentId === "pictures" && retried.value.revision === 3,
        retried.ok ? `r${retried.value.revision}` : retried.code,
      );

      const beforeAbort = await storageA.read(created.id);
      const proto = IDBObjectStore.prototype;
      const originalPut = proto.put;
      let armAbort = true;
      proto.put = function patchedPut(...args) {
        const request = originalPut.apply(this, args);
        if (armAbort && this.name === "entries") {
          armAbort = false;
          this.transaction.abort();
        }
        return request;
      };
      let abortResult;
      try {
        abortResult = await attempt(storageA.write(created.id, { text: "aborted write" }, beforeAbort.revision));
      } finally {
        proto.put = originalPut;
      }
      const afterAbort = await storageA.read(created.id);
      check("an aborted transaction rejects instead of reporting a save", !abortResult.ok, abortResult.code || "resolved!");
      check(
        "aborted transaction leaves content and revision intact",
        afterAbort.text === beforeAbort.text && afterAbort.revision === beforeAbort.revision,
        `${afterAbort.text}/r${afterAbort.revision}`,
      );

      const beforeQuota = await storageA.read(created.id);
      const originalPutAgain = proto.put;
      let armQuota = true;
      proto.put = function patchedQuota(...args) {
        if (armQuota && this.name === "entries") {
          armQuota = false;
          throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        }
        return originalPutAgain.apply(this, args);
      };
      let quotaResult;
      try {
        quotaResult = await attempt(storageA.write(created.id, { text: "quota write" }, beforeQuota.revision));
      } finally {
        proto.put = originalPutAgain;
      }
      const afterQuota = await storageA.read(created.id);
      check("a quota failure is typed QUOTA", !quotaResult.ok && quotaResult.code === "QUOTA", quotaResult.code || "resolved!");
      check(
        "quota failure keeps the current work intact and never advertises success",
        afterQuota.text === beforeQuota.text && afterQuota.revision === beforeQuota.revision && storageA.getStorageMode() === "persistent",
        `${afterQuota.text}/r${afterQuota.revision}/${storageA.getStorageMode()}`,
      );

      storageA.close();
      storageB.close();
      return checks;
    });
  });

  /* 2. Per-editor drafts, explicit save, stale draft safety and reload survival. */
  await scenario(browser, "drafts across reload", async (page, context) => {
    const first = await page.evaluate(async () => {
      const mod = await import("/findows/js/storage.mjs");
      const checks = [];
      const check = (label, pass, info = "") => checks.push({ label, pass: Boolean(pass), info: String(info) });
      const attempt = async (promise) => {
        try {
          return { ok: true, value: await promise };
        } catch (error) {
          return { ok: false, code: error?.code || error?.name };
        }
      };

      const storage = mod.createStorage();
      await storage.ready();
      const file = await storage.create({
        parentId: mod.RESERVED.DOCUMENTS,
        name: "note.txt",
        kind: "file",
        mediaType: "text/plain",
        text: "v1",
      });
      await storage.putDraft({
        draftId: "notepad-tab-a",
        appId: "notepad",
        fileId: file.id,
        baseRevision: 1,
        payload: { text: "draft A" },
        updatedAt: 1_000,
      });
      await storage.putDraft({
        draftId: "notepad-tab-b",
        appId: "notepad",
        fileId: file.id,
        baseRevision: 1,
        payload: { text: "draft B" },
        updatedAt: 2_000,
      });
      const drafts = await storage.listDrafts();
      check(
        "simultaneous dirty editors keep separate drafts",
        drafts.length === 2 && new Set(drafts.map((draft) => draft.draftId)).size === 2 && drafts[0].draftId === "notepad-tab-b",
        drafts.map((draft) => draft.draftId).join(","),
      );

      const untouched = await storage.read(file.id);
      check("a draft never changes the saved file", untouched.text === "v1" && untouched.revision === 1);

      const committed = await storage.write(file.id, { text: "draft A" }, 1, { draftId: "notepad-tab-a" });
      const remaining = await storage.listDrafts();
      check(
        "explicit Save commits and deletes only its own draft",
        committed.revision === 2 && remaining.length === 1 && remaining[0].draftId === "notepad-tab-b",
        `r${committed.revision}/${remaining.map((draft) => draft.draftId).join(",")}`,
      );

      const stale = await attempt(storage.write(file.id, { text: "stale draft" }, 1, { draftId: "notepad-tab-b" }));
      const current = await storage.read(file.id);
      const keptDraft = await storage.readDraft("notepad-tab-b");
      check(
        "an older draft cannot replace newer committed content",
        !stale.ok && stale.code === "REVISION_CONFLICT" && current.text === "draft A" && keptDraft?.payload?.text === "draft B",
        `${stale.code}/${current.text}`,
      );

      const untitled = await storage.putDraft({
        draftId: "notepad-untitled",
        appId: "notepad",
        fileId: null,
        baseRevision: null,
        payload: { text: "untitled draft" },
        updatedAt: 3_000,
      });
      check("untitled drafts store without a saved-file reference", untitled.fileId === null && untitled.baseRevision === null);
      storage.close();
      return { checks, fileId: file.id, revision: committed.revision };
    });

    const second = await context.newPage();
    await second.goto(`${BASE}/__storage-harness.html`, { waitUntil: "load" });
    const reloaded = await second.evaluate(async ({ fileId, revision }) => {
      const mod = await import("/findows/js/storage.mjs");
      const checks = [];
      const check = (label, pass, info = "") => checks.push({ label, pass: Boolean(pass), info: String(info) });
      const storage = mod.createStorage();
      const mode = await storage.ready();
      const drafts = await storage.listDrafts();
      const file = await storage.read(fileId);
      const ids = drafts.map((draft) => draft.draftId);
      check(
        "an untitled draft and the unreviewed saved-file draft survive reload",
        mode === "persistent" && drafts.length === 2 && ids.includes("notepad-tab-b") && ids.includes("notepad-untitled"),
        ids.join(","),
      );
      check("the committed note survives reload", file.text === "draft A" && file.revision === revision, `${file.text}/r${file.revision}`);
      await storage.deleteDraft("notepad-tab-b");
      check(
        "a reviewed draft can be discarded explicitly without touching the untitled draft",
        (await storage.listDrafts()).map((draft) => draft.draftId).join(",") === "notepad-untitled",
      );
      storage.close();
      return checks;
    }, { fileId: first.fileId, revision: first.revision });
    await second.close();
    return first.checks.concat(reloaded);
  });

  /* 3. Subtree trash, restore collisions, cycles, purge and reserved roots. */
  await scenario(browser, "trash, restore, purge", async (page) => {
    return page.evaluate(async () => {
      const mod = await import("/findows/js/storage.mjs");
      const checks = [];
      const check = (label, pass, info = "") => checks.push({ label, pass: Boolean(pass), info: String(info) });
      const attempt = async (promise) => {
        try {
          return { ok: true, value: await promise };
        } catch (error) {
          return { ok: false, code: error?.code || error?.name };
        }
      };
      const storage = mod.createStorage();
      await storage.ready();
      const docs = mod.RESERVED.DOCUMENTS;

      const project = await storage.create({ parentId: docs, name: "project", kind: "folder" });
      const sub = await storage.create({ parentId: project.id, name: "sub", kind: "folder" });
      const leaf = await storage.create({ parentId: sub.id, name: "leaf.txt", kind: "file", mediaType: "text/plain", text: "leaf" });
      const sibling = await storage.create({ parentId: docs, name: "sibling", kind: "folder" });

      const trashed = await storage.trash(project.id, project.revision);
      const normal = await storage.list(docs);
      check(
        "normal listing hides the entire trashed subtree",
        !normal.some((entry) => entry.id === project.id) && normal.some((entry) => entry.id === sibling.id) && !normal.some((entry) => entry.id === sub.id),
        normal.map((entry) => entry.name).join(","),
      );
      const hidden = await attempt(storage.list(sub.id));
      check("descendants of a trashed root are inaccessible", !hidden.ok && hidden.code === "MISSING", hidden.code);
      const trashList = await storage.listTrash();
      check("trash is a virtual list with only the trash root", trashList.length === 1 && trashList[0].id === project.id, trashList.map((entry) => entry.name).join(","));

      const duplicate = await storage.create({ parentId: docs, name: "PROJECT", kind: "folder" });
      check("a trashed name is free for a new item in the same folder", duplicate.revision === 1);

      const collision = await attempt(storage.restore(project.id, trashed.revision));
      const afterCollision = await storage.listTrash();
      const stillDuplicate = await storage.read(duplicate.id);
      check(
        "restore name collision changes nothing",
        !collision.ok && collision.code === "NAME_CONFLICT" && afterCollision.some((entry) => entry.id === project.id) && stillDuplicate.name === "PROJECT",
        collision.code,
      );

      const restored = await attempt(storage.restore(project.id, trashed.revision, { name: "project-2" }));
      const children = await storage.list(sub.id);
      check(
        "explicit renamed restore succeeds atomically into the original parent",
        restored.ok && restored.value.entry.parentId === docs && restored.value.destinationId === docs && restored.value.usedSafeParent === false && restored.value.entry.trashedAt === null,
        restored.ok ? restored.value.entry.name : restored.code,
      );
      check("the restored subtree is readable again", children.length === 1 && children[0].id === leaf.id);

      const cycle = await attempt(storage.move(project.id, sub.id, restored.value.entry.revision));
      check("moving a folder beneath itself is rejected", !cycle.ok && cycle.code === "CYCLE", cycle.code);

      const trashedAgain = await storage.trash(project.id, restored.value.entry.revision);
      const destination = await storage.create({ parentId: docs, name: "dest", kind: "folder" });
      const intoTrash = await attempt(storage.move(sibling.id, project.id, sibling.revision));
      check("moving into a trashed destination is rejected", !intoTrash.ok && intoTrash.code === "TRASHED", intoTrash.code);

      const notTrashed = await attempt(storage.purge(sibling.id, sibling.revision));
      check("purge is allowed only for trash roots", !notTrashed.ok && notTrashed.code === "NOT_TRASHED", notTrashed.code);

      const purged = await attempt(storage.purge(project.id, trashedAgain.revision));
      const purgedIds = purged.ok ? purged.value.purgedIds : [];
      const goneSub = await attempt(storage.read(sub.id));
      const goneLeaf = await attempt(storage.read(leaf.id));
      const keptSibling = await attempt(storage.read(sibling.id));
      const keptDestination = await attempt(storage.read(destination.id));
      check(
        "confirmed purge deletes the whole subtree atomically",
        purged.ok && [project.id, sub.id, leaf.id].every((id) => purgedIds.includes(id)),
        purgedIds.length,
      );
      check(
        "purged subtree ids are unreadable while siblings survive",
        goneSub.code === "MISSING" && goneLeaf.code === "MISSING" && keptSibling.ok && keptDestination.ok,
        `${goneSub.code}/${goneLeaf.code}`,
      );

      const reservedAttempts = [
        attempt(storage.rename(mod.RESERVED.ROOT, "renamed", 1)),
        attempt(storage.move(mod.RESERVED.DOCUMENTS, mod.RESERVED.PICTURES, 1)),
        attempt(storage.trash(mod.RESERVED.DESKTOP, 1)),
        attempt(storage.write(mod.RESERVED.DOCUMENTS, { text: "x" }, 1)),
        attempt(storage.purge(mod.RESERVED.PICTURES, 1)),
      ];
      const reservedResults = await Promise.all(reservedAttempts);
      check(
        "root and seed folders are immutable",
        reservedResults.every((result) => !result.ok && result.code === "RESERVED"),
        reservedResults.map((result) => result.code).join(","),
      );

      /* Defensive safe-parent fallback: remove the original parent behind the service's back. */
      const folder = await storage.create({ parentId: docs, name: "temporary-folder", kind: "folder" });
      const orphanCandidate = await storage.create({ parentId: folder.id, name: "orphan.txt", kind: "file", mediaType: "text/plain", text: "orphan" });
      const orphanTrashed = await storage.trash(orphanCandidate.id, orphanCandidate.revision);
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("findows");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("entries", "readwrite");
          tx.objectStore("entries").delete(folder.id);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
      const fallback = await attempt(storage.restore(orphanCandidate.id, orphanTrashed.revision));
      check(
        "restore without its original parent falls back to Documents and discloses it",
        fallback.ok && fallback.value.usedSafeParent === true && fallback.value.destinationId === "documents" && fallback.value.entry.parentId === "documents",
        fallback.ok ? `${fallback.value.destinationId}/${fallback.value.usedSafeParent}` : fallback.code,
      );

      storage.close();
      return checks;
    });
  });

  /* 4. Binary origin, exact original bytes, read-only imported images and associations. */
  await scenario(browser, "images: origin, bytes and association", async (page) => {
    return page.evaluate(async (browserName) => {
      const storageMod = await import("/findows/js/storage.mjs");
      const serviceMod = await import("/findows/js/file-service.mjs");
      const checks = [];
      const check = (label, pass, info = "") => checks.push({ label, pass: Boolean(pass), info: String(info) });
      const attempt = async (promise) => {
        try {
          return { ok: true, value: await promise };
        } catch (error) {
          return { ok: false, code: error?.code || error?.name };
        }
      };

      const storage = storageMod.createStorage();
      await storage.ready();
      const service = serviceMod.createFileService({ storage, photoViewer: true });
      const originalBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3, 250, 251, 252, 253]);
      const originalBlob = new Blob([originalBytes], { type: "image/png" });

      const imported = await service.createImage({
        parentId: storageMod.RESERVED.PICTURES,
        name: "photo.png",
        blob: originalBlob,
        mediaType: "image/png",
        image: { width: 640, height: 480 },
        origin: "import",
      });
      const readBack = await service.read(imported.id);
      const readBytes = new Uint8Array(await readBack.blob.arrayBuffer());
      check(
        "imported bytes round-trip exactly and keep explicit origin plus dimensions",
        readBytes.length === originalBytes.length &&
          readBytes.every((byte, index) => byte === originalBytes[index]) &&
          readBack.size === originalBytes.length &&
          readBack.origin === "import" &&
          readBack.image?.width === 640 &&
          readBack.image?.height === 480,
        `${readBack.origin}/${readBack.size}/r${readBack.revision}`,
      );
      check(
        "imported images resolve to the read-only viewer when enabled",
        JSON.stringify(service.getAppForFile(readBack)) === JSON.stringify({ appId: "photo-viewer", mode: "view" }),
        JSON.stringify(service.getAppForFile(readBack)),
      );

      const overwrite = await attempt(storage.write(imported.id, { blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) }, imported.revision));
      const stillOriginal = new Uint8Array(await (await service.read(imported.id)).blob.arrayBuffer());
      check(
        "an imported original cannot be overwritten in place",
        !overwrite.ok && overwrite.code === "READ_ONLY" && stillOriginal.length === originalBytes.length && stillOriginal[13] === originalBytes[13],
        overwrite.code,
      );

      const painted = await service.createImage({
        parentId: storageMod.RESERVED.PICTURES,
        name: "drawing.png",
        blob: originalBlob,
        mediaType: "image/png",
        image: { width: 1024, height: 768 },
        origin: "paint",
      });
      check(
        "Paint output keeps explicit editable origin metadata",
        painted.origin === "paint" && painted.mediaType === "image/png" && serviceMod.isSupportedMediaType(painted.mediaType),
        `${painted.origin}/${painted.mediaType}`,
      );
      const resaved = await storage.write(painted.id, { blob: new Blob([originalBytes], { type: "image/png" }), image: { width: 512, height: 256 } }, painted.revision);
      check(
        "writing Paint output bumps metadata and content together",
        resaved.revision === painted.revision + 1 && resaved.image.width === 512 && resaved.updatedAt >= painted.updatedAt,
        `r${resaved.revision}`,
      );

      if (browserName === "chromium") {
        /* Earlier Chromium runs stored a real Blob. Reading those records must
           still return a real Blob without a schema upgrade or migration. */
        const legacyId = "legacy-blob-entry";
        await new Promise((resolve, reject) => {
          const request = indexedDB.open("findows");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("entries", "readwrite");
            tx.objectStore("entries").put({
              id: legacyId,
              parentId: storageMod.RESERVED.PICTURES,
              name: "legacy.png",
              kind: "file",
              mediaType: "image/png",
              blob: new Blob([originalBytes], { type: "image/png" }),
              size: originalBytes.length,
              createdAt: 1,
              updatedAt: 1,
              revision: 1,
              trashedAt: null,
              origin: "created",
            });
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
          };
        });
        const legacy = await storage.read(legacyId);
        const legacyBytes = new Uint8Array(await legacy.blob.arrayBuffer());
        check(
          "records written by earlier Chromium runs still decode as real Blobs",
          legacy.blob instanceof Blob && legacy.revision === 1 && legacyBytes.length === originalBytes.length && legacyBytes.every((byte, index) => byte === originalBytes[index]),
          `${legacy.blob?.type || typeof legacy.blob}/${legacyBytes.length}`,
        );
      }

      storage.close();
      return checks;
    }, browserName);
  });

  /* 5. Blocked IndexedDB: explicit temporary mode and untouched ordinary site data. */
  console.log("\n[blocked storage and temporary mode]");
  {
    const context = await browser.newContext();
    const warm = await context.newPage();
    await warm.goto(`${BASE}/__storage-harness.html`, { waitUntil: "load" });
    await warm.evaluate(async () => {
      localStorage.setItem("other-app", "keep-me");
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("other-app", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("kv");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put("keep-me", "k");
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    });

    await context.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", { configurable: true, get: () => undefined });
    });
    const blocked = await context.newPage();
    blocked.on("pageerror", (error) => console.log(`  pageerror: ${error.message}`));
    await blocked.goto(`${BASE}/__storage-harness.html`, { waitUntil: "load" });
    const blockedChecks = await blocked.evaluate(async () => {
      const mod = await import("/findows/js/storage.mjs");
      const checks = [];
      const check = (label, pass, info = "") => checks.push({ label, pass: Boolean(pass), info: String(info) });
      const attempt = async (promise) => {
        try {
          return { ok: true, value: await promise };
        } catch (error) {
          return { ok: false, code: error?.code || error?.name, message: error?.message };
        }
      };
      const storage = mod.createStorage();
      const mode = await storage.ready();
      const listed = await attempt(storage.list(mod.RESERVED.ROOT));
      const created = await attempt(storage.create({ parentId: mod.RESERVED.DOCUMENTS, name: "blocked.txt", kind: "file", mediaType: "text/plain", text: "x" }));
      check("blocked IndexedDB yields explicit temporary mode", mode === "temporary" && storage.getStorageMode() === "temporary", mode);
      check(
        "persistent mutators and reads reject UNAVAILABLE in temporary mode",
        listed.code === "UNAVAILABLE" && created.code === "UNAVAILABLE",
        `${listed.code}/${created.code}`,
      );
      check("temporary mode never silently reports progress", storage.getStorageMode() === "temporary");
      return checks;
    });
    report("blocked storage", blockedChecks);

    const intact = await warm.evaluate(async () => {
      const value = await new Promise((resolve, reject) => {
        const request = indexedDB.open("other-app", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("kv", "readonly");
          const read = tx.objectStore("kv").get("k");
          read.onsuccess = () => { db.close(); resolve(read.result); };
          read.onerror = () => reject(read.error);
        };
      });
      return { idb: value, local: localStorage.getItem("other-app") };
    });
    const untouched = { label: "ordinary browser/site data is untouched", pass: intact.idb === "keep-me" && intact.local === "keep-me", info: JSON.stringify(intact) };
    report("blocked storage", [untouched]);
    await context.close();
  }

  console.log(`\n${failures === 0 ? `ALL STORAGE BROWSER CHECKS PASSED (${total}/${total}, ${browserName})` : `${failures} of ${total} STORAGE BROWSER CHECK(S) FAILED (${browserName})`}`);
  return { failures, total, browserName };
} catch (error) {
  console.error(`STORAGE BROWSER CHECK CRASHED: ${error?.stack || error}`);
  return { failures: failures + 1, total, browserName };
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const result = await runStorageBrowser({
    browserName: arg("browser", "chromium"),
    port: Number(arg("port", "8835")),
  });
  process.exitCode = result.failures ? 1 : 0;
}
