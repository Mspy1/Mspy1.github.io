/* Focused regression probe: origin-aware associations + WebKit legacy Blob
   metadata mutations. Dev-only; never shipped as runtime.
   Usage: node tests/findows/browser/storage-association-legacy.mjs
          [--browser=webkit] [--port=8900]
   Set FINDOWS_PLAYWRIGHT_MODULE to the local Playwright package. */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { browserType } from "./runtime.mjs";

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const BROWSER = arg("browser", "webkit");
const PORT = Number(arg("port", "8900"));
const ROOT = resolve(process.cwd());
const LEGACY_ID = "legacy-blob-entry";
const PNG = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 9, 8, 7, 6];

if (BROWSER !== "webkit") {
  console.error("This probe simulates a WebKit-hostile legacy Blob record; use --browser=webkit.");
  process.exit(2);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const PAGE = "<!doctype html><meta charset=\"utf-8\"><title>association/legacy probe</title><body>probe</body>";

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__assoc-legacy.html") {
      response.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
      response.end(PAGE);
      return;
    }
    const target = resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    response.writeHead(200, {
      "content-type": MIME[extname(target).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(readFileSync(target));
  } catch {
    response.writeHead(404).end("not found");
  }
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(PORT, "127.0.0.1", resolveListen);
});
console.log(`association/legacy probe serving ${ROOT} at http://127.0.0.1:${PORT}`);

/* WebKit cannot physically store a Blob. Simulate a profile imported from a
   browser that could: the underlying IDB record holds versioned bytes, while
   get() for this one id yields a real Blob. Metadata mutations that re-put
   that Blob unchanged must fail; normalizing it to bytes must succeed. */
function installLegacyGet({ legacyId, bytes }) {
  const originalGet = IDBObjectStore.prototype.get;
  window.__restoreLegacyGet = () => {
    IDBObjectStore.prototype.get = originalGet;
    delete window.__restoreLegacyGet;
  };
  IDBObjectStore.prototype.get = function patchedGet(key) {
    const real = originalGet.apply(this, arguments);
    if (this.name !== "entries" || key !== legacyId) return real;
    const view = {
      error: null,
      onsuccess: null,
      onerror: null,
      get result() {
        const record = real.result;
        if (!record) return undefined;
        if (record.blob && record.blob.__findowsBlobV1) {
          return {
            ...record,
            blob: new Blob([record.blob.bytes], { type: record.blob.type }),
          };
        }
        return record;
      },
    };
    real.onsuccess = () => {
      if (typeof view.onsuccess === "function") view.onsuccess({ target: view });
    };
    real.onerror = () => {
      view.error = real.error;
      if (typeof view.onerror === "function") view.onerror({ target: view });
    };
    return view;
  };
}

