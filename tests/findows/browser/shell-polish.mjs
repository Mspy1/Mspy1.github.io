/* Focused shell-polish checks. Dev-only; no private paths, no shipped runtime.
   Run with FINDOWS_PLAYWRIGHT_MODULE pointing at a local Playwright package:
   node tests/findows/browser/shell-polish.mjs --port=8813 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./runtime.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const portArg = process.argv.find((a) => a.startsWith("--port="));
const PORT = portArg ? Number(portArg.slice(7)) : 8813;
const BASE = `http://127.0.0.1:${PORT}`;
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
};

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (pathname === "/" || pathname.endsWith("/")) pathname += "index.html";
    const target = resolve(ROOT, `.${pathname}`);
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((done, fail) => {
  server.once("error", fail);
  server.listen(PORT, "127.0.0.1", done);
});

const failures = [];
let fatal = null;
const ok = (cond, msg) => {
  console.log(`${cond ? "  PASS" : "  FAIL"} ${msg}`);
  if (!cond) failures.push(msg);
  return cond;
};
const log = (msg) => console.log(`\n[${msg}]`);
const rectOf = (page, appId) => page.evaluate(async (id) => {
  const m = await import("/findows/js/main.mjs");
  const state = m.wm.getState().find((item) => item.appId === id);
  return state ? { ...state.rect } : null;
}, appId);

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await page.goto(`${BASE}/findows/`, { waitUntil: "load" });
  await page.waitForSelector("#fw-desktop");

  log("Start app list is alphabetical and keeps Pinned badges");
  await page.click("#fw-start");
  const titles = await page.locator("#fw-results .fw-result-name").allTextContents();
  const sorted = [...titles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  ok(JSON.stringify(titles) === JSON.stringify(sorted), `Start results sorted (${titles.join(", ")})`);
  const pinned = await page.locator("#fw-results .fw-result").evaluateAll((nodes) =>
    nodes.filter((n) => n.querySelector(".fw-result-hint")?.textContent === "Pinned").map((n) => n.dataset.appId));
  ok(pinned.includes("help") && pinned.includes("calculator"), `Pinned badges retained (${pinned.join(", ")})`);
  await page.keyboard.press("Escape");

  log("recent list uses only real saved/opened file ids");
  const file = await page.evaluate(async () => {
    const m = await import("/findows/js/main.mjs");
    await m.services.files.ready();
    const entry = await m.services.files.createText({ parentId: "documents", name: "Polish note.txt", text: "polish" });
    window.__fileId = entry.id;
    m.services.openApp("notepad", { fileId: entry.id, mode: "edit" });
    return entry.id;
  });
  ok(Boolean(file), `created a real saved file id (${file})`);
  await page.click("#fw-start");
  const recentExists = (await page.locator("#fw-recent").count()) === 1;
  ok(recentExists, "Start renders a recent-files section when a real file is open");
  if (recentExists) {
    await page.waitForSelector("#fw-recent .fw-recent-item", { timeout: 5000 }).catch(() => {});
    const names = await page.locator("#fw-recent .fw-recent-item").allTextContents();
    ok(names.some((n) => n.includes("Polish note.txt")), `recent list shows the real file (${names.join(" | ")})`);
    await page.locator("#fw-recent .fw-recent-item").first().focus();
    await page.keyboard.press("Tab");
    ok(await page.evaluate(() => document.querySelector("#fw-start-panel")?.contains(document.activeElement)),
      "Tab from a recent item stays inside the Start panel");
    await page.locator("#fw-recent .fw-recent-item").first().focus();
    await page.keyboard.press("Escape");
    ok(!(await page.locator("#fw-start-panel").isVisible()), "Escape dismisses Start from a recent item");
  }

  log("storage reads are not repeated on drag");
  const readsOnDrag = await page.evaluate(async () => {
    const m = await import("/findows/js/main.mjs");
    const original = m.services.files.read;
    let calls = 0;
    m.services.files.read = (...args) => { calls++; return original(...args); };
    const id = m.wm.getState().find((w) => w.fileId)?.id;
    for (let i = 0; i < 12; i++) m.wm.dispatch({ type: "MOVE", id, x: 100 + i, y: 80 + i });
    m.services.files.read = original;
    return calls;
  });
  ok(readsOnDrag === 0, `twelve MOVE dispatches caused ${readsOnDrag} storage reads`);

  log("deleted file is hidden from recent");
  await page.evaluate(async () => {
    const m = await import("/findows/js/main.mjs");
    const entry = await m.services.files.read(window.__fileId);
    await m.services.files.trash(entry.id, entry.revision);
  });
  await page.keyboard.press("Escape");
  await page.click("#fw-start");
  await page.waitForFunction(
    () => !(document.querySelector("#fw-recent")?.textContent || "").includes("Polish note.txt"),
    { timeout: 5000 },
  ).catch(() => {});
  const afterTrash = await page.locator("#fw-recent .fw-recent-item").allTextContents();
  ok(!afterTrash.some((n) => n.includes("Polish note.txt")), `trashed file no longer listed (${afterTrash.join(" | ")})`);
  await page.keyboard.press("Escape");

  log("title-bar keyboard window menu commits and cancels");
  await page.evaluate(async () => (await import("/findows/js/main.mjs")).services.openApp("calculator"));
  await page.waitForSelector('.fw-window[data-app-id="calculator"] .calc-display');
  const calcFrame = page.locator('.fw-window[data-app-id="calculator"]');
  const menuButton = calcFrame.locator('[data-action="window-menu"]');
  const hasMenu = (await menuButton.count()) === 1;
  ok(hasMenu, "normal window exposes a focusable Window options control");
  if (hasMenu) {
    const before = await rectOf(page, "calculator");
    await menuButton.focus();
    await page.keyboard.press("Enter");
    ok(await page.locator(".fw-window-menu").isVisible(), "Enter opens the Window options menu");
    await page.click('.fw-window-menu [data-mode="move"]');
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const after = await rectOf(page, "calculator");
    ok(Math.abs(after.x - before.x - 48) <= 1 && Math.abs(after.y - before.y - 16) <= 1,
      `arrow move committed +48/+16 (${Math.round(after.x - before.x)}/${Math.round(after.y - before.y)})`);
    await menuButton.focus();
    await page.keyboard.press("Enter");
    await page.click('.fw-window-menu [data-mode="size"]');
    const widthBefore = (await rectOf(page, "calculator")).width;
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    ok(Math.abs((await rectOf(page, "calculator")).width - widthBefore) <= 1, "Escape cancels a pending size change");
    ok((await page.locator(".fw-window-menu").count()) === 0, "Escape closes the menu");
    await page.locator(".calc-display").focus();
    await page.keyboard.type("7");
    ok((await page.locator(".calc-display").textContent()).trim() === "7", "app shortcuts work after the menu closes");
  }

  log("compact layout keeps the title bar clean");
  await page.setViewportSize({ width: 390, height: 844 });
  if (hasMenu) {
    const hidden = await menuButton.evaluate((node) => getComputedStyle(node).display === "none");
    ok(hidden, "Window options control is hidden on a phone viewport");
  } else {
    ok(false, "cannot check compact menu without the control");
  }

  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  await ctx.close();
} catch (error) {
  fatal = error.message;
  console.error(`SHELL POLISH CHECK FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

if (failures.length || fatal) {
  console.error(`SHELL POLISH CHECKS FAILED (${failures.length})${fatal ? ` + fatal: ${fatal}` : ""}:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("ALL SHELL POLISH CHECKS PASSED");
}
