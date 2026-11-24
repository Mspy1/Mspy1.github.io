/* Gate 5 focused shell accessibility checks. Dev-only; no private paths and
   no shipped runtime. Uses a local Playwright module via FINDOWS_PLAYWRIGHT_MODULE.
   Usage: node tests/findows/browser/shell-a11y.mjs --port=8848 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./runtime.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const portArg = process.argv.find((a) => a.startsWith("--port="));
const PORT = portArg ? Number(portArg.slice(7)) : 8848;
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
  const freshPage = async () => {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log(`  PAGEERROR ${e.message}`));
    await page.goto(`${BASE}/findows/`, { waitUntil: "load" });
    await page.waitForSelector("#fw-desktop");
    return page;
  };
  const open = (page, appId) => page.evaluate(async (id) => {
    const m = await import("/findows/js/main.mjs");
    return m.services.openApp(id);
  }, appId);

  log("A11Y-SHELL-01/02 confirm dialog traps Tab and restores invoker focus");
  {
    const page = await freshPage();
    await open(page, "notepad");
    await page.waitForSelector('.fw-window[data-app-id="notepad"]');
    await page.evaluate(async () => {
      const m = await import("/findows/js/main.mjs");
      const id = m.wm.getState().find((w) => w.appId === "notepad").id;
      m.services.setDirty(id, true);
    });
    await page.focus("#fw-exit");
    await page.click("#fw-exit");
    await page.waitForSelector(".fw-confirm");

    const chain = [];
    for (let i = 0; i < 5; i++) {
      chain.push(await page.evaluate(() => {
        const overlay = document.querySelector(".fw-confirm");
        const active = document.activeElement;
        return {
          text: (active?.textContent || "").trim().slice(0, 16),
          inConfirm: !!overlay?.contains(active),
        };
      }));
      await page.keyboard.press("Tab");
    }
    ok(chain.every((x) => x.inConfirm),
      `Tab stays inside confirm (${chain.map((x) => `${x.text}:${x.inConfirm}`).join(" -> ")})`);
    await page.keyboard.press("Shift+Tab");
    ok(await page.evaluate(() => document.querySelector(".fw-confirm")?.contains(document.activeElement)),
      "Shift+Tab stays inside confirm");
    await page.keyboard.press("Escape");
    ok(await page.evaluate(() => document.activeElement?.id === "fw-exit"),
      "Escape restores focus to the exit link that opened the dialog");
    await page.close();
  }

  log("A11Y-SHELL-03 Escape from Switch apps returns to Switch apps");
  {
    const page = await freshPage();
    await open(page, "help");
    await page.waitForSelector('.fw-window[data-app-id="help"]');
    await page.click("#fw-switcher");
    const opened = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        inSwitcher: !!document.querySelector("#fw-switcher-panel")?.contains(active),
        cls: active?.className || "",
      };
    });
    ok(opened.inSwitcher, `switcher opens with focus on its first result (${opened.cls})`);
    await page.keyboard.press("Escape");
    ok(await page.evaluate(() => document.activeElement?.id === "fw-switcher"),
      "Escape focuses the Switch apps button, not Start");
    await page.close();
  }

  log("A11Y-SHELL-04 keyboard window controls keep focus after state change");
  {
    const page = await freshPage();
    await open(page, "calculator");
    await page.waitForSelector('.fw-window[data-app-id="calculator"] .calc-display');
    const snap = () => page.evaluate(async () => {
      const m = await import("/findows/js/main.mjs");
      const state = m.wm.getState().find((w) => w.appId === "calculator");
      const active = document.activeElement;
      return {
        state: state?.state,
        body: active === document.body,
        action: active?.dataset?.action || null,
        frameHidden: !!document.querySelector('.fw-window[data-app-id="calculator"]')?.hidden,
      };
    });
    await page.locator('.fw-window[data-app-id="calculator"] [data-action="maximize"]').focus();
    await page.keyboard.press("Enter");
    let r = await snap();
    ok(r.state === "maximized" && !r.body, `maximize keeps focus (${JSON.stringify(r)})`);
    await page.locator('.fw-window[data-app-id="calculator"] [data-action="restore"]').focus();
    await page.keyboard.press("Enter");
    r = await snap();
    ok(r.state === "normal" && !r.body, `restore keeps focus (${JSON.stringify(r)})`);
    await page.locator('.fw-window[data-app-id="calculator"] [data-action="minimize"]').focus();
    await page.keyboard.press("Enter");
    r = await snap();
    ok(r.state === "minimized" && !r.body, `minimize keeps focus (${JSON.stringify(r)})`);
    await page.close();
  }

  log("A11Y-SHELL-05 taskbar re-render preserves the focused taskbar button");
  {
    const page = await freshPage();
    await open(page, "help");
    await open(page, "calculator");
    await page.waitForSelector("#fw-task-items .fw-task-item");
    const r = await page.evaluate(async () => {
      const m = await import("/findows/js/main.mjs");
      const first = document.querySelector("#fw-task-items .fw-task-item");
      first.focus();
      const app = first.dataset.appId;
      const other = m.wm.getState().find((w) => w.appId !== app);
      if (other) m.wm.dispatch({ type: "SNAP", id: other.id, side: "left" });
      const active = document.activeElement;
      return {
        app,
        activeApp: active?.dataset?.appId || null,
        isTask: active?.classList?.contains("fw-task-item") || false,
        body: active === document.body,
      };
    });
    ok(r.isTask && r.activeApp === r.app && !r.body,
      `focused taskbar button survives re-render (${JSON.stringify(r)})`);
    await page.close();
  }

  log("A11Y-SHELL-06 compact foreground switch moves focus into the incoming app");
  {
    const page = await freshPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "help");
    await open(page, "calculator");
    await page.waitForSelector('.fw-window[data-app-id="calculator"] .calc-display');
    await page.evaluate(async () => {
      const m = await import("/findows/js/main.mjs");
      const calc = m.wm.getState().find((w) => w.appId === "calculator");
      m.wm.dispatch({ type: "FOCUS", id: calc.id });
    });
    await page.locator('.fw-window[data-app-id="calculator"] .calc-display').focus();
    ok(!(await page.evaluate(() => document.activeElement === document.body)),
      "focus starts inside the foreground window");
    await page.locator('#fw-task-items .fw-task-item[data-app-id="help"]').click();
    const r = await page.evaluate(() => {
      const active = document.activeElement;
      const help = document.querySelector('.fw-window[data-app-id="help"]');
      return {
        body: active === document.body,
        inHelp: !!help?.contains(active),
        foreground: help?.dataset.foreground || null,
      };
    });
    ok(!r.body && r.inHelp && r.foreground === "true",
      `foreground switch moves focus into Help (${JSON.stringify(r)})`);
    await page.close();
  }

  log("A11Y-SHELL-07 role-less groups expose roles and labels");
  {
    const page = await freshPage();
    const r = await page.evaluate(() => {
      const read = (selector) => {
        const node = document.querySelector(selector);
        return { role: node?.getAttribute("role") || null, label: node?.getAttribute("aria-label") || null };
      };
      return {
        results: read("#fw-results"),
        switcher: read("#fw-switcher-list"),
        task: read("#fw-task-items"),
        recent: read("#fw-recent"),
      };
    });
    ok(r.results.role === "group" && r.results.label === "Apps",
      `Start results group (${JSON.stringify(r.results)})`);
    ok(r.switcher.role === "group" && !!r.switcher.label,
      `Switcher list group (${JSON.stringify(r.switcher)})`);
    ok(r.task.role === "group" && r.task.label === "Running apps",
      `Taskbar running-apps group (${JSON.stringify(r.task)})`);
    ok(r.recent.role === "group" && !!r.recent.label,
      `Recent files group (${JSON.stringify(r.recent)})`);
    await page.close();
  }

  log("A11Y-SHELL-08 new and restored windows receive DOM focus");
  {
    const page = await freshPage();
    await open(page, "calculator");
    await page.waitForSelector('.fw-window[data-app-id="calculator"] .calc-display');
    const opened = await page.evaluate(() => {
      const active = document.activeElement;
      const frame = document.querySelector('.fw-window[data-app-id="calculator"]');
      return { body: active === document.body, inFrame: !!frame?.contains(active) };
    });
    ok(!opened.body && opened.inFrame, `new window receives focus (${JSON.stringify(opened)})`);
    await page.evaluate(async () => {
      const m = await import("/findows/js/main.mjs");
      const id = m.wm.getState().find((w) => w.appId === "calculator").id;
      m.wm.dispatch({ type: "MINIMIZE", id });
    });
    await page.locator('#fw-task-items .fw-task-item[data-app-id="calculator"]').click();
    const restored = await page.evaluate(() => {
      const active = document.activeElement;
      const frame = document.querySelector('.fw-window[data-app-id="calculator"]');
      return {
        body: active === document.body,
        inFrame: !!frame?.contains(active),
        hidden: !!frame?.hidden,
      };
    });
    ok(!restored.body && restored.inFrame && !restored.hidden,
      `restored window receives focus (${JSON.stringify(restored)})`);
    await page.close();
  }
  log("L1 shell.stop() releases its window-manager subscription");
  {
    const page = await freshPage();
    const r = await page.evaluate(async () => {
      const main = await import("/findows/js/main.mjs");
      const { createShell } = await import("/findows/js/shell.mjs");
      const { createWindowManager } = await import("/findows/js/window-manager.mjs");
      const source = document.querySelector("#fw-desktop");
      let subscribeCalls = 0;
      let unsubscribeCalls = 0;
      const cycles = 6;
      for (let i = 0; i < cycles; i++) {
        const root = source.cloneNode(true);
        root.id = `fw-desktop-a11y-probe-${i}`;
        document.body.append(root);
        const wm = createWindowManager({ workArea: { width: 1440, height: 800 }, maxWindows: 8 });
        const nativeSubscribe = wm.subscribe.bind(wm);
        wm.subscribe = (listener) => {
          subscribeCalls++;
          const off = nativeSubscribe(listener);
          return () => { unsubscribeCalls++; off(); };
        };
        const shell = createShell({ root, registry: main.registry, wm, services: main.services });
        shell.start();
        shell.stop();
        root.remove();
      }
      return { cycles, subscribeCalls, unsubscribeCalls, leaked: subscribeCalls - unsubscribeCalls };
    });
    ok(r.leaked === 0 && r.subscribeCalls === r.cycles,
      `every started shell releases its render listener (${JSON.stringify(r)})`);
    await page.close();
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
