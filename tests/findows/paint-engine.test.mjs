/* Gate 3: Paint drawing-model pure helpers and lifecycle guard.
   Pixel-level, undo-budget and PNG behavior runs in tests/findows/browser/paint-engine.mjs
   against a real Canvas 2D context (this file never fakes a canvas). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  DEFAULT_BACKGROUND,
  DEFAULT_COLOR,
  DEFAULT_LINE_WIDTH,
  DEFAULT_MAX_UNDO_BYTES,
  DEFAULT_TOOL,
  PNG_MEDIA_TYPE,
  TOOLS,
  clampCanvasPoint,
  computeFitRect,
  createPaintEngine,
  isValidColor,
  normalizeColor,
  scalePointerFromRect,
  undoSnapshotBytes,
} from "../../findows/js/apps/paint-engine.mjs";

test("the Paint document contract is the fixed 1024x768 logical canvas", () => {
  assert.equal(CANVAS_WIDTH, 1024);
  assert.equal(CANVAS_HEIGHT, 768);
  assert.equal(DEFAULT_MAX_UNDO_BYTES, 32 * 1024 * 1024, "undo history targets a 32 MiB ceiling");
  assert.deepEqual([...TOOLS], ["brush", "eraser", "line", "rect", "ellipse"]);
  assert.equal(DEFAULT_TOOL, "brush");
  assert.equal(DEFAULT_BACKGROUND, "#ffffff");
  assert.equal(DEFAULT_COLOR, "#1f2937");
  assert.equal(DEFAULT_LINE_WIDTH, 4);
  assert.equal(PNG_MEDIA_TYPE, "image/png");
  assert.ok(Object.isFrozen(TOOLS), "tool list is readonly");
});

test("an already decoded image fits inside the canvas without stretching or upscaling", () => {
  const wide = computeFitRect(2048, 1024);
  assert.equal(wide.scale, 0.5);
  assert.equal(wide.width, 1024);
  assert.equal(wide.height, 512);
  assert.equal(wide.x, 0);
  assert.equal(wide.y, 128, "letterboxed vertically and centered");
  assert.ok(Object.isFrozen(wide));

  const small = computeFitRect(200, 100);
  assert.equal(small.scale, 1, "small images are never stretched up");
  assert.equal(small.width, 200);
  assert.equal(small.height, 100);
  assert.equal(small.x, 412);
  assert.equal(small.y, 334);

  const exact = computeFitRect(1024, 768);
  assert.deepEqual({ scale: exact.scale, x: exact.x, y: exact.y, width: exact.width, height: exact.height }, {
    scale: 1,
    x: 0,
    y: 0,
    width: 1024,
    height: 768,
  });

  const tall = computeFitRect(400, 2000);
  assert.ok(Math.abs(tall.scale - 0.384) < 1e-9);
  assert.ok(Math.abs(tall.width - 153.6) < 1e-9);
  assert.equal(tall.height, 768);
  assert.ok(Math.abs(tall.x - 435.2) < 1e-9);
  assert.equal(tall.y, 0);

  assert.throws(() => computeFitRect(0, 10), RangeError);
  assert.throws(() => computeFitRect(10, Number.NaN), TypeError);
  assert.throws(() => computeFitRect(10, 10, -1, 10), RangeError);
});

test("logical points round and clamp to real pixel indices", () => {
  assert.deepEqual({ ...clampCanvasPoint({ x: 700.4, y: 200.6 }) }, { x: 700, y: 201 });
  assert.deepEqual({ ...clampCanvasPoint({ x: -5, y: -1 }) }, { x: 0, y: 0 });
  assert.deepEqual({ ...clampCanvasPoint({ x: 5000, y: 5000 }) }, { x: 1023, y: 767 });
  assert.deepEqual({ ...clampCanvasPoint({ x: 10, y: 10 }, 20, 10) }, { x: 10, y: 9 });
  assert.ok(Object.isFrozen(clampCanvasPoint({ x: 1, y: 2 })));
  assert.throws(() => clampCanvasPoint({ x: Number.NaN, y: 1 }), TypeError);
  assert.throws(() => clampCanvasPoint({ x: "1", y: 1 }), TypeError);
  assert.throws(() => clampCanvasPoint(null), TypeError);
});

test("scaled pointer conversion maps a zoomed CSS box back to logical pixels", () => {
  const rect = { left: 100, top: 50, width: 512, height: 384 };
  const center = scalePointerFromRect({ clientX: 356, clientY: 242 }, rect);
  assert.deepEqual({ ...center }, { x: 512, y: 384 });
  const topLeft = scalePointerFromRect({ clientX: 100, clientY: 50 }, rect);
  assert.deepEqual({ ...topLeft }, { x: 0, y: 0 });
  const beyond = scalePointerFromRect({ clientX: 612, clientY: 434 }, rect);
  assert.deepEqual({ ...beyond }, { x: 1023, y: 767 }, "the far edge clamps to the last pixel, never 1024/768");
  const outside = scalePointerFromRect({ clientX: -100, clientY: 900 }, rect);
  assert.deepEqual({ ...outside }, { x: 0, y: 767 });
  assert.ok(Object.isFrozen(center));
  assert.throws(() => scalePointerFromRect({ clientX: 1, clientY: 1 }, { left: 0, top: 0, width: 0, height: 10 }), RangeError);
  assert.throws(() => scalePointerFromRect({ clientX: Number.NaN, clientY: 1 }, rect), TypeError);
});

test("colors are limited to CSS hex values and normalized deterministically", () => {
  for (const value of ["#abc", "#AABBCC", "#aabbccdd", "#000", "#FFFFFF"]) {
    assert.equal(isValidColor(value), true, value);
  }
  for (const value of ["red", "rgb(1,2,3)", "#ab", "#12345", null, 12, ""]) {
    assert.equal(isValidColor(value), false, String(value));
  }
  assert.equal(normalizeColor("#AABBCC"), "#aabbcc");
  assert.throws(() => normalizeColor("red"), RangeError);
});

test("undo snapshots are accounted in real RGBA bytes", () => {
  assert.equal(undoSnapshotBytes(), 1024 * 768 * 4);
  assert.equal(undoSnapshotBytes(10, 10), 400);
  assert.throws(() => undoSnapshotBytes(0, 10), RangeError);
});

test("the engine refuses to construct without a canvas outside a browser", () => {
  assert.throws(() => createPaintEngine(), /canvas/i);
  assert.throws(() => createPaintEngine({ canvas: {} }), /canvas/i);
});
