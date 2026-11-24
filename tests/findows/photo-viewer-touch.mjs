/* Focused touch-target regression for Photo Viewer. Dev-only; never shipped.
   Usage (local Playwright env):
     $env:FINDOWS_PLAYWRIGHT_MODULE='...\playwright'
     node tests/findows/photo-viewer-touch.mjs [--port=8906]
   Serves the worktree on 127.0.0.1:8906 and measures every visible control at
   320x640, 390x844 and 844x390 with touch emulation. */
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./browser/runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8906"));
const SHOTS = arg("shots", "");
const playwrightArg = arg("playwright", "");
const { chromium } = playwrightArg ? loadPlaywright(playwrightArg) : loadPlaywright();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const HARNESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Photo Viewer touch harness</title>
<link rel="stylesheet" href="/findows/styles/tokens.css">
<link rel="stylesheet" href="/findows/styles/photo-viewer.css">
<style>html,body{margin:0;height:100%;overflow:hidden}#fw-desktop{height:100vh;width:100vw}#app{height:100%}</style>
</head><body><div id="fw-desktop" data-theme="dark"><div id="app"></div></div></body></html>`;

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__pv-touch-harness.html") {
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
console.log(`photo-viewer touch harness serving ${ROOT} at ${BASE}`);

let failures = 0;
const check = (checks, label, pass, info = "") => checks.push({ label, pass: Boolean(pass), info: String(info) });
function report(label, checks) {
  for (const entry of checks || []) {
    console.log(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.label}${entry.info ? ` — ${entry.info}` : ""}`);
    if (!entry.pass) failures += 1;
  }
}

const VIEWPORTS = [
  { name: "320x640", width: 320, height: 640 },
  { name: "390x844", width: 390, height: 844 },
  { name: "844x390", width: 844, height: 390 },
];

const browser = await chromium.launch({ headless: true });
try {
  /* A real PNG encoded by Chromium, used as a byte-accurate stored image. */
  const generator = await browser.newPage();
  await generator.goto(`${BASE}/__pv-touch-harness.html`, { waitUntil: "load" });
  const pngBase64 = await generator.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    context.fillStyle = "#16b8a6";
    context.fillRect(0, 0, 48, 32);
    const blob = await new Promise((resolveBlob) => canvas.toBlob(resolveBlob, "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  await generator.close();
  if (!existsSync(resolve(ROOT, "findows/js/apps/photo-viewer.mjs"))) throw new Error("Photo Viewer module missing");
  console.log("generated one real 48x32 PNG for the touch probes");

  for (const viewport of VIEWPORTS) {
    console.log(`\n[${viewport.name}]`);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      page.on("pageerror", (error) => console.log(`  pageerror: ${error.message}`));
      await page.goto(`${BASE}/__pv-touch-harness.html`, { waitUntil: "load" });
      await page.evaluate(async ({ pngBase64 }) => {
        const { mount } = await import("/findows/js/apps/photo-viewer.mjs");
        const binary = atob(pngBase64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const blob = new Blob([bytes], { type: "image/png" });
        const entry = {
          id: "img1", parentId: "pictures", name: "harbor.png", kind: "file",
          mediaType: "image/png", blob, size: bytes.length, createdAt: 1, updatedAt: 1,
          revision: 1, trashedAt: null, origin: "import", image: { width: 48, height: 32 },
        };
        const calls = { openApp: [] };
        window.__CALLS__ = calls;
        const files = {
          ready: async () => "persistent",
          read: async (id) => (id === "img1" ? { ...entry } : null),
          list: async (id) => (id === "pictures" ? [{ ...entry }, { ...entry, id: "img2", name: "second.png" }] : []),
        };
        window.__HANDLE__ = await mount({
          container: document.getElementById("app"),
          windowId: "w-touch",
          fileId: "img1",
          mode: "view",
          draftId: null,
          services: { files, openApp: (appId, options) => calls.openApp.push({ appId, options }) },
          signal: new AbortController().signal,
        });
      }, { pngBase64 });
      await page.waitForFunction(() => document.querySelector("[data-role='loading']")?.hidden === true);

      const measured = await page.evaluate(() => {
        const app = document.querySelector(".pv-app");
        const toolbar = document.querySelector(".pv-toolbar");
        const buttons = [...app.querySelectorAll("button")].filter((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        }).map((node) => {
          const rect = node.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            act: node.dataset.act || node.className,
            w: Math.round(rect.width * 10) / 10,
            h: Math.round(rect.height * 10) / 10,
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            hit: Boolean(hit && (hit === node || node.contains(hit))),
          };
        });
        return {
          buttons,
          ready: document.querySelector(".pv-canvas")?.style.display !== "none",
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
          appOverflow: app.scrollWidth > app.clientWidth,
          toolbarOverflow: toolbar.scrollWidth > toolbar.clientWidth,
          viewportHeight: window.innerHeight,
        };
      });

      const checks = [];
      check(checks, "a real image is decoded and displayed", measured.ready);
      check(checks, "at least nine controls are visible", measured.buttons.length >= 9, `${measured.buttons.length} controls`);
      const small = measured.buttons.filter((button) => button.w < 44 || button.h < 44);
      check(checks, "every visible control is at least 44x44", small.length === 0, small.map((button) => `${button.act}:${button.w}x${button.h}`).join(", "));
      const covered = measured.buttons.filter((button) => !button.hit);
      check(checks, "every visible control is hit-testable at its centre", covered.length === 0, covered.map((button) => button.act).join(", "));
      const clipped = measured.buttons.filter((button) => button.bottom > measured.viewportHeight || button.top < 0);
      check(checks, "no control is clipped outside the viewport", clipped.length === 0, clipped.map((button) => button.act).join(", "));
      check(checks, "no page horizontal overflow", !measured.pageOverflow);
      check(checks, "no app or toolbar horizontal overflow", !measured.appOverflow && !measured.toolbarOverflow);
      if (viewport.width > 820) {
        check(checks, "gallery buttons are included at wide landscape", measured.buttons.some((button) => button.act === "gallery-open"));
      }
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: resolve(SHOTS, `photo-viewer-touch-${viewport.name}.png`) });
      }

      /* Behavior preserved on a touch surface. */
      await page.locator("[data-act='actual']").tap();
      check(checks, "tap Actual size still reports 100%", (await page.locator("[data-role='zoom']").innerText()).includes("100%"));
      await page.locator("[data-act='next']").tap();
      await page.waitForFunction(() => document.querySelector("[data-role='name']")?.textContent.includes("second.png"));
      check(checks, "tap Next still moves to the adjacent image", (await page.locator("[data-role='position']").innerText()).includes("2 of 2"));
      await page.locator("[data-act='edit-copy']").tap();
      check(checks, "tap Edit a copy still uses paint/edit-copy", JSON.stringify(await page.evaluate(() => window.__CALLS__.openApp[0])) === JSON.stringify({ appId: "paint", options: { fileId: "img2", mode: "edit-copy", source: "photo-viewer:edit-copy" } }));
      report(viewport.name, checks);
    } catch (error) {
      report(viewport.name, [{ label: "viewport probe completed", pass: false, info: error?.stack || String(error) }]);
    } finally {
      await context.close();
    }
  }

  console.log(`\n${failures === 0 ? "ALL PHOTO VIEWER TOUCH CHECKS PASSED" : `${failures} PHOTO VIEWER TOUCH CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (error) {
  console.error(`PHOTO VIEWER TOUCH CHECK CRASHED: ${error?.stack || error}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
