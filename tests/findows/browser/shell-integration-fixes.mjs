/* Focused integration/geometry/touch browser checks for Gate 5 follow-up.
   Dev-only; no private paths, no shipped runtime. Local Playwright via
   FINDOWS_PLAYWRIGHT_MODULE. Usage: node ... --port=8896 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./runtime.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const portArg = process.argv.find((a) => a.startsWith("--port="));
const PORT = portArg ? Number(portArg.slice(7)) : 8896;
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
    res.writeHead(200, { "content-type": TYPES[extname(target)] || "application/octet-stream" });
    res.end(await readFile(target));
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((done, fail) => {
  server.once("error", fail);
  server.listen(PORT, "127.0.0.1", done);
});

const failures = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "  PASS" : "  FAIL"} ${msg}`);
  if (!cond) failures.push(msg);
  return cond;
};
const log = (msg) => console.log(`\n[${msg}]`);

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true });
let ctx;
try {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const freshPage = async (context = ctx) => {
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log(`  PAGEERROR ${e.message}`));
    await page.goto(`${BASE}/findows/`, { waitUntil: "load" });
    await page.waitForSelector("#fw-desktop");
    return page;
  };
  const open = (page, appId) => page.evaluate(async (id) => {
    const m = await import("/findows/js/main.mjs");
    return m.services.openApp(id);
  }, appId);
  const openFake = (page, count) => page.evaluate(async (n) => {
    const m = await import("/findows/js/main.mjs");
    for (let i = 0; i < n; i++) {
      m.wm.dispatch({
        type: "OPEN", id: `probe-${i}`, appId: "help", title: `Probe ${i}`,
        icon: "help", singleton: false, minSize: { width: 320, height: 200 },
      });
    }
    return m.wm.getState().length;
  }, count);

  log("S1 30 shortcuts must scroll internally, never scroll #fw-desktop (Paint smoke step)");
  {
    const page = await freshPage();
    const bounded = await page.evaluate(() => {
      const shortcuts = document.querySelector(".fw-shortcuts");
      const area = document.querySelector(".fw-desktop-area");
      const cs = getComputedStyle(shortcuts);
      return {
        count: shortcuts.querySelectorAll(".fw-shortcut").length,
        scrollHeight: shortcuts.scrollHeight,
        clientHeight: shortcuts.clientHeight,
        overflowY: cs.overflowY,
        bottom: shortcuts.getBoundingClientRect().bottom,
        areaBottom: area.getBoundingClientRect().bottom,
      };
    });
    ok(bounded.count > 20 && bounded.scrollHeight > bounded.clientHeight
      && bounded.overflowY === "auto" && bounded.bottom <= bounded.areaBottom + 1,
    `shortcut grid is height-bounded and scrollable (${JSON.stringify(bounded)})`);
    await page.click("#fw-start");
    await page.fill("#fw-search", "paint");
    await page.click("#fw-results button[data-app-id='paint']");
    await page.waitForSelector(".paint-canvas");
    const geom = await page.evaluate(() => {
      const desktop = document.querySelector("#fw-desktop");
      const frame = document.querySelector('.fw-window[data-app-id="paint"]');
      const canvas = document.querySelector(".paint-canvas");
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      return {
        scrollTop: desktop.scrollTop,
        desktopScrollable: desktop.scrollHeight > desktop.clientHeight,
        overflow: getComputedStyle(desktop).overflow,
        winTop: Math.round(frame.getBoundingClientRect().top),
        canvasTop: Math.round(r.top),
        canvasBottom: Math.round(r.bottom),
        hit: document.elementFromPoint(cx, cy)?.className || null,
      };
    });
    ok(geom.scrollTop === 0 && !geom.desktopScrollable && geom.winTop > 0
      && geom.canvasTop > 0 && geom.canvasBottom < 900 && String(geom.hit).includes("paint-canvas"),
    `Paint stays on-screen after Start click (${JSON.stringify(geom)})`);
    await page.close();
  }

  log("S2 M1 work-area changes must preserve each window's minSize");
  {
    const page = await freshPage();
    // Open while the work area is smaller than Paint's declared minSize so
    // normalRect itself is below the minimum; the bug is that growing the
    // viewport never clamps it back up.
    await page.setViewportSize({ width: 360, height: 400 });
    await open(page, "paint");
    await page.waitForSelector('.fw-window[data-app-id="paint"] .paint-canvas');
    await page.waitForTimeout(150);
    const small = await page.evaluate(async () => {
      const m = await import("/findows/js/main.mjs");
      const w = m.wm.getState().find((item) => item.appId === "paint");
      return { width: w.rect.width, height: w.rect.height, min: { ...w.minSize } };
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(150);
    const grown = await page.evaluate(async () => {
      const m = await import("/findows/js/main.mjs");
      const w = m.wm.getState().find((item) => item.appId === "paint");
      return { width: w.rect.width, height: w.rect.height, min: { ...w.minSize } };
    });
    ok(small.width < small.min.width && grown.width >= grown.min.width
      && grown.height >= grown.min.height,
    `rect regrows to declared minSize (${JSON.stringify({ small, grown })})`);
    await page.close();
  }

  log("S3 M2 window-cap notice survives unrelated emits");
  {
    const page = await freshPage();
    const first = await page.evaluate(() => document.querySelector("#fw-notice").textContent);
    await openFake(page, 8);
    await page.evaluate(() => document.querySelector("#fw-notice").textContent = "");
    await page.evaluate(async () => {
      const m = await import("/findows/js/main.mjs");
      m.wm.dispatch({
        type: "OPEN", id: "ninth", appId: "notepad", title: "Notepad",
        icon: "notepad", singleton: false, minSize: { width: 320, height: 200 },
      });
    });
    const notice = await page.locator("#fw-notice").textContent();
    ok(String(first) === "" && /close a window|make room/i.test(notice || ""),
      `9th open announces the cap (${JSON.stringify(notice)})`);
    await page.evaluate(async () => {
      const m = await import("/findows/js/main.mjs");
      m.wm.dispatch({ type: "FOCUS", id: m.wm.getState()[0].id });
    });
    const afterFocus = await page.locator("#fw-notice").textContent();
    ok(/close a window|make room/i.test(afterFocus || ""),
      `notice is not consumed by a later FOCUS emit (${JSON.stringify(afterFocus)})`);
    await page.close();
  }

  log("S4 M3 focus recovery when the launcher was detached");
  {
    const page = await freshPage();
    await page.evaluate(async () => {
      const m = await import("/findows/js/main.mjs");
      const transient = document.createElement("button");
      transient.textContent = "Transient launcher";
      document.body.append(transient);
      window.__transient = transient;
      m.services.openApp("notepad", { source: transient });
    });
    await page.waitForSelector('.fw-window[data-app-id="notepad"]');
    await page.evaluate(() => window.__transient.remove());
    await page.locator('.fw-window[data-app-id="notepad"] [data-action="close"]').click();
    await page.waitForFunction(() => !document.querySelector('.fw-window[data-app-id="notepad"]'));
    const r = await page.evaluate(() => {
      const a = document.activeElement;
      return {
        body: a === document.body,
        task: !!a?.classList?.contains("fw-task-item"),
        start: a?.id === "fw-start",
        text: (a?.textContent || "").trim().slice(0, 24),
      };
    });
    ok(!r.body && (r.task || r.start), `focus falls back to a live control (${JSON.stringify(r)})`);
    await page.close();
  }

  log("S5 M4 compact switcher is height-capped and scrollable");
  {
    const page = await freshPage();
    await page.setViewportSize({ width: 360, height: 500 });
    const count = await openFake(page, 8);
    await page.click("#fw-switcher");
    const r = await page.evaluate(() => {
      const panel = document.querySelector("#fw-switcher-panel");
      const cs = getComputedStyle(panel);
      const box = panel.getBoundingClientRect();
      return {
        top: Math.round(box.top), bottom: Math.round(box.bottom),
        maxHeight: cs.maxHeight, overflowY: cs.overflowY,
        scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight,
        firstTop: Math.round(panel.querySelector(".fw-result")?.getBoundingClientRect().top ?? -999),
      };
    });
    ok(count === 8 && r.top >= 0 && r.overflowY === "auto" && r.firstTop >= 0,
      `8-window switcher fits the compact viewport (${JSON.stringify(r)})`);
    await page.close();
  }

  log("S6 M5 MOVE/RESIZE emits do not rebuild taskbar or switcher DOM");
  {
    const page = await freshPage();
    await openFake(page, 3);
    const counts = await page.evaluate(async () => {
      const task = document.querySelector("#fw-task-items");
      const list = document.querySelector("#fw-switcher-list");
      let taskRebuilds = 0;
      let listRebuilds = 0;
      const nativeTask = task.replaceChildren.bind(task);
      const nativeList = list.replaceChildren.bind(list);
      task.replaceChildren = (...args) => { taskRebuilds++; return nativeTask(...args); };
      list.replaceChildren = (...args) => { listRebuilds++; return nativeList(...args); };
      const m = await import("/findows/js/main.mjs");
      const id = m.wm.getState()[0].id;
      for (let i = 0; i < 50; i++) m.wm.dispatch({ type: "MOVE", id, x: 100 + i, y: 80 + i });
      const afterMove = { taskRebuilds, listRebuilds };
      const other = m.wm.getState()[1].id;
      m.wm.dispatch({ type: "FOCUS", id: other });
      return { afterMove, afterFocus: { taskRebuilds, listRebuilds } };
    });
    ok(counts.afterMove.taskRebuilds === 0 && counts.afterMove.listRebuilds === 0,
      `50 MOVE emits caused no list rebuilds (${JSON.stringify(counts)})`);
    ok(counts.afterFocus.taskRebuilds > 0 && counts.afterFocus.listRebuilds > 0,
      `a real state change still rebuilds the lists (${JSON.stringify(counts)})`);
    await page.close();
  }

  log("S7 F9 mobile title-bar buttons and exit link are 44px touch targets");
  {
    const page = await freshPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "calculator");
    await page.waitForSelector('.fw-window[data-app-id="calculator"] [data-action="close"]');
    // fw-open animates scale(.985) for 180ms; measure the settled target size.
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.fw-window[data-app-id="calculator"] .fw-title-button')]
        .filter((b) => !b.hidden && b.getClientRects().length)
        .map((b) => {
          const box = b.getBoundingClientRect();
          return { action: b.dataset.action, w: Math.round(box.width), h: Math.round(box.height) };
        });
      const exit = document.querySelector("#fw-exit").getBoundingClientRect();
      return { buttons, exit: { w: Math.round(exit.width), h: Math.round(exit.height) } };
    });
    ok(r.buttons.length > 0 && r.buttons.every((b) => b.w >= 44 && b.h >= 44),
      `title-bar controls are >=44x44 (${JSON.stringify(r.buttons)})`);
    ok(r.exit.h >= 44, `exit link is >=44px tall (${JSON.stringify(r.exit)})`);
    await page.close();
  }

  log("S8 F10 simulated on-screen keyboard keeps the focused input visible");
  {
    const kbCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await kbCtx.addInitScript(() => {
      const vv = new EventTarget();
      vv.height = window.innerHeight;
      vv.width = window.innerWidth;
      vv.offsetTop = 0;
      vv.offsetLeft = 0;
      vv.pageTop = 0;
      Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
      window.__vv = vv;
    });
    const page = await freshPage(kbCtx);
    await open(page, "sticky-notes");
    await page.waitForSelector(".sn-search");
    await page.evaluate(async () => {
      const m = await import("/findows/js/main.mjs");
      const id = m.wm.getState().find((w) => w.appId === "sticky-notes").id;
      m.wm.dispatch({ type: "MOVE", id, x: 200, y: 620 });
    });
    await page.locator(".sn-search").focus();
    const before = await page.evaluate(() => {
      const r = document.querySelector(".sn-search").getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    await page.evaluate(() => {
      const vv = window.__vv;
      vv.height = window.innerHeight - 300;
      vv.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(120);
    const after = await page.evaluate(() => {
      const r = document.querySelector(".sn-search").getBoundingClientRect();
      const taskbar = document.querySelector("#fw-taskbar").getBoundingClientRect();
      return {
        bottom: Math.round(r.bottom),
        limit: window.__vv.height,
        taskbarBottom: Math.round(taskbar.bottom),
        keyboard: document.querySelector("#fw-desktop").dataset.keyboard || null,
      };
    });
    ok(before.bottom > 600 && after.bottom <= after.limit && after.taskbarBottom <= after.limit,
      `focused input and taskbar sit above the simulated keyboard (${JSON.stringify({ before, after })})`);
    await kbCtx.close();
  }

  log("S9 A2/A3 recent rows, quick settings and window-menu choices are 44px");
  {
    const page = await freshPage();
    await page.evaluate(async () => {
      const m = await import("/findows/js/main.mjs");
      await m.services.files.ready();
      const entry = await m.services.files.createText({
        parentId: "documents", name: "A2 probe.txt", text: "a2",
      });
      m.services.openApp("notepad", { fileId: entry.id, mode: "edit" });
    });
    await page.waitForSelector('.fw-window[data-app-id="notepad"]');
    await page.click("#fw-start");
    await page.waitForSelector("#fw-recent .fw-recent-item", { timeout: 5000 });
    const sizes = await page.evaluate(() => ({
      recent: [...document.querySelectorAll("#fw-recent .fw-recent-item")]
        .map((n) => Math.round(n.getBoundingClientRect().height)),
      quick: [...document.querySelectorAll(".fw-quick button")]
        .map((n) => Math.round(n.getBoundingClientRect().height)),
    }));
    ok(sizes.recent.length > 0 && sizes.recent.every((h) => h >= 44),
      `recent rows are >=44px (${JSON.stringify(sizes.recent)})`);
    ok(sizes.quick.length > 0 && sizes.quick.every((h) => h >= 44),
      `quick settings are >=44px (${JSON.stringify(sizes.quick)})`);
    await page.keyboard.press("Escape");
    await open(page, "calculator");
    await page.waitForSelector('.fw-window[data-app-id="calculator"] [data-action="window-menu"]');
    await page.locator('.fw-window[data-app-id="calculator"] [data-action="window-menu"]').click();
    const choices = await page.evaluate(() => [...document.querySelectorAll(".fw-menu-choice")]
      .map((n) => Math.round(n.getBoundingClientRect().height)));
    ok(choices.length === 2 && choices.every((h) => h >= 44),
      `window-menu choices are >=44px (${JSON.stringify(choices)})`);
    await page.close();
  }

  log("S10 A4 200% zoom (720x450 CSS px) keeps shell navigation reachable");
  {
    const zoomCtx = await browser.newContext({
      viewport: { width: 720, height: 450 }, deviceScaleFactor: 2,
    });
    const page = await freshPage(zoomCtx);
    await open(page, "calculator");
    await page.waitForSelector('.fw-window[data-app-id="calculator"] [data-action="close"]');
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const hit = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const box = node.getBoundingClientRect();
        const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          h: Math.round(box.height),
          reachable: !!target && (target === node || node.contains(target)),
        };
      };
      return {
        dpr: devicePixelRatio,
        layout: document.querySelector("#fw-desktop").dataset.layout,
        start: hit("#fw-start"),
        switcher: hit("#fw-switcher"),
        exit: hit("#fw-exit"),
        close: hit('.fw-window[data-app-id="calculator"] [data-action="close"]'),
        maximize: hit('.fw-window[data-app-id="calculator"] [data-action="maximize"]'),
      };
    });
    const controls = [r.start, r.switcher, r.exit, r.close, r.maximize];
    ok(r.dpr === 2 && r.layout === "compact"
      && controls.every((c) => c && c.reachable && c.h >= 44),
    `compact-at-200% controls remain reachable (${JSON.stringify(r)})`);
    await zoomCtx.close();
  }
} finally {
  await ctx?.close();
  await browser.close();
  server.close();
}

console.log(`\n${failures.length ? `FAILED ${failures.length} check(s)` : "ALL CHECKS PASSED"}`);
if (failures.length) {
  for (const failure of failures) console.log(` - ${failure}`);
  process.exit(1);
}
