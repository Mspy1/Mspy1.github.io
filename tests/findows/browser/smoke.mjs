/* Gate 0/1 focused browser checks. Dev-only; never shipped as site runtime.
   Usage: node tests/findows/browser/smoke.mjs --base=http://127.0.0.1:PORT --out=DIR */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { browserType } from "./runtime.mjs";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const BASE = arg("base", "http://127.0.0.1:8791").replace(/\/$/, "");
const OUT = resolve(arg("out", ".superpowers/sdd/2026-11-24-findows/evidence"));
mkdirSync(OUT, { recursive: true });

let step = 0;
const failures = [];
const soft = process.argv.includes("--soft");
const log = (msg) => console.log(`[${String(++step).padStart(2, "0")}] ${msg}`);
const ok = (cond, msg) => {
  if (!cond) {
    console.log(`      FAIL ${msg}`);
    failures.push(msg);
    if (!soft) throw new Error(msg);
    return;
  }
  console.log(`      PASS ${msg}`);
};
const shot = (page, name) => page.screenshot({ path: resolve(OUT, name), fullPage: false });

async function openHelp(page) {
  await page.click("#fw-start");
  await page.fill("#fw-search", "help");
  await page.click("#fw-results button[data-app-id='help']");
  await page.waitForSelector(".fw-window[data-app-id='help'] .help-doc");
}

async function tabUntil(page, selector, limit = 40) {
  for (let i = 0; i < limit; i++) {
    if (await page.evaluate((s) => document.activeElement?.matches(s), selector)) return true;
    await page.keyboard.press("Tab");
  }
  return page.evaluate((s) => document.activeElement?.matches(s), selector);
}

