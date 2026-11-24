/* Photo Viewer pure helpers — no DOM, no decoding. Dev-only tests.
   Run: node --test tests/findows/photo-viewer.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ZOOM_STEPS,
  clampScale,
  fitScale,
  formatBytes,
  formatDimensions,
  formatImageError,
  safeImageFilename,
} from "../../findows/js/apps/photo-viewer-helpers.mjs";

test("zoom steps cover fit-to-actual and stay ordered", () => {
  assert.deepEqual(ZOOM_STEPS[3], 1);
  assert.ok(ZOOM_STEPS.every((step, index) => index === 0 || step > ZOOM_STEPS[index - 1]));
});

test("safeImageFilename cannot escape a folder and keeps the real extension", () => {
  assert.equal(safeImageFilename("holiday: 01.png", "image/png"), "holiday__01.png");
  assert.equal(safeImageFilename("../../escape", "image/png"), "escape.png");
  assert.equal(safeImageFilename("  ..  ", "image/jpeg"), "image.jpg");
  assert.equal(safeImageFilename("photo.jpeg", "image/jpeg"), "photo.jpeg");
  assert.equal(safeImageFilename("CON", "image/webp"), "_CON.webp");
  assert.ok(safeImageFilename("x".repeat(300), "image/png").endsWith(".png"));
  assert.ok(safeImageFilename("x".repeat(300), "image/png").length <= 200);
});

test("formatImageError keeps typed validation and storage codes visible", () => {
  assert.equal(formatImageError(Object.assign(new Error("APNG"), { code: "ANIMATED_IMAGE" })), "ANIMATED_IMAGE: APNG");
  assert.equal(formatImageError(Object.assign(new Error("missing"), { code: "MISSING" })), "MISSING: missing");
  assert.equal(formatImageError(new Error("offline")), "offline");
  assert.equal(formatImageError(null), "Something went wrong.");
});

test("fitScale shrinks and enlarges only from real dimensions", () => {
  assert.equal(fitScale(100, 50, 400, 200), 4);
  assert.equal(fitScale(100, 50, 200, 400), 2);
  assert.equal(fitScale(100, 50, 50, 25), 0.5);
  assert.equal(fitScale(0, 50, 400, 200), 1);
  assert.equal(fitScale(100, 50, 0, 200), 1);
});

test("clampScale keeps a canvas inside its pixel budget", () => {
  assert.equal(clampScale(4, 48, 32, 1, 16_000_000), 4);
  const limited = clampScale(8, 4096, 4096, 2, 1_000_000);
  assert.ok(limited > 0 && limited <= Math.sqrt(1_000_000 / (4096 * 4096 * 4)) + 1e-9);
  assert.equal(clampScale(-1, 48, 32), 0.25);
});

test("dimensions and sizes are reported from the validated record", () => {
  assert.equal(formatDimensions(48, 32), "48 × 32");
  assert.equal(formatBytes(0), "0 bytes");
  assert.equal(formatBytes(5), "5 bytes");
  assert.equal(formatBytes(1536), "1.5 KB");
});
