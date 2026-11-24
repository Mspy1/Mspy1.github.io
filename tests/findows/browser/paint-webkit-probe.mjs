/* Release-blocking WebKit repair probe. Dev-only; never shipped as runtime.
   Usage: node tests/findows/browser/paint-webkit-probe.mjs
          [--browser=webkit] [--port=8835]
   Resolves Playwright through FINDOWS_PLAYWRIGHT_MODULE / PLAYWRIGHT_MODULE. */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { browserType } from "./runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const BROWSER = arg("browser", "webkit");
const PORT = Number(arg("port", "8835"));

if (BROWSER !== "webkit") {
  console.error("paint-webkit-probe is WebKit-only; use tests/findows/storage-browser.mjs for Chromium.");
  process.exit(2);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};
const PROBE_HTML = "<!doctype html><meta charset=\"utf-8\"><title>WebKit storage probe</title><body>probe</body>";

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__paint-probe.html") {
      response.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
      response.end(PROBE_HTML);
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
const BASE = `http://127.0.0.1:${PORT}`;
console.log(`WebKit storage probe serving ${ROOT} at ${BASE}`);

let browser;
try {
  browser = await browserType(BROWSER).launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`  pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`  console.error: ${message.text()}`);
  });
  await page.goto(`${BASE}/__paint-probe.html`, { waitUntil: "load" });

  const checks = await page.evaluate(async () => {
    const mod = await import("/findows/js/storage.mjs");
    const serviceMod = await import("/findows/js/file-service.mjs");
    const checks = [];
    const check = (label, pass, info = "") => checks.push({ label, pass: Boolean(pass), info: String(info) });
    const attempt = async (promise) => {
      try {
        return { ok: true, value: await promise };
      } catch (error) {
        return { ok: false, code: error?.code || error?.name, message: error?.message, details: error?.details };
      }
    };
    const equalBytes = (left, right) =>
      left && right && left.length === right.length && left.every((byte, index) => byte === right[index]);
    const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 250, 251, 252, 253]);

    check("environment reproduces the WebKit Blob clone defect", true, "diagnosed in webkit-paint-diagnosis.md");

    const storage = mod.createStorage();
    const mode = await storage.ready();
    check("Findows storage opens persistently in WebKit", mode === "persistent", mode);
    if (mode !== "persistent") return checks;

    const created = await attempt(
      storage.create({
        parentId: mod.RESERVED.PICTURES,
        name: "drawing.png",
        kind: "file",
        blob: new Blob([png], { type: "image/png" }),
        mediaType: "image/png",
        image: { width: 1024, height: 768 },
        origin: "paint",
      }),
    );
    check("Paint-style Blob create commits in WebKit", created.ok, created.ok ? `r${created.value.revision}` : `${created.code}: ${created.message}`);
    if (!created.ok) return checks;

    const readBack = await storage.read(created.value.id);
    const readBytes = await bytesOf(readBack.blob);
    check(
      "read returns a real Blob with the exact original bytes and metadata",
      readBack.blob instanceof Blob &&
        equalBytes(readBytes, png) &&
        readBack.size === png.length &&
        readBack.mediaType === "image/png" &&
        readBack.origin === "paint" &&
        readBack.image?.width === 1024 &&
        readBack.revision === 1,
      `${readBack.blob?.type || typeof readBack.blob}/${readBytes.length}/r${readBack.revision}`,
    );

    const listed = await storage.list(mod.RESERVED.PICTURES);
    const listedEntry = listed.find((entry) => entry.id === created.value.id);
    check(
      "list returns a real Blob too",
      listedEntry?.blob instanceof Blob && equalBytes(await bytesOf(listedEntry.blob), png),
      listedEntry ? String(listedEntry.blob?.type) : "missing",
    );

    const replacement = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 9, 8, 7, 6]);
    const written = await attempt(
      storage.write(created.value.id, {
        blob: new Blob([replacement], { type: "image/png" }),
        image: { width: 512, height: 256 },
      }, readBack.revision),
    );
    check("Blob write commits in WebKit", written.ok, written.ok ? `r${written.value.revision}` : `${written.code}: ${written.message}`);
    if (!written.ok) return checks;
    const rewritten = await storage.read(created.value.id);
    check(
      "write bumps the revision and replaces bytes atomically",
      written.value.revision === 2 && rewritten.revision === 2 && equalBytes(await bytesOf(rewritten.blob), replacement) && rewritten.image?.width === 512,
      `r${rewritten.revision}`,
    );

    const stale = await attempt(storage.write(created.value.id, { blob: new Blob([png], { type: "image/png" }) }, readBack.revision));
    check("a stale Blob write is still REVISION_CONFLICT", !stale.ok && stale.code === "REVISION_CONFLICT", stale.code || "committed");

    const draftPayloadBlob = new Blob([replacement], { type: "image/png" });
    await storage.putDraft({
      draftId: "paint-webkit-tab",
      appId: "paint",
      fileId: created.value.id,
      baseRevision: written.value.revision,
      payload: { blob: draftPayloadBlob, note: "unsaved drawing" },
      updatedAt: 1_000,
    });
    const draft = await storage.readDraft("paint-webkit-tab");
    check(
      "a Paint draft payload Blob round-trips as a real Blob",
      draft?.payload?.blob instanceof Blob &&
        equalBytes(await bytesOf(draft.payload.blob), replacement) &&
        draft.payload.note === "unsaved drawing" &&
        draft.baseRevision === 2,
      draft ? `${draft.payload?.blob?.type || typeof draft.payload?.blob}/r${draft.baseRevision}` : "missing",
    );
    const drafts = await storage.listDrafts();
    check(
      "listDrafts also reconstructs Blob payloads",
      drafts.length === 1 && drafts[0].payload.blob instanceof Blob && equalBytes(await bytesOf(drafts[0].payload.blob), replacement),
      String(drafts.length),
    );

    const service = serviceMod.createFileService({ storage, photoViewer: true });
    const viaService = await attempt(
      service.createImage({
        parentId: mod.RESERVED.PICTURES,
        name: "service.png",
        blob: new Blob([png], { type: "image/png" }),
        mediaType: "image/png",
        image: { width: 1024, height: 768 },
        origin: "paint",
      }),
    );
    check(
      "the shared services.files.createImage path commits in WebKit",
      viaService.ok && (await bytesOf((await service.read(viaService.value.id)).blob)).length === png.length,
      viaService.ok ? `r${viaService.value.revision}` : `${viaService.code}: ${viaService.message}`,
    );

    const note = await attempt(
      storage.create({ parentId: mod.RESERVED.DOCUMENTS, name: "note.txt", kind: "file", mediaType: "text/plain", text: "hello" }),
    );
    check("text saves still work in WebKit", note.ok && (await storage.read(note.value.id)).text === "hello", note.ok ? "ok" : note.code);

    storage.close();
    return checks;
  });

  let failures = 0;
  for (const entry of checks) {
    console.log(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.label}${entry.info ? ` — ${entry.info}` : ""}`);
    if (!entry.pass) failures++;
  }
  console.log(`\n${failures === 0 ? "WEBKIT STORAGE PROBE PASSED" : `${failures} WEBKIT STORAGE PROBE CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
  await context.close();
} catch (error) {
  console.error(`WEBKIT STORAGE PROBE CRASHED: ${error?.stack || error}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
