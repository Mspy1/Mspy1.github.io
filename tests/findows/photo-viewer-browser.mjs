/* Focused real-browser evidence for Photo Viewer. Dev-only; never shipped.
   Usage: node tests/findows/photo-viewer-browser.mjs [--port=8804] [--playwright=...] [--shots=...]
   Serves this repo on 127.0.0.1:8804, generates real PNG/JPEG/WebP files with
   the browser's own encoder, and asserts validation, decode, zoom, navigation,
   read-only behavior, download, local preview, cancellation and cleanup. */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8804"));
const SHOTS = arg("shots", "");
const { chromium } = loadPlaywright(arg("playwright", "") || process.env.PLAYWRIGHT_MODULE);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const HARNESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Photo Viewer harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/photo-viewer.css">
<style>html,body{margin:0;height:100%;overflow:hidden}#fw-desktop{height:100vh;width:100vw}#app{height:100%}</style>
</head><body><div id="fw-desktop" data-theme="dark"><div id="app"></div></div></body></html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__photo-viewer-harness.html") {
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
const IMAGE_DIR = resolve(ROOT, ".superpowers/sdd/2026-11-24-findows/evidence/photo-viewer-images");
mkdirSync(IMAGE_DIR, { recursive: true });
console.log(`photo-viewer harness serving ${ROOT} at ${BASE}`);

