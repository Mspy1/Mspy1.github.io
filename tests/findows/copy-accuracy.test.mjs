/* Focused copy-accuracy assertions for the bounded copy lane.
   These guard the exact user-facing wording (and one stale code comment)
   without mounting a DOM or changing any behaviour. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("help does not promise Start or exit stay reachable with the keyboard open", () => {
  const src = source("findows/js/apps/help.mjs");
  assert.ok(src.includes("Dismiss the on-screen keyboard to reach Start or Back to Mspy1."));
  assert.ok(!src.includes("stay reachable, including while the on-screen keyboard is open"));
});

test("settings says browser reduced motion cannot be undone here", () => {
  const src = source("findows/js/apps/settings.mjs");
  assert.ok(src.includes("Your browser is already reducing motion. You cannot undo that here."));
  assert.ok(!src.includes("It stays on whatever you choose here."));
});

test("settings describes saved data as saved for now and clearable by the browser", () => {
  const src = source("findows/js/apps/settings.mjs");
  assert.ok((src.match(/Saved for now — your browser can clear site data/g) || []).length >= 2);
  assert.ok(src.includes("Persistent (saved for now — your browser can clear site data)"));
  assert.ok(!src.includes("Saved on this device"));
});

test("settings purge copy covers each trash root, its contents and the result", () => {
  const src = source("findows/js/apps/settings.mjs");
  assert.ok(src.includes("and everything inside them from the Recycle Bin? This cannot be undone."));
  assert.ok(src.includes("and everything inside.`"));
  assert.ok(!src.includes("item${roots.length === 1 ? \"\" : \"s\"} from the Recycle Bin?"));
});

test("both settings and diagnostics label the estimate as whole-site", () => {
  for (const path of ["findows/js/apps/settings.mjs", "findows/js/apps/diagnostics.mjs"]) {
    const src = source(path);
    assert.ok(src.includes("Browser estimate for this whole site (not just Findows):"), path);
    assert.ok(!src.includes("Browser estimate: "), path);
  }
});

test("diagnostics explains that persistent storage can still be cleared", () => {
  const src = source("findows/js/apps/diagnostics.mjs");
  assert.ok(src.includes('detail: detail || "Saved for now — your browser can clear site data."'));
  assert.ok(!src.includes('"Saved on this device."'));
});

test("file-service no longer claims the read-only viewer is unshipped", () => {
  const src = source("findows/js/file-service.mjs");
  assert.ok(!src.includes("stays false until the read-only viewer ships"));
  assert.ok(src.includes("With the read-only viewer available, Files opens images read-only"));
});