let browser;
try {
  browser = await browserType(BROWSER).launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(installLegacyGet, { legacyId: LEGACY_ID, bytes: PNG });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`  pageerror: ${error.message}`));
  await page.goto(`http://127.0.0.1:${PORT}/__assoc-legacy.html`, { waitUntil: "load" });

  const checks = await page.evaluate(async ({ legacyId, bytes }) => {
    const storageMod = await import("/findows/js/storage.mjs");
    const serviceMod = await import("/findows/js/file-service.mjs");
    const checks = [];
    const check = (label, pass, info = "") => checks.push({ label, pass: Boolean(pass), info: String(info) });
    const attempt = async (promise) => {
      try {
        return { ok: true, value: await promise };
      } catch (error) {
        return { ok: false, code: error?.code || error?.name, message: error?.message };
      }
    };
    const equal = (left, right) => left && right && left.length === right.length && left.every((value, index) => value === right[index]);
    const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
    const png = new Uint8Array(bytes);

    /* Bug 1: association table must use explicit origin metadata. */
    const image = (origin) => ({ kind: "file", mediaType: "image/png", origin });
    check(
      "imported original opens read-only when Photo Viewer is enabled",
      JSON.stringify(serviceMod.associationFor(image("import"), { photoViewer: true })) === JSON.stringify({ appId: "photo-viewer", mode: "view" }),
      JSON.stringify(serviceMod.associationFor(image("import"), { photoViewer: true })),
    );
    check(
      "Paint-created PNG stays editable when Photo Viewer is enabled",
      JSON.stringify(serviceMod.associationFor(image("paint"), { photoViewer: true })) === JSON.stringify({ appId: "paint", mode: "edit" }),
      JSON.stringify(serviceMod.associationFor(image("paint"), { photoViewer: true })),
    );
    check(
      "created PNG stays editable when Photo Viewer is enabled",
      JSON.stringify(serviceMod.associationFor(image("created"), { photoViewer: true })) === JSON.stringify({ appId: "paint", mode: "edit" }),
      JSON.stringify(serviceMod.associationFor(image("created"), { photoViewer: true })),
    );

    /* Bug 2: legacy real-Blob value must be encoded before any re-put. */
    const storage = storageMod.createStorage();
    const mode = await storage.ready();
    check("storage opens persistently in WebKit", mode === "persistent", mode);
    if (mode !== "persistent") return checks;

    await new Promise((resolvePut, rejectPut) => {
      const request = indexedDB.open("findows");
      request.onerror = () => rejectPut(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("entries", "readwrite");
        tx.objectStore("entries").put({
          id: legacyId,
          parentId: storageMod.RESERVED.DOCUMENTS,
          name: "legacy.png",
          kind: "file",
          mediaType: "image/png",
          blob: { __findowsBlobV1: true, type: "image/png", size: png.length, bytes: png },
          size: png.length,
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
          trashedAt: null,
          origin: "paint",
          image: { width: 2, height: 2 },
        });
        tx.oncomplete = () => { db.close(); resolvePut(); };
        tx.onerror = () => rejectPut(tx.error);
      };
    });

    const legacy = await storage.read(legacyId);
    check(
      "legacy record reads as a real Blob with exact bytes",
      legacy.blob instanceof Blob && equal(await bytesOf(legacy.blob), png) && legacy.revision === 1,
      `${legacy.blob?.type || typeof legacy.blob}/r${legacy.revision}`,
    );

    const renamed = await attempt(storage.rename(legacyId, "legacy-renamed.png", 1));
    check("legacy Blob survives rename in WebKit", renamed.ok, renamed.ok ? `r${renamed.value.revision}` : `${renamed.code}: ${renamed.message}`);
    if (!renamed.ok) return checks;

    const moved = await attempt(storage.move(legacyId, storageMod.RESERVED.DESKTOP, renamed.value.revision));
    check("legacy Blob survives move in WebKit", moved.ok, moved.ok ? `r${moved.value.revision}` : `${moved.code}: ${moved.message}`);
    if (!moved.ok) return checks;

    const trashed = await attempt(storage.trash(legacyId, moved.value.revision));
    check("legacy Blob survives trash in WebKit", trashed.ok, trashed.ok ? `r${trashed.value.revision}` : `${trashed.code}: ${trashed.message}`);
    if (!trashed.ok) return checks;

    window.__restoreLegacyGet();
    const trashList = await storage.listTrash();
    const restored = trashList.find((entry) => entry.id === legacyId);
    check(
      "after normalization the stored record is cloneable and content is intact",
      restored?.blob instanceof Blob &&
        equal(await bytesOf(restored.blob), png) &&
        restored.name === "legacy-renamed.png" &&
        restored.parentId === storageMod.RESERVED.DESKTOP &&
        restored.revision === 4,
      restored ? `${restored.name}/${restored.parentId}/r${restored.revision}` : "not in trash list",
    );

    storage.close();
    return checks;
  }, { legacyId: LEGACY_ID, bytes: PNG });

  let failures = 0;
  for (const entry of checks) {
    console.log(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.label}${entry.info ? ` — ${entry.info}` : ""}`);
    if (!entry.pass) failures++;
  }
  console.log(`\n${failures === 0 ? "ASSOCIATION + LEGACY BLOB PROBE PASSED" : `${failures} PROBE CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
  await context.close();
} catch (error) {
  console.error(`ASSOCIATION + LEGACY BLOB PROBE CRASHED: ${error?.stack || error}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
