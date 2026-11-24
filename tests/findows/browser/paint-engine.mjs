/* Gate 3: Paint drawing-model checks on a real Canvas 2D context and real PNG decode.
   Dev-only; never shipped. Usage:
     node tests/findows/browser/paint-engine.mjs [--port=8797] [--playwright=PATH]
   Requires Node 20+ and an installed Playwright/Chromium. Serves this repo on 127.0.0.1:8797.
   Set FINDOWS_PLAYWRIGHT_MODULE when the Playwright package is outside this checkout. */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { loadPlaywright } from "./runtime.mjs";

const ROOT = resolve(process.cwd());
const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", "8797"));
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

const HARNESS_HTML =
  "<!doctype html><meta charset=\"utf-8\"><title>paint engine harness</title><body style=\"margin:0\">paint harness</body>";

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/__paint-harness.html") {
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
console.log(`paint engine harness serving ${ROOT} at ${BASE}`);

let failures = 0;
function report(label, checks) {
  for (const entry of checks || []) {
    console.log(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.label}${entry.info ? ` - ${entry.info}` : ""}`);
    if (!entry.pass) failures++;
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto(`${BASE}/__paint-harness.html`, { waitUntil: "load" });

  console.log("\n[paint drawing model]");
  const checks = await page.evaluate(async () => {
    const mod = await import("/findows/js/apps/paint-engine.mjs");
    const checks = [];
    const check = (label, pass, info = "") => checks.push({ label, pass: Boolean(pass), info: String(info) });
    const WHITE = [255, 255, 255, 255];
    const RED = [255, 0, 0, 255];
    const contextOf = (engine) => engine.canvas.getContext("2d");
    const px = (engine, x, y) => Array.from(contextOf(engine).getImageData(x, y, 1, 1).data);
    const isColor = (value, expected) => value.every((part, index) => part === expected[index]);
    const hash = (engine) => {
      const state = engine.getState();
      const data = contextOf(engine).getImageData(0, 0, state.width, state.height).data;
      let value = 2166136261 >>> 0;
      for (let i = 0; i < data.length; i += 4) {
        value ^= (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0;
        value = Math.imul(value, 16777619) >>> 0;
      }
      return value;
    };
    const throwsType = (fn, Type) => {
      try {
        fn();
        return false;
      } catch (error) {
        return error instanceof Type;
      }
    };

    /* 1. Fixed document, clean baseline. */
    {
      const engine = mod.createPaintEngine();
      const state = engine.getState();
      check("default document is the fixed 1024x768 canvas", state.width === 1024 && state.height === 768);
      check("new document starts on the opaque background", isColor(px(engine, 0, 0), WHITE) && isColor(px(engine, 1023, 767), WHITE));
      check("new document has one baseline snapshot and nothing to undo", state.historyStates === 1 && state.historyBytes === mod.undoSnapshotBytes() && !state.canUndo);
      check("engine exposes the backing canvas", engine.canvas instanceof HTMLCanvasElement);
    }

    /* 2. Brush, eraser, exact pixels, undo/redo of erasure. */
    {
      const engine = mod.createPaintEngine();
      engine.setColor("#ff0000");
      engine.setLineWidth(30);
      engine.beginStroke({ x: 512, y: 384 });
      engine.endStroke();
      check("brush paints the pixel it was given", isColor(px(engine, 512, 384), RED));
      check("brush leaves the rest of the canvas untouched", isColor(px(engine, 0, 0), WHITE));
      engine.setTool("eraser");
      engine.setLineWidth(40);
      engine.beginStroke({ x: 512, y: 384 });
      engine.endStroke();
      check("eraser restores the document background", isColor(px(engine, 512, 384), WHITE));
      check("each committed operation is one undo step", engine.getState().undoDepth === 2);
      engine.undo();
      check("undo restores the erased pixel", isColor(px(engine, 512, 384), RED));
      engine.redo();
      check("redo re-applies the erase", isColor(px(engine, 512, 384), WHITE));
    }

    /* 3. Pointer conversion at 50% CSS zoom. */
    {
      const display = document.createElement("canvas");
      display.style.width = "512px";
      display.style.height = "384px";
      display.style.display = "block";
      document.body.append(display);
      const engine = mod.createPaintEngine({ canvas: display });
      const rect = display.getBoundingClientRect();
      const point = engine.pointFromEvent({ clientX: rect.left + 64, clientY: rect.top + 48 });
      check(
        "a pointer at 64,48 in a 512x384 box maps to logical 128,96",
        point.x === 128 && point.y === 96,
        JSON.stringify(point),
      );
      engine.setColor("#00aa00");
      engine.setLineWidth(12);
      engine.beginStroke(point);
      engine.endStroke();
      check("the mapped pixel is the pixel that gets painted", isColor(px(engine, 128, 96), [0, 170, 0, 255]));
      const edge = engine.pointFromEvent({ clientX: rect.left + rect.width, clientY: rect.top + rect.height });
      check("the displayed far edge clamps to 1023,767", edge.x === 1023 && edge.y === 767, JSON.stringify(edge));
      display.remove();
    }

    /* 4. Line, rectangle, ellipse geometry. */
    {
      const engine = mod.createPaintEngine();
      engine.setTool("line");
      engine.setColor("#0000ff");
      engine.setLineWidth(8);
      engine.beginStroke({ x: 100, y: 100 });
      engine.extendStroke({ x: 300, y: 300 });
      engine.endStroke();
      check("line follows the drag", isColor(px(engine, 200, 200), [0, 0, 255, 255]));
      check("line leaves unrelated pixels untouched", isColor(px(engine, 600, 100), WHITE));

      engine.setTool("rect");
      engine.setColor("#ff00ff");
      engine.setLineWidth(8);
      engine.beginStroke({ x: 100, y: 100 });
      engine.extendStroke({ x: 300, y: 200 });
      engine.endStroke();
      check("rectangle renders its border", isColor(px(engine, 200, 100), [255, 0, 255, 255]));
      check("rectangle leaves its interior untouched", isColor(px(engine, 200, 150), WHITE));

      engine.setTool("ellipse");
      engine.setColor("#00bcd4");
      engine.setLineWidth(8);
      engine.beginStroke({ x: 400, y: 300 });
      engine.extendStroke({ x: 600, y: 500 });
      engine.endStroke();
      check("ellipse leaves its centre untouched", isColor(px(engine, 500, 400), WHITE));
      let curved = false;
      for (let x = 392; x <= 412; x += 1) {
        if (!isColor(px(engine, x, 400), WHITE)) curved = true;
      }
      check("ellipse renders its curved border", curved);
      check("a click with a shape tool commits nothing", (() => {
        const fresh = mod.createPaintEngine();
        fresh.setTool("rect");
        fresh.beginStroke({ x: 400, y: 400 });
        fresh.endStroke();
        return fresh.getState().undoDepth === 0 && isColor(px(fresh, 400, 400), WHITE);
      })());
    }

    /* 5. Canceling a stroke without committing. */
    {
      const engine = mod.createPaintEngine();
      engine.setColor("#ff0000");
      engine.setLineWidth(20);
      engine.beginStroke({ x: 100, y: 100 });
      engine.endStroke();
      const before = hash(engine);
      const undoBefore = engine.getState().undoDepth;
      engine.beginStroke({ x: 800, y: 600 });
      engine.extendStroke({ x: 900, y: 700 });
      check("an in-progress stroke is reported", engine.getState().strokeActive === true);
      check("cancelStroke reports the cancellation", engine.cancelStroke() === true);
      check("canceled preview leaves every pixel unchanged", hash(engine) === before);
      check("canceled stroke adds no undo step", engine.getState().undoDepth === undoBefore);
      check("cancel with no active stroke is a safe no-op", engine.cancelStroke() === false);
    }

    /* 6. Undo/redo restore exact pixels and redo branches are dropped. */
    {
      const engine = mod.createPaintEngine();
      const blank = hash(engine);
      engine.setColor("#ff0000");
      engine.setLineWidth(20);
      engine.beginStroke({ x: 100, y: 100 });
      engine.endStroke();
      const first = hash(engine);
      engine.setColor("#0000ff");
      engine.beginStroke({ x: 500, y: 400 });
      engine.endStroke();
      const second = hash(engine);
      engine.undo();
      check("undo restores the previous pixels exactly", hash(engine) === first);
      engine.undo();
      check("undo returns to the blank document", hash(engine) === blank);
      check("undo stops at the oldest retained state", engine.undo() === false);
      check("redo becomes available after undo", engine.getState().canRedo === true);
      engine.redo();
      check("redo restores the first stroke", hash(engine) === first);
      engine.redo();
      check("redo restores the second stroke", hash(engine) === second);
      check("redo stops at the newest state", engine.redo() === false);
      engine.undo();
      engine.setColor("#00ff00");
      engine.beginStroke({ x: 800, y: 600 });
      engine.endStroke();
      check("a new stroke drops the redo branch", engine.getState().canRedo === false);
    }

    /* 7. Clear is undoable. */
    {
      const engine = mod.createPaintEngine();
      const blank = hash(engine);
      engine.setColor("#ff0000");
      engine.setLineWidth(20);
      engine.beginStroke({ x: 200, y: 200 });
      engine.endStroke();
      const painted = hash(engine);
      engine.clear();
      check("clear empties the canvas", hash(engine) === blank);
      check("clear can be undone", engine.undo() === true && hash(engine) === painted);
    }

    /* 8. Real snapshot budget: 32 MiB of actual ImageData buffers. */
    {
      const snapshot = mod.undoSnapshotBytes();
      const engine = mod.createPaintEngine();
      for (let i = 0; i < 12; i += 1) {
        engine.setColor("#ff0000");
        engine.setLineWidth(10);
        engine.beginStroke({ x: 50 + i * 10, y: 50 });
        engine.endStroke();
      }
      const state = engine.getState();
      const expectedStates = Math.floor(mod.DEFAULT_MAX_UNDO_BYTES / snapshot);
      check(
        "undo history stays inside the 32 MiB ceiling",
        state.historyBytes <= mod.DEFAULT_MAX_UNDO_BYTES,
        `${state.historyBytes} <= ${mod.DEFAULT_MAX_UNDO_BYTES}`,
      );
      check(
        "history discards oldest snapshots at the ceiling",
        expectedStates === 10 && state.historyStates === expectedStates,
        `${state.historyStates} of ${expectedStates}`,
      );
      check("at least one normal undo remains", state.canUndo === true && state.undoDepth >= 1, String(state.undoDepth));
      let undone = 0;
      while (engine.undo()) undone += 1;
      check("undo cannot pass the retained floor", undone === state.historyStates - 1, `${undone}`);

      const tiny = mod.createPaintEngine({ maxUndoBytes: 1 });
      tiny.beginStroke({ x: 100, y: 100 });
      tiny.endStroke();
      const tinyState = tiny.getState();
      check(
        "a sub-snapshot budget still retains one real undo",
        tinyState.historyStates === 2 && tinyState.canUndo === true && tinyState.historyBytes === 2 * snapshot,
        `${tinyState.historyStates} states, ${tinyState.historyBytes} bytes`,
      );
    }

    /* 9. PNG Blob export and real decode. */
    {
      const engine = mod.createPaintEngine();
      engine.setColor("#ff0000");
      engine.setLineWidth(30);
      engine.beginStroke({ x: 512, y: 384 });
      engine.endStroke();
      const blob = await engine.toBlob();
      check("export is an image/png Blob", blob instanceof Blob && blob.type === mod.PNG_MEDIA_TYPE && blob.size > 0, `${blob.type}, ${blob.size} bytes`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      check("export starts with the PNG signature", bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47);
      const bitmap = await createImageBitmap(blob);
      check("exported PNG decodes at 1024x768", bitmap.width === 1024 && bitmap.height === 768);
      const target = document.createElement("canvas");
      target.width = 1024;
      target.height = 768;
      const targetContext = target.getContext("2d");
      targetContext.drawImage(bitmap, 0, 0);
      check("exported PNG keeps the drawn pixel", isColor(Array.from(targetContext.getImageData(512, 384, 1, 1).data), RED));
      bitmap.close?.();
    }

    /* 10. Initialize from an already decoded, validated image. */
    {
      const big = document.createElement("canvas");
      big.width = 2048;
      big.height = 1024;
      big.getContext("2d").fillStyle = "#00ff00";
      big.getContext("2d").fillRect(0, 0, 2048, 1024);

      const engine = mod.createPaintEngine();
      const fit = engine.initializeFromImage(big);
      check(
        "a 2048x1024 image is downsampled to fit 1024x512 without stretching",
        fit.scale === 0.5 && fit.width === 1024 && fit.height === 512 && fit.x === 0 && fit.y === 128,
        JSON.stringify(fit),
      );
      check("the fitted image is centered and painted", isColor(px(engine, 512, 384), [0, 255, 0, 255]));
      check("the letterbox uses the document background", isColor(px(engine, 512, 0), WHITE) && isColor(px(engine, 512, 767), WHITE));
      check("initialize starts a fresh history baseline", engine.getState().historyStates === 1 && engine.getState().canUndo === false);

      const small = document.createElement("canvas");
      small.width = 200;
      small.height = 100;
      small.getContext("2d").fillStyle = "#ff0000";
      small.getContext("2d").fillRect(0, 0, 200, 100);
      const smallEngine = mod.createPaintEngine();
      const smallFit = smallEngine.initializeFromImage(small);
      check(
        "a 200x100 image keeps its size (no upscaling)",
        smallFit.scale === 1 && smallFit.width === 200 && smallFit.height === 100 && smallFit.x === 412 && smallFit.y === 334,
        JSON.stringify(smallFit),
      );
      check("the small image lands in its fitted box", isColor(px(smallEngine, 512, 384), RED));
      check("the area outside the fitted image stays background", isColor(px(smallEngine, 0, 0), WHITE));
      check("a source without dimensions is rejected", (() => {
        try {
          smallEngine.initializeFromImage({});
          return false;
        } catch (error) {
          return error instanceof TypeError;
        }
      })());

      smallEngine.setColor("#0000ff");
      smallEngine.setLineWidth(10);
      smallEngine.beginStroke({ x: 100, y: 100 });
      smallEngine.endStroke();
      check("initialize after drawing discards the old history", smallEngine.getState().canUndo === true && (() => {
        smallEngine.initializeFromImage(small);
        return smallEngine.getState().canUndo === false && smallEngine.getState().historyStates === 1;
      })());

      const loadEngine = mod.createPaintEngine();
      loadEngine.setColor("#0000ff");
      loadEngine.setLineWidth(10);
      loadEngine.beginStroke({ x: 100, y: 100 });
      loadEngine.endStroke();
      const loaded = loadEngine.loadImage(small);
      check("loadImage fits the same way", loaded.width === 200 && loaded.x === 412 && loaded.y === 334);
      check("loadImage is an undoable edit", loadEngine.getState().undoDepth === 2 && loadEngine.undo() === true);
      check("undoing loadImage restores the previous drawing", isColor(px(loadEngine, 100, 100), [0, 0, 255, 255]) && isColor(px(loadEngine, 512, 384), WHITE));
    }

    /* 11. Typed coordinates and keyboard cursor stamping. */
    {
      const engine = mod.createPaintEngine();
      const typed = engine.setCursor({ x: 700.4, y: 200.6 });
      check("typed coordinates round to the nearest pixel", typed.x === 700 && typed.y === 201, JSON.stringify(typed));
      const moved = engine.moveCursor(-5, 10);
      check("keyboard cursor movement is relative", moved.x === 695 && moved.y === 211, JSON.stringify(moved));
      const upperLeft = engine.moveCursor(-100000, -100000);
      check("keyboard cursor clamps at the top-left", upperLeft.x === 0 && upperLeft.y === 0);
      const lowerRight = engine.moveCursor(1e9, 1e9);
      check("keyboard cursor clamps at the bottom-right", lowerRight.x === 1023 && lowerRight.y === 767);

      engine.setCursor({ x: 695, y: 211 });
      engine.setColor("#ff9900");
      engine.setLineWidth(20);
      const stamped = engine.stampAtCursor();
      check("keyboard stamp paints at the cursor", isColor(px(engine, 695, 211), [255, 153, 0, 255]));
      check("keyboard stamp is one undoable edit", stamped.undoDepth === 1 && engine.undo() === true && isColor(px(engine, 695, 211), WHITE));

      engine.setTool("rect");
      engine.setColor("#0000ff");
      engine.setLineWidth(4);
      engine.setCursor({ x: 500, y: 500 });
      engine.stampAtCursor({ size: 40 });
      check("keyboard rectangle stamp draws a visible outline", isColor(px(engine, 500, 480), [0, 0, 255, 255]));
      check("keyboard rectangle stamp leaves its centre", isColor(px(engine, 500, 500), WHITE));
    }

    /* 12. Input validation and robust disposal. */
    {
      const engine = mod.createPaintEngine();
      check("unknown tools are rejected", throwsType(() => engine.setTool("fill"), RangeError));
      check("non-hex colours are rejected", throwsType(() => engine.setColor("red"), RangeError));
      check("out-of-range line widths are rejected", [0, 101, 1.5].every((value) => throwsType(() => engine.setLineWidth(value), RangeError)));
      check("non-finite points are rejected", throwsType(() => engine.beginStroke({ x: Number.NaN, y: 1 }), TypeError));
      check("invalid canvas sizes are rejected", throwsType(() => mod.createPaintEngine({ width: 0 }), RangeError));
      check("invalid undo budgets are rejected", throwsType(() => mod.createPaintEngine({ maxUndoBytes: 0 }), RangeError));
      check("endStroke without a stroke is a safe no-op", engine.endStroke().strokeActive === false);
      check("undo/redo on a blank document return false", engine.undo() === false && engine.redo() === false);
      engine.beginStroke({ x: 10, y: 10 });
      engine.endStroke();
      engine.beginStroke({ x: 20, y: 20 });
      engine.beginStroke({ x: 30, y: 30 });
      check("a new beginStroke cancels a stuck active stroke", engine.getState().strokeActive === true && engine.getState().undoDepth === 1);
      engine.cancelStroke();

      const disposed = mod.createPaintEngine();
      disposed.beginStroke({ x: 100, y: 100 });
      disposed.endStroke();
      check("dispose returns nothing and is idempotent", disposed.dispose() === undefined && disposed.dispose() === undefined);
      const state = disposed.getState();
      check("dispose releases every snapshot", state.disposed === true && state.historyStates === 0 && state.historyBytes === 0 && state.canUndo === false);
      check("mutators reject use after dispose", throwsType(() => disposed.beginStroke({ x: 1, y: 1 }), Error));
      let rejected = false;
      try {
        await disposed.toBlob();
      } catch {
        rejected = true;
      }
      check("PNG export rejects after dispose", rejected);
    }

    return checks;
  });

  report("paint drawing model", checks);
  if (pageErrors.length > 0) {
    console.log(`  FAIL zero console/page errors - ${pageErrors.join(" | ")}`);
    failures += 1;
  } else {
    console.log("  PASS zero console/page errors");
  }

  console.log(`\n${failures === 0 ? "ALL PAINT BROWSER CHECKS PASSED" : `${failures} PAINT BROWSER CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
  await context.close();
} catch (error) {
  console.error(`PAINT BROWSER CHECK CRASHED: ${error?.stack || error}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