/* --- real local images: encoded by Chromium, written to disk, read by tests --- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function makeApng(png) {
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") break;
    offset += 12 + length;
  }
  const data = Buffer.alloc(8);
  data.writeUInt32BE(1, 0);
  data.writeUInt32BE(0, 4);
  const chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8, 0);
  chunk.write("acTL", 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from("acTL", "ascii"), data])), 16);
  return Buffer.concat([png.subarray(0, offset), chunk, png.subarray(offset)]);
}

let failures = 0;
function report(label, checks) {
  for (const entry of checks || []) {
    console.log(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.label}${entry.info ? ` — ${entry.info}` : ""}`);
    if (!entry.pass) failures += 1;
  }
}
const check = (checks, label, pass, info = "") => checks.push({ label, pass: Boolean(pass), info: String(info) });

async function scenario(browser, label, run) {
  console.log(`\n[${label}]`);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`  pageerror: ${error.message}`));
    await page.goto(`${BASE}/__photo-viewer-harness.html`, { waitUntil: "load" });
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

const browser = await chromium.launch({ headless: true });
let images;
try {
  const generator = await browser.newPage();
  await generator.goto(`${BASE}/__photo-viewer-harness.html`, { waitUntil: "load" });
  const generated = await generator.evaluate(async () => {
    const make = async (mediaType, color, name) => {
      const canvas = document.createElement("canvas");
      canvas.width = 48;
      canvas.height = 32;
      const context = canvas.getContext("2d");
      context.fillStyle = color;
      context.fillRect(0, 0, 48, 32);
      context.fillStyle = "#4f6df5";
      context.fillRect(8, 8, 12, 10);
      const blob = await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, mediaType, 0.92));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { name, mediaType, size: bytes.length, base64: btoa(binary) };
    };
    return Promise.all([
      make("image/png", "#16b8a6", "harbor.png"),
      make("image/jpeg", "#ffaa66", "sunset.jpg"),
      make("image/webp", "#4f6df5", "sketch.webp"),
    ]);
  });
  await generator.close();
  images = {};
  for (const image of generated) {
    writeFileSync(resolve(IMAGE_DIR, image.name), Buffer.from(image.base64, "base64"));
    images[image.name] = image.base64;
  }
  console.log(`generated local images: ${generated.map((image) => `${image.name} (${image.size} bytes)`).join(", ")}`);

  /** Mount the real app with an injectable file service and byte-accurate blobs. */
  async function mountViewer(page, config = {}) {
    await page.evaluate(
      async ({ config, images }) => {
        const { mount } = await import("/findows/js/apps/photo-viewer.mjs");
        const bytes = (base64) => {
          const binary = atob(base64);
          const view = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) view[index] = binary.charCodeAt(index);
          return view;
        };
        const blob = (name) => new Blob([bytes(images[name])], { type: name.endsWith(".png") ? "image/png" : name.endsWith(".jpg") ? "image/jpeg" : "image/webp" });
        const at = 1700000000000;
        const entry = (id, parentId, name, kind, extra = {}) => ({
          id, parentId, name, kind,
          mediaType: kind === "folder" ? null : extra.mediaType || "text/plain",
          size: extra.size ?? 0, createdAt: at, updatedAt: at, revision: 1,
          trashedAt: null, origin: extra.origin ?? null, ...extra,
        });
        const entries = new Map();
        for (const item of [
          entry("root", null, "Findows", "folder"),
          entry("pictures", "root", "Pictures", "folder"),
          entry("documents", "root", "Documents", "folder"),
          entry("img1", "pictures", "harbor.png", "file", { mediaType: "image/png", blob: blob("harbor.png"), size: images["harbor.png"].length, origin: "import", image: { width: 48, height: 32 } }),
          entry("img2", "pictures", "sunset.jpg", "file", { mediaType: "image/jpeg", blob: blob("sunset.jpg"), size: images["sunset.jpg"].length, origin: "import", image: { width: 48, height: 32 } }),
          entry("img3", "pictures", "sketch.webp", "file", { mediaType: "image/webp", blob: blob("sketch.webp"), size: images["sketch.webp"].length, origin: "paint", image: { width: 48, height: 32 } }),
          entry("note", "pictures", "notes.txt", "file", { mediaType: "text/plain", text: "not an image", size: 12 }),
        ]) entries.set(item.id, item);
        if (config.includeCorrupt) {
          entries.set("bad", entry("bad", "pictures", "broken.png", "file", {
            mediaType: "image/png", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
            size: 3, origin: "import",
          }));
        }
        const calls = { openApp: [], writes: 0, decodes: 0, bitmapClosed: 0, downloads: [], downloadName: null };
        const files = {
          getStorageMode: () => (config.blocked ? "temporary" : "persistent"),
          ready: async () => (config.blocked ? "temporary" : "persistent"),
          read: async (id) => {
            if (config.blocked) { const error = new Error("Not saved — storage is unavailable."); error.code = "UNAVAILABLE"; throw error; }
            const found = entries.get(id);
            if (!found) { const error = new Error("That image no longer exists."); error.code = "MISSING"; throw error; }
            return { ...found };
          },
          list: async (id) => {
            if (config.blocked) { const error = new Error("Not saved — storage is unavailable."); error.code = "UNAVAILABLE"; throw error; }
            return [...entries.values()].filter((item) => item.parentId === id).map((item) => ({ ...item }));
          },
          write: async () => { calls.writes += 1; throw new Error("Photo Viewer must not write."); },
          create: async () => { calls.writes += 1; throw new Error("Photo Viewer must not create."); },
          getAppForFile: (item) => (item?.mediaType === "text/plain" ? { appId: "notepad", mode: "edit" } : null),
        };
        const realCreate = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (source) => {
          const url = realCreate(source);
          calls.downloads.push({ type: source.type, size: source.size });
          return url;
        };
        const realClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          if (this.download) { calls.downloadName = this.download; return; }
          return realClick.call(this);
        };
        const services = { files, ...(config.noOpenApp ? {} : { openApp: (appId, options) => calls.openApp.push({ appId, options }) }) };
        const controller = new AbortController();
        window.__ABORT__ = () => controller.abort();
        if (config.cancelDecode) {
          window.createImageBitmap = async () => {
            calls.decodes += 1;
            window.__ABORT__();
            return { width: 48, height: 32, close: () => { calls.bitmapClosed += 1; } };
          };
        }
        window.__CALLS__ = calls;
        window.__SERVICES__ = services;
        const handle = await mount({
          container: document.getElementById("app"),
          windowId: "w-photo",
          fileId: config.fileId === undefined ? "img1" : config.fileId,
          mode: config.mode || "view",
          draftId: null,
          services,
          signal: controller.signal,
        });
        window.__HANDLE__ = handle;
      },
      { config, images },
    );
  }

  /* 1. Real decode, validation affordance, zoom, keyboard and read-only path. */
  await scenario(browser, "validated decode, fit/actual/zoom and read-only", async (page) => {
    const checks = [];
    await mountViewer(page);
    await page.locator(".pv-stage canvas").waitFor();
    await page.waitForFunction(() => document.querySelector("[data-role='loading']")?.hidden === true);
    check(checks, "validation states the real format and dimensions", (await page.locator("[data-role='validation']").innerText()).includes("PNG") && (await page.locator("[data-role='dimensions']").innerText()).includes("48 × 32"));
    check(checks, "declared read-only status is visible", (await page.locator(".pv-mode").innerText()).toLowerCase().includes("read-only"));
    check(checks, "no raw URL or embedded image element is used", (await page.locator(".pv-app img").count()) === 0 && !(await page.locator(".pv-app").evaluate((node) => node.innerHTML.includes("http"))));
    const canvas = await page.evaluate(() => {
      const node = document.querySelector(".pv-stage canvas");
      const context = node.getContext("2d");
      const pixel = context.getImageData(Math.floor(node.width / 2), Math.floor(node.height / 2), 1, 1).data;
      return { width: node.width, height: node.height, pixel: [...pixel] };
    });
    check(checks, "real decoded pixels are drawn to the canvas", canvas.width > 0 && canvas.pixel[3] === 255, JSON.stringify(canvas));

    await page.locator("[data-act='actual']").click();
    check(checks, "actual size is reported as 100%", (await page.locator("[data-role='zoom']").innerText()).includes("100%"));
    await page.locator("[data-act='zoom-in']").click();
    check(checks, "zoom buttons change the scale", (await page.locator("[data-role='zoom']").innerText()).includes("150%"));
    await page.locator(".pv-stage").focus();
    await page.keyboard.press("+");
    check(checks, "keyboard zoom changes the scale", (await page.locator("[data-role='zoom']").innerText()).includes("200%"));
    await page.keyboard.press("0");
    check(checks, "keyboard 0 returns to fit", (await page.locator("[data-role='zoom']").innerText()).toLowerCase().includes("fit"));
    await page.keyboard.press("1");
    check(checks, "keyboard 1 returns to actual size", (await page.locator("[data-role='zoom']").innerText()).includes("100%"));
    check(checks, "viewing made no write or create calls", (await page.evaluate(() => window.__CALLS__.writes)) === 0);
    return checks;
  });

  /* 2. Same-folder navigation, edit-copy, and no source mutation. */
  await scenario(browser, "adjacent images and unsaved Paint copy", async (page) => {
    const checks = [];
    await mountViewer(page);
    await page.locator(".pv-stage canvas").waitFor();
    const before = await page.evaluate(async () => {
      const source = window.__SERVICES__.files;
      const item = await source.read("img1");
      const bytes = new Uint8Array(await item.blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    });
    await page.locator("[data-act='next']").click();
    await page.waitForFunction(() => document.querySelector("[data-role='name']")?.textContent.includes("sunset.jpg"));
    check(checks, "Next moves to the adjacent image in the same folder", (await page.locator("[data-role='position']").innerText()).includes("2 of 3"));
    check(checks, "navigation updates the decoded format", (await page.locator("[data-role='validation']").innerText()).includes("JPEG"));
    await page.locator(".pv-stage").focus();
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => document.querySelector("[data-role='name']")?.textContent.includes("harbor.png"));
    check(checks, "ArrowLeft moves back without leaving the folder", (await page.locator("[data-role='name']").innerText()).includes("harbor.png"));

    await page.locator("[data-act='edit-copy']").click();
    const openCall = await page.evaluate(() => window.__CALLS__.openApp[0]);
    check(checks, "Paint copy uses the real file id and edit-copy mode", openCall?.appId === "paint" && openCall?.options?.fileId === "img1" && openCall?.options?.mode === "edit-copy" && typeof openCall?.options?.source === "string", JSON.stringify(openCall));
    const after = await page.evaluate(async () => {
      const item = await window.__SERVICES__.files.read("img1");
      const bytes = new Uint8Array(await item.blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    });
    check(checks, "opening a copy leaves source bytes unchanged", before === after && (await page.evaluate(() => window.__CALLS__.writes)) === 0);
    return checks;
  });

  /* 3. Explicit download, local preview and rejected malformed files. */
  await scenario(browser, "download, local preview and validation rejections", async (page) => {
    const checks = [];
    await mountViewer(page);
    await page.locator(".pv-stage canvas").waitFor();
    await page.locator("[data-act='download']").click();
    const download = await page.evaluate(() => ({ name: window.__CALLS__.downloadName, last: window.__CALLS__.downloads.at(-1) }));
    check(checks, "download suggests a safe filename with real bytes", download.name === "harbor.png" && download.last.type === "image/png" && download.last.size > 0, JSON.stringify(download));

    await page.locator("[data-act='choose-local']").click();
    await page.locator("input[type='file']").setInputFiles({ name: "from-device.png", mimeType: "image/png", buffer: Buffer.from(images["harbor.png"], "base64") });
    await page.waitForFunction(() => document.querySelector("[data-role='name']")?.textContent.includes("from-device.png"));
    check(checks, "validated local preview opens without saving", (await page.locator("[data-role='validation']").innerText()).includes("PNG") && (await page.locator("[data-act='edit-copy']").isDisabled()) && (await page.evaluate(() => window.__CALLS__.writes)) === 0);

    const png = Buffer.from(images["harbor.png"], "base64");
    const apng = makeApng(png);
    await page.locator("input[type='file']").setInputFiles({ name: "animated.png", mimeType: "image/png", buffer: apng });
    await page.locator(".pv-error:visible").waitFor();
    check(checks, "APNG is rejected by header validation", (await page.locator(".pv-error").innerText()).includes("ANIMATED_IMAGE"));

    await page.locator("input[type='file']").setInputFiles({ name: "active.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>") });
    await page.waitForFunction(() => document.querySelector(".pv-error")?.textContent.includes("UNSUPPORTED_TYPE"));
    check(checks, "active SVG is rejected before decode", (await page.locator(".pv-error").innerText()).includes("UNSUPPORTED_TYPE"));

    const oversized = Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]);
    await page.locator("input[type='file']").setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: oversized });
    await page.waitForFunction(() => document.querySelector(".pv-error")?.textContent.includes("FILE_TOO_LARGE"));
    check(checks, "oversized image is rejected before decode", (await page.locator(".pv-error").innerText()).includes("FILE_TOO_LARGE"));

    await page.locator("input[type='file']").setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: png.subarray(0, png.length - 14) });
    await page.waitForFunction(() => /TRUNCATED_IMAGE|MALFORMED_IMAGE/.test(document.querySelector(".pv-error")?.textContent || ""));
    check(checks, "truncated PNG is rejected before decode", /TRUNCATED_IMAGE|MALFORMED_IMAGE/.test(await page.locator(".pv-error").innerText()));
    return checks;
  });

  /* 4. Meaningful launch without a file, and blocked storage disclosure. */
  await scenario(browser, "launch without a file and blocked storage", async (page) => {
    const checks = [];
    await mountViewer(page, { fileId: null });
    await page.locator("[data-role='gallery'] button[data-file-id]").first().waitFor();
    check(checks, "gallery lists only real saved images", (await page.locator("[data-role='gallery'] button[data-file-id]").count()) === 3);
    check(checks, "no pretend file is listed", !(await page.locator("[data-role='gallery']").innerText()).includes("notes.txt"));
    await page.locator("[data-role='gallery'] button[data-file-id='img3']").click();
    await page.locator(".pv-stage canvas").waitFor();
    check(checks, "gallery selection decodes the chosen stored image", (await page.locator("[data-role='name']").innerText()).includes("sketch.webp") && (await page.locator("[data-role='validation']").innerText()).includes("WebP"));
    return checks;
  });

  await scenario(browser, "temporary mode is explicit", async (page) => {
    const checks = [];
    await mountViewer(page, { fileId: null, blocked: true });
    await page.locator(".pv-error:visible").waitFor();
    check(checks, "storage failure is a visible typed error", (await page.locator(".pv-error").innerText()).includes("UNAVAILABLE"));
    check(checks, "temporary mode badge is visible", (await page.locator(".pv-mode").innerText()).toLowerCase().includes("temporary"));
    check(checks, "no pretend images appear when storage is unavailable", (await page.locator("[data-role='gallery'] button[data-file-id]").count()) === 0);
    return checks;
  });

  /* 5. In-flight decode is cancelled and every bitmap is released. */
  await scenario(browser, "cancel in-flight decode and release resources", async (page) => {
    const checks = [];
    await mountViewer(page, { cancelDecode: true });
    const cancellation = await page.evaluate(() => ({
      decodes: window.__CALLS__.decodes,
      closed: window.__CALLS__.bitmapClosed,
      app: Boolean(document.querySelector(".pv-app")),
    }));
    check(checks, "aborted decode closes its bitmap exactly once", cancellation.decodes === 1 && cancellation.closed === 1, JSON.stringify(cancellation));
    check(checks, "cancelled viewer shows no success state", !(await page.locator(".pv-app").count()) && (await page.evaluate(() => window.__CALLS__.writes)) === 0);
    return checks;
  });

  /* 6. Missing open action is stated, not silently ignored. */
  await scenario(browser, "missing Paint action", async (page) => {
    const checks = [];
    await mountViewer(page, { noOpenApp: true });
    await page.locator(".pv-stage canvas").waitFor();
    await page.locator("[data-act='edit-copy']").click();
    await page.locator(".pv-error:visible").waitFor();
    check(checks, "missing openApp action is reported", (await page.locator(".pv-error").innerText()).toLowerCase().includes("can't open") || (await page.locator(".pv-error").innerText()).toLowerCase().includes("cannot open"));
    return checks;
  });

  /* 8. A rejected stored image must leave no downloadable or editable source. */
  await scenario(browser, "rejected image clears actionable state", async (page) => {
    const checks = [];
    await mountViewer(page, { includeCorrupt: true });
    await page.waitForFunction(() => document.querySelector("[data-role='loading']")?.hidden === true);
    check(checks, "valid image starts with both actions available", !(await page.locator("[data-act='download']").isDisabled()) && !(await page.locator("[data-act='edit-copy']").isDisabled()));

    await page.locator("[data-role='gallery'] button[data-file-id='bad']").click();
    await page.locator(".pv-error:visible").waitFor();
    const errorText = await page.locator(".pv-error").innerText();
    check(checks, "corrupt blob reports a typed validation error", /^(UNSUPPORTED_TYPE|MALFORMED_IMAGE|TRUNCATED_IMAGE|DECODE_FAILED):/.test(errorText), errorText);
    check(checks, "Download is disabled after rejection", await page.locator("[data-act='download']").isDisabled());
    check(checks, "Edit copy is disabled after rejection", await page.locator("[data-act='edit-copy']").isDisabled());
    check(checks, "no download blob was created for a rejected image", (await page.evaluate(() => window.__CALLS__.downloads.length)) === 0);
    await page.evaluate(() => document.querySelector("[data-act='download']").click());
    check(checks, "no download is offered even if the disabled control is invoked", (await page.evaluate(() => window.__CALLS__.downloadName)) === null);
    check(checks, "no success status survives a rejection", !(await page.locator(".pv-status").innerText()).toLowerCase().includes("showing"));

    await page.locator("[data-role='gallery'] button[data-file-id='img1']").click();
    await page.waitForFunction(() => document.querySelector("[data-role='loading']")?.hidden === true);
    check(checks, "navigating back to a valid image restores actions", !(await page.locator("[data-act='download']").isDisabled()) && !(await page.locator("[data-act='edit-copy']").isDisabled()));
    return checks;
  });

  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await scenario(browser, "visual capture", async (page) => {
      await page.setViewportSize({ width: 1180, height: 760 });
      await mountViewer(page, { fileId: "img1" });
      await page.waitForFunction(() => document.querySelector("[data-role='loading']")?.hidden === true);
      await page.screenshot({ path: resolve(SHOTS, "photo-viewer-desktop.png") });
      await page.setViewportSize({ width: 390, height: 720 });
      await page.screenshot({ path: resolve(SHOTS, "photo-viewer-narrow.png") });
      return [{ label: "captured desktop and narrow screenshots", pass: true }];
    });
  }

  console.log(`\n${failures === 0 ? "ALL PHOTO VIEWER BROWSER CHECKS PASSED" : `${failures} PHOTO VIEWER BROWSER CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (error) {
  console.error(`PHOTO VIEWER BROWSER CHECK CRASHED: ${error?.stack || error}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