const consoleErrors = [];
const badResponses = [];
const watch = (p) => {
  p.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  p.on("pageerror", (e) => consoleErrors.push(e.message));
  p.on("response", (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`); });
};

const engine = arg("browser", "chromium");
const browser = await browserType(engine).launch({ headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page);
  const homeRequests = [];
  page.on("request", (r) => homeRequests.push(r.url()));

  log("homepage baseline: no Findows assets before activation");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  ok(!homeRequests.some((u) => u.includes("/findows/")), "zero /findows/ requests on normal homepage load");
  const launcher = page.locator("#findows-easter-egg");
  ok((await launcher.count()) === 1, "footer launcher exists");
  const box = await launcher.boundingBox();
  ok(box && box.width >= 44 && box.height >= 44, `hit target is 44px+ (${box?.width}×${box?.height})`);
  const enName = await launcher.getAttribute("aria-label");
  ok(!!enName, `launcher has an accessible name: ${JSON.stringify(enName)}`);
  await page.click("[data-lang='tr']");
  const trName = await launcher.getAttribute("aria-label");
  ok(trName && trName !== enName, `accessible name localizes to Turkish: ${JSON.stringify(trName)}`);
  await page.click("[data-lang='de']");
  const deName = await launcher.getAttribute("aria-label");
  ok(deName && deName !== enName && deName !== trName, `accessible name localizes to German: ${JSON.stringify(deName)}`);
  await page.click("[data-lang='en']");

  log("homepage footer screenshots at 320 / 390 / 1440");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 640 : width === 390 ? 844 : 900 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(900);
    await shot(page, `home-${width}.png`);
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  log("explicit return focuses the launcher");
  const returnPage = await ctx.newPage();
  watch(returnPage);
  await returnPage.goto(BASE + "/#findows-easter-egg", { waitUntil: "load" });
  await returnPage.waitForTimeout(150);
  ok(
    (await returnPage.evaluate(() => document.activeElement?.id)) === "findows-easter-egg",
    "activeElement is the launcher after /#findows-easter-egg",
  );
  await returnPage.close();

  log("follow the launcher: route, noindex, shell and exit");
  await page.setViewportSize({ width: 1440, height: 900 });
  const routeRequests = [];
  const initialResponses = [];
  const collectInitial = (response) => {
    if (response.url().startsWith(BASE + "/findows/") && response.ok()) initialResponses.push(response);
  };
  page.on("request", (r) => routeRequests.push(r.url()));
  page.on("response", collectInitial);
  await launcher.click();
  await page.waitForURL("**/findows/**");
  await page.waitForLoadState("networkidle");
  page.off("response", collectInitial);
  await page.waitForSelector("#fw-desktop", { state: "visible" });
  ok((await page.locator("meta[name='robots']").getAttribute("content") || "").toLowerCase().includes("noindex"), "route is noindex");
  ok(await page.locator("#fw-brand").isVisible(), "brand renders before/with bootstrap");
  const exitHref = await page.locator("#fw-exit").getAttribute("href");
  ok(exitHref === "/#findows-easter-egg", "persistent exit link targets the launcher");
  ok(await page.locator("#fw-exit").isVisible(), "exit is visible on the desktop");
  const external = routeRequests.filter((u) => /^https?:\/\//.test(u) && !u.startsWith(BASE));
  ok(external.length === 0, `zero third-party requests (${external.join(", ") || "none"})`);
  ok(!routeRequests.some((url) => new URL(url).pathname.startsWith("/findows/js/apps/")), "app modules are fetched only when opened");
  const payloads = await Promise.all(initialResponses.map((response) => response.body()));
  const compressed = payloads.reduce((sum, payload) => sum + gzipSync(payload).length, 0);
  ok(payloads.length > 0 && compressed <= 180 * 1024, `initial shell gzip estimate ${Math.round(compressed / 1024)} KiB (budget 180 KiB)`);
  await page.goBack({ waitUntil: "domcontentloaded" });
  ok(new URL(page.url()).pathname === "/" && await launcher.count() === 1, "browser Back returns to the homepage");

  log("keyboard-only path: Tab → Start → search → Enter opens Help");
  await page.goto(BASE + "/findows/", { waitUntil: "load" });
  await page.waitForSelector("#fw-desktop");
  ok(await tabUntil(page, "#fw-start"), "Start reachable with Tab");
  await page.keyboard.press("Enter");
  ok(await page.locator("#fw-start-panel").isVisible(), "Enter opens Start");
  await page.keyboard.type("help");
  ok(await page.locator("#fw-results button[data-app-id='help']").isVisible(), "search finds Help");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".fw-window[data-app-id='help'] .help-doc");
  const helpText = (await page.locator(".fw-window[data-app-id='help']").innerText()).toLowerCase();
  ok(helpText.includes("keyboard") && helpText.includes("browser"), "Help content is real and readable");

  log("window controls and Escape scope");
  const win = page.locator(".fw-window[data-app-id='help']");
  await win.locator("[data-action='maximize']").click();
  ok((await win.getAttribute("data-state")) === "maximized", "maximize applies");
  const workBox = await page.locator(".fw-desktop-area").boundingBox();
  const maxBox = await win.boundingBox();
  ok(
    Math.abs(maxBox.x - workBox.x) <= 1 && Math.abs(maxBox.y - workBox.y) <= 1 &&
      Math.abs(maxBox.width - workBox.width) <= 1 && Math.abs(maxBox.height - workBox.height) <= 1,
    `maximized window matches the real work area (${Math.round(maxBox.width)}×${Math.round(maxBox.height)} vs ${Math.round(workBox.width)}×${Math.round(workBox.height)})`,
  );
  await win.locator("[data-action='restore']").click();
  ok((await win.getAttribute("data-state")) === "normal", "restore applies");

  log("snap exposes a direct Restore action");
  await win.locator("[data-action='snap-left']").click();
  ok((await win.getAttribute("data-state")) === "snapped-left", "snap-left applies");
  const snapRestoreVisible = await win.locator("[data-action='restore']").isVisible();
  ok(snapRestoreVisible, "Restore is visible while snapped");
  if (snapRestoreVisible) await win.locator("[data-action='restore']").click();
  ok((await win.getAttribute("data-state")) === "normal", "snap → restore works directly");
  await win.locator("[data-action='minimize']").click();
  ok(!(await win.isVisible()), "minimize keeps the app but hides its window");
  await page.click("#fw-taskbar [data-window-id]");
  ok(await win.isVisible(), "taskbar restores a minimized window");
  await page.click("#fw-start");
  await page.keyboard.press("Escape");
  ok(!(await page.locator("#fw-start-panel").isVisible()), "Escape dismisses Start");
  ok(await win.isVisible() && (await page.locator("#fw-brand").isVisible()), "Escape does not close the desktop or the app");
  await win.locator("[data-action='close']").click();
  ok((await page.locator(".fw-window").count()) === 0, "close removes the window");
  const afterClose = await page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("data-app-id"));
  ok(afterClose === "fw-start" || afterClose === "help", `focus returns to a launcher control (${afterClose})`);

  log("light/dark screenshots");
  for (const theme of ["dark", "light"]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`${BASE}/findows/`, { waitUntil: "load" });
    await page.waitForSelector("#fw-desktop");
    await openHelp(page);
    await page.waitForTimeout(180);
    ok((await page.locator("#fw-desktop").getAttribute("data-theme")) === theme, `${theme} theme applied`);
    await shot(page, `findows-${theme}-1440.png`);
  }

  log("two live apps: focus transfer between Help and the real Calculator");
  await page.goto(BASE + "/findows/", { waitUntil: "load" });
  await page.waitForSelector("#fw-desktop");
  await page.click(".fw-shortcut[data-app-id='help']");
  await page.click(".fw-shortcut[data-app-id='calculator']");
  await page.waitForSelector(".fw-window[data-app-id='calculator'] .calc-app");
  ok((await page.locator(".fw-window").count()) === 2, "two real app windows open simultaneously");
  const top = page.locator(".fw-window[data-app-id='calculator']");
  await top.locator("[data-action='close']").focus();
  await page.keyboard.press("Enter");
  ok((await page.locator(".fw-window").count()) === 1, "closing the top window leaves the other intact");
  const focusId = await page.locator(".fw-window[data-app-id='help']").getAttribute("data-focused");
  ok(focusId === "true", "remaining window becomes focused");
  const focusInsideFrame = await page.evaluate(() => {
    const active = document.activeElement;
    const frame = document.querySelector(".fw-window[data-app-id='help']");
    return Boolean(frame && document.contains(active) && frame.contains(active) && active.tagName === "H1");
  });
  ok(focusInsideFrame, "closing the top window focuses the remaining app's own heading, not a generic scroll host");
  await page.locator(".fw-window[data-app-id='help'] [data-action='close']").click();
  ok((await page.evaluate(() => document.activeElement?.getAttribute("data-app-id"))) === "help", "last close returns focus to the launching shortcut");

  log("Start arrow keys traverse every shipped result");
  await page.goto(BASE + "/findows/", { waitUntil: "load" });
  await page.waitForSelector("#fw-desktop");
  await page.click("#fw-start");
  const resultCount = await page.locator("#fw-results .fw-result").count();
  ok(resultCount >= 6, `Start lists the integrated apps (${resultCount})`);
  ok((await page.locator("#fw-results [aria-selected]").count()) === 0, "result buttons do not carry invalid aria-selected");
  await page.locator("#fw-search").focus();
  const visited = [];
  for (let i = 0; i < resultCount; i++) {
    await page.keyboard.press("ArrowDown");
    visited.push(await page.evaluate(() => document.activeElement?.dataset?.appId || null));
  }
  ok(new Set(visited).size === resultCount, `ArrowDown visits every result (${new Set(visited).size}/${resultCount}: ${visited.join(", ")})`);
  await page.keyboard.press("ArrowDown");
  ok(
    (await page.evaluate(() => document.activeElement?.dataset?.appId || null)) === visited[0],
    "ArrowDown wraps from the last result to the first",
  );
  await page.keyboard.press("Escape");
  ok(!(await page.locator("#fw-start-panel").isVisible()), "one Escape handler still dismisses Start");

  log("mounted Calculator: real module, CSS, pointer and keyboard paths");
  await page.goto(BASE + "/findows/?theme=dark", { waitUntil: "load" });
  await page.waitForSelector("#fw-desktop");
  await page.click("#fw-start");
  await page.fill("#fw-search", "calc");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".fw-window[data-app-id='calculator'] .calc-display");
  const calc = page.locator(".fw-window[data-app-id='calculator']");
  ok(await calc.locator(".calc-display").isVisible(), "Calculator display renders inside its shell window");
  for (const token of ["2", "+", "3", "*", "4", "="]) await calc.locator(`[data-token="${token}"]`).click();
  ok((await calc.locator(".calc-display").textContent()).trim() === "20", "pointer path: 2 + 3 × 4 = 20");
  await calc.locator(".calc-display").focus();
  await page.keyboard.type("7*8");
  await page.keyboard.press("Enter");
  ok((await calc.locator(".calc-display").textContent()).trim() === "56", "keyboard path: 7 × 8 = 56");

  log("services wiring: storage facade, launch closure and conditional unload guard");
  const api = await page.evaluate(async () => {
    const m = await import("/findows/js/main.mjs");
    return {
      hasFiles: Boolean(m.services.files),
      mode: m.services.files?.getStorageMode?.(),
      ready: typeof m.services.files?.ready === "function",
      openApp: typeof m.services.openApp === "function",
      setDirty: typeof m.services.setDirty === "function",
      guardActive: m.services.isUnloadGuardActive?.() ?? null,
    };
  });
  ok(api.hasFiles && api.ready && ["persistent", "temporary"].includes(api.mode), `services.files is storage-backed (${api.mode})`);
  const awaitedMode = await page.evaluate(async () => (await import("/findows/js/main.mjs")).services.ready());
  ok(["persistent", "temporary"].includes(awaitedMode), `an app can await storage readiness (${awaitedMode})`);
  ok(api.openApp && api.setDirty, "services exposes openApp and setDirty for later apps");
  ok(api.guardActive === false, "beforeunload guard is absent while every window is clean");

  const opened = await page.evaluate(async () => {
    const m = await import("/findows/js/main.mjs");
    const first = m.services.openApp("calculator", { mode: "standard" });
    const second = m.services.openApp("calculator", { mode: "standard" });
    return { first, second, count: document.querySelectorAll(".fw-window").length };
  });
  ok(opened.first && opened.first === opened.second && opened.count === 1, "services.openApp dedupes by app + mode, not title");

  log("dirty state follows the window, not focus; guard attaches only while dirty");
  await page.evaluate(async (id) => {
    const m = await import("/findows/js/main.mjs");
    m.services.setDirty(id, true);
  }, opened.first);
  const dirtyFrame = page.locator(`.fw-window[data-window-id="${opened.first}"]`);
  ok((await dirtyFrame.getAttribute("data-dirty")) === "true", "dirty flag is reflected on the owning window");
  ok((await page.evaluate(async () => (await import("/findows/js/main.mjs")).services.isUnloadGuardActive?.())) === true, "beforeunload guard attaches while dirty");
  await page.click(".fw-shortcut[data-app-id='help']");
  ok((await dirtyFrame.getAttribute("data-dirty")) === "true", "losing focus does not clear a dirty editor");
  await page.evaluate(async (id) => (await import("/findows/js/main.mjs")).services.setDirty(id, false), opened.first);
  ok((await dirtyFrame.getAttribute("data-dirty")) === "false", "clean state is reflected after save");
  ok((await page.evaluate(async () => (await import("/findows/js/main.mjs")).services.isUnloadGuardActive?.())) === false, "beforeunload guard detaches when no window is dirty");

  log("async canClose is awaited and rapid close clicks are serialized");
  await page.evaluate(async () => {
    const m = await import("/findows/js/main.mjs");
    window.__closeCalls = 0;
    window.__nativeConfirmCalls = 0;
    window.confirm = () => { window.__nativeConfirmCalls++; return true; };
    m.registry.registerApp({
      id: "close-probe", title: "Close probe", keywords: [], icon: "help", singleton: true, accepts: [],
      minSize: { width: 320, height: 200 }, pinned: false, testOnly: true,
      load: async () => ({
        mount: async ({ container }) => {
          const p = document.createElement("p");
          p.className = "close-probe";
          p.textContent = "Close probe";
          container.replaceChildren(p);
          // Simulate a still-loading editor: the shell must wait for its guard.
          await window.__mountDecision;
          return { canClose: async () => { window.__closeCalls++; return await window.__closeDecision; }, focus() {}, dispose() {} };
        },
      }),
    });
    window.__mountDecision = new Promise((resolve) => { window.__resolveMount = resolve; });
    window.__closeDecision = new Promise((resolve) => { window.__resolveClose = resolve; });
    window.__probeId = m.services.openApp("close-probe");
    m.services.setDirty(window.__probeId, true);
  });
  await page.waitForSelector('.fw-window[data-app-id="close-probe"] .close-probe');
  const probeClose = page.locator('.fw-window[data-app-id="close-probe"] [data-action="close"]');
  await probeClose.click();
  await probeClose.click();
  await page.waitForTimeout(60);
  ok((await page.evaluate(() => window.__closeCalls)) === 0, "a loading dirty editor is not closed before its guard exists");
  await page.evaluate(() => window.__resolveMount());
  await page.waitForTimeout(60);
  ok((await page.evaluate(() => window.__closeCalls)) === 1, "two rapid close clicks call canClose exactly once after load");
  ok((await page.locator('.fw-window[data-app-id="close-probe"]').count()) === 1, "the window stays until the async guard resolves");
  await page.evaluate(() => window.__resolveClose(true));
  await page.waitForTimeout(60);
  ok((await page.locator('.fw-window[data-app-id="close-probe"]').count()) === 0, "accepted close removes the window");

  await page.evaluate(async () => {
    const m = await import("/findows/js/main.mjs");
    window.__closeCalls = 0;
    window.__mountDecision = Promise.resolve();
    window.__closeDecision = new Promise((resolve) => { window.__resolveClose = resolve; });
    window.__probeId = m.services.openApp("close-probe");
    m.services.setDirty(window.__probeId, true);
  });
  await page.waitForSelector('.fw-window[data-app-id="close-probe"] .close-probe');
  await probeClose.click();
  await probeClose.click();
  await page.evaluate(() => window.__resolveClose(false));
  await page.waitForTimeout(60);
  ok((await page.locator('.fw-window[data-app-id="close-probe"]').count()) === 1, "a cancelled close keeps the window");
  ok((await page.locator(`.fw-window[data-window-id="${await page.evaluate(() => window.__probeId)}"]`).getAttribute("data-dirty")) === "true", "dirty state survives a cancelled close");
  await page.evaluate(async () => {
    const m = await import("/findows/js/main.mjs");
    m.services.setDirty(window.__probeId, false);
  });

  log("explicit Back confirms only while dirty, with no second native confirm");
  await page.evaluate(async () => (await import("/findows/js/main.mjs")).services.setDirty(window.__probeId, true));
  await page.click("#fw-exit");
  await page.waitForSelector(".fw-confirm", { state: "visible" });
  ok(page.url().includes("/findows/"), "dirty exit stays on the desktop until the visitor decides");
  ok((await page.evaluate(() => window.__nativeConfirmCalls)) === 0, "explicit exit uses the in-app dialog, not window.confirm");
  await page.click('.fw-confirm [data-choice="stay"]');
  ok(page.url().includes("/findows/"), "Stay keeps the desktop and its editors");
  await page.click("#fw-exit");
  await page.waitForSelector(".fw-confirm", { state: "visible" });
  await page.click('.fw-confirm [data-choice="leave"]');
  await page.waitForURL("**/#findows-easter-egg");
  ok((await page.evaluate(() => document.activeElement?.id)) === "findows-easter-egg", "accepted exit focuses the launcher without a second prompt");

  log("Notepad → Files → reload: the same saved file opens in the existing editor");
  await page.goto(BASE + "/findows/");
  await page.click(".fw-shortcut[data-app-id='notepad']");
  let note = page.locator(".fw-window[data-app-id='notepad']");
  const text = "Findows local save — notes 🖥️";
  await note.locator(".np-editor").fill(text);
  await note.locator(".np-save-as").click();
  await note.locator(".np-save-name").fill("shell-integration.txt");
  await note.locator('.np-save-dialog [data-action="create"]').click();
  await note.locator(".np-status").filter({ hasText: "Saved" }).waitFor();
  await page.click(".fw-shortcut[data-app-id='files']");
  let filesWindow = page.locator(".fw-window[data-app-id='files']");
  await filesWindow.locator(".files-place[data-place='documents']").click();
  await filesWindow.getByRole("button", { name: "Open shell-integration.txt", exact: true }).click();
  ok(await note.count() === 1, "opening a just-saved note focuses the existing Notepad instance");
  ok(await note.locator(".np-editor").inputValue() === text, "saved Unicode content is exact");
  await page.reload();
  await page.click(".fw-shortcut[data-app-id='files']");
  filesWindow = page.locator(".fw-window[data-app-id='files']");
  await filesWindow.locator(".files-place[data-place='documents']").click();
  await filesWindow.getByRole("button", { name: "Open shell-integration.txt", exact: true }).click();
  note = page.locator(".fw-window[data-app-id='notepad']");
  await page.waitForFunction((expected) => document.querySelector(".np-editor")?.value === expected, text);
  ok(await note.locator(".np-editor").inputValue() === text, "reloading and reopening from Files restores saved content");
  await shot(page, "findows-notepad-files-1440.png");

  log("Diagnostics reads real shell window counts");
  await page.click("#fw-start");
  await page.fill("#fw-search", "diagnostics");
  await page.click("#fw-results button[data-app-id='diagnostics']");
  const diag = page.locator(".fw-window[data-app-id='diagnostics']");
  await diag.locator(".diag-windows").filter({ hasText: /^3$/ }).waitFor();
  await page.evaluate(async () => (await import("/findows/js/main.mjs")).services.openApp("help"));
  await diag.locator(".diag-windows").filter({ hasText: /^4$/ }).waitFor();
  ok(true, "Diagnostics updates when a real window opens");

  log("Minesweeper mounts the real board and supports explicit flag mode");
  await page.click("#fw-start");
  await page.fill("#fw-search", "minesweeper");
  await page.click("#fw-results button[data-app-id='minesweeper']");
  const mines = page.locator(".fw-window[data-app-id='minesweeper']");
  await mines.locator(".ms-cell").first().waitFor();
  ok(await mines.locator(".ms-cell").count() === 81, "beginner board has 81 cells");
  await mines.locator(".ms-mode").click();
  await mines.locator(".ms-cell").first().click();
  ok(await mines.locator(".ms-cell--flag").count() === 1, "flag mode acts without a long press");
  await mines.locator(".ms-mode").click();
  await mines.locator(".ms-cell").nth(40).click();
  ok(await mines.locator(".ms-cell--open").count() > 0, "first reveal is safe");

  log("Sticky Notes autosaves in the mounted desktop");
  await page.click("#fw-start");
  await page.fill("#fw-search", "sticky notes");
  await page.click("#fw-results button[data-app-id='sticky-notes']");
  const sticky = page.locator(".fw-window[data-app-id='sticky-notes']");
  await sticky.locator(".sn-new").click();
  await sticky.locator(".sn-text").fill("Mounted Sticky Notes check");
  await sticky.locator(".sn-status").filter({ hasText: /\bSaved\b/ }).waitFor();
  await page.reload();
  await page.click("#fw-start");
  await page.fill("#fw-search", "sticky notes");
  await page.click("#fw-results button[data-app-id='sticky-notes']");
  await page.waitForFunction(() => document.querySelector(".sn-text")?.value === "Mounted Sticky Notes check");
  ok(true, "the committed sticky note survives reload");

  log("Paint saves a real drawing to Files");
  await page.click("#fw-start");
  await page.fill("#fw-search", "paint");
  await page.click("#fw-results button[data-app-id='paint']");
  const paint = page.locator(".fw-window[data-app-id='paint']");
  const canvas = paint.locator(".paint-canvas");
  await canvas.waitFor();
  const drawingArea = await canvas.boundingBox();
  await page.mouse.move(drawingArea.x + drawingArea.width * 0.3, drawingArea.y + drawingArea.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(drawingArea.x + drawingArea.width * 0.55, drawingArea.y + drawingArea.height * 0.55, { steps: 15 });
  await page.mouse.up();
  await paint.locator('[data-action="save"]').click();
  await paint.locator(".paint-save-name").fill("shell-drawing.png");
  await paint.locator('.paint-dialog [data-action="create"]').click();
  await paint.locator(".paint-status").filter({ hasText: /\bSaved\b/ }).waitFor();
  const drawing = await page.evaluate(async () => {
    const { services } = await import("/findows/js/main.mjs");
    const entry = (await services.files.list("documents")).find((item) => item.name === "shell-drawing.png");
    if (!entry) return null;
    const decoded = await createImageBitmap(entry.blob);
    const sample = document.createElement("canvas");
    sample.width = decoded.width;
    sample.height = decoded.height;
    const context = sample.getContext("2d");
    context.drawImage(decoded, 0, 0);
    decoded.close();
    const image = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
    const hasInk = Array.from(image.data).some((byte, index) => index % 4 !== 3 && byte < 200);
    return { type: entry.mediaType, width: sample.width, height: sample.height, hasInk };
  });
  ok(drawing?.type === "image/png" && drawing.width === 1024 && drawing.height === 768 && drawing.hasInk, "saved PNG contains actual drawn pixels at 1024×768");
  await shot(page, "findows-paint-1440.png");

  log("Files → Photo Viewer → Paint copy: the imported original is not overwritten");
  const imported = await page.evaluate(async () => {
    const { services } = await import("/findows/js/main.mjs");
    const source = (await services.files.list("documents")).find((item) => item.name === "shell-drawing.png");
    return services.files.create({
      parentId: "documents", name: "imported-drawing.png", kind: "file",
      mediaType: source.mediaType, blob: source.blob, origin: "import",
    });
  });
  await page.click(".fw-shortcut[data-app-id='files']");
  filesWindow = page.locator(".fw-window[data-app-id='files']");
  await filesWindow.locator(".files-place[data-place='documents']").click();
  await filesWindow.getByRole("button", { name: "Open imported-drawing.png", exact: true }).click();
  const viewer = page.locator(".fw-window[data-app-id='photo-viewer']");
  await viewer.locator(".pv-canvas").waitFor();
  const imageFingerprint = () => page.evaluate(async (name) => {
    const { services } = await import("/findows/js/main.mjs");
    const entry = (await services.files.list("documents")).find((item) => item.name === name);
    return JSON.stringify([entry.id, entry.revision, [...new Uint8Array(await crypto.subtle.digest("SHA-256", await entry.blob.arrayBuffer()))]]);
  }, imported.name);
  const originalFingerprint = await imageFingerprint();
  await viewer.getByRole("button", { name: "Edit a copy in Paint", exact: true }).click();
  const copyPaint = page.locator(".fw-window[data-app-id='paint'][data-focused='true']");
  await copyPaint.locator(".paint-canvas").waitFor();
  await copyPaint.locator('[data-action="save"]').click();
  await copyPaint.locator(".paint-save-name").fill("shell-drawing-copy.png", { timeout: 5000 });
  await copyPaint.locator('.paint-dialog [data-action="create"]').click();
  await copyPaint.locator(".paint-status").filter({ hasText: /\bSaved\b/ }).waitFor();
  ok(await imageFingerprint() === originalFingerprint, "editing a copy preserves the source revision and PNG bytes");

  log("compact layout: 390×844 and short landscape");
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(engine !== "firefox" ? { isMobile: true } : {}), hasTouch: true, colorScheme: "dark" });
  const mp = await mobile.newPage();
  watch(mp);
  await mp.goto(BASE + "/findows/", { waitUntil: "load" });
  await mp.waitForSelector("#fw-desktop");
  ok((await mp.locator("#fw-desktop").getAttribute("data-layout")) === "compact", "phone uses compact layout");
  ok(await mp.locator("#fw-start").isVisible() && await mp.locator("#fw-exit").isVisible(), "Start and exit stay reachable");
  await mp.click("#fw-start");
  await mp.fill("#fw-search", "help");
  await mp.click("#fw-results button[data-app-id='help']");
  await mp.waitForSelector(".fw-window[data-app-id='help']");
  ok((await mp.locator(".fw-window:visible").count()) === 1, "single foreground app on phone");
  ok(await mp.locator("#fw-switcher").isVisible(), "task switcher reachable on phone");
  await shot(mp, "findows-mobile-390.png");
  await mp.setViewportSize({ width: 844, height: 390 });
  ok((await mp.locator("#fw-desktop").getAttribute("data-layout")) === "compact", "short landscape stays compact");
  await shot(mp, "findows-landscape-844x390.png");
  ok(await mp.locator(".fw-window[data-app-id='help']").isVisible(), "app state survives rotation");
  await mobile.close();

  log("768px boundary and reduced-motion preference");
  await page.setViewportSize({ width: 768, height: 500 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(BASE + "/findows/");
  await page.waitForSelector("#fw-desktop[data-layout='wide'][data-reduce-motion='true']");
  await page.setViewportSize({ width: 767, height: 500 });
  await page.waitForSelector("#fw-desktop[data-layout='compact']");
  ok(await page.locator("#fw-start").isVisible() && await page.locator("#fw-exit").isVisible(), "at the compact breakpoint, Start and exit stay reachable with reduced motion");
  await page.setViewportSize({ width: 720, height: 500 });
  await openHelp(page);
  ok(await page.locator("#fw-exit").isVisible(), "exit remains available at a 720 CSS px effective width");

  log("200% effective zoom: navigation and exit stay reachable");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(BASE + "/findows/");
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await page.locator("#fw-start").waitFor({ state: "visible" });
  ok(await page.locator("#fw-start").isVisible() && await page.locator("#fw-exit").isVisible(), "Start and exit are reachable at 200% zoom");
  await page.click("#fw-start");
  ok(await page.locator("#fw-search").isVisible(), "Start search stays usable at 200% zoom");
  await page.keyboard.press("Escape");
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });

  log("no console errors and no failed responses");
  ok(consoleErrors.length === 0, `zero console/page errors (${consoleErrors.join(" | ") || "none"})`);
  ok(badResponses.length === 0, `zero HTTP failures (${badResponses.join(" | ") || "none"})`);

  if (failures.length) {
    console.error(`BROWSER CHECKS FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    log("ALL BROWSER CHECKS PASSED");
  }
  await ctx.close();
} catch (err) {
  console.error(`BROWSER CHECK FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
