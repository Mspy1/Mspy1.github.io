/* Pure Diagnostics fact readers. Written before the implementation existed so
   the missing module is the red state. These helpers never touch the DOM. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  describeEstimate,
  describeStorageMode,
  formatBytes,
  readNetwork,
  readVersion,
  readWindowCount,
} from "../../findows/js/apps/diagnostics.mjs";

test("formatBytes only formats real byte counts and reports the rest as unavailable", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024), "2.0 GB");
  for (const bad of [undefined, null, NaN, Infinity, -1, "1024", {}]) {
    assert.equal(formatBytes(bad), "Unavailable", `formatBytes(${String(bad)})`);
  }
});

test("readVersion accepts only a non-empty string from the shell", () => {
  assert.equal(readVersion({ version: "1.4.2-diagnostics" }), "1.4.2-diagnostics");
  assert.equal(readVersion({ version: "  2.0.1  " }), "2.0.1");
  for (const services of [{}, { version: "" }, { version: "   " }, { version: 42 }, null, undefined]) {
    assert.equal(readVersion(services), "Unavailable");
  }
});

test("readWindowCount accepts real non-negative counts only", () => {
  assert.equal(readWindowCount(0), "0");
  assert.equal(readWindowCount(8), "8");
  for (const bad of [-1, NaN, Infinity, 2.5, "3", null, undefined, {}]) {
    assert.equal(readWindowCount(bad), "Unavailable", `readWindowCount(${String(bad)})`);
  }
});

test("readNetwork maps the browser flag without guessing a connection", () => {
  assert.equal(readNetwork(true), "Online");
  assert.equal(readNetwork(false), "Offline");
  for (const bad of [undefined, null, "true", 1, {}]) {
    assert.equal(readNetwork(bad), "Unavailable");
  }
});

test("describeStorageMode names only known modes and keeps the reported reason", () => {
  assert.deepEqual(describeStorageMode("persistent"), {
    label: "Persistent", state: "ok", detail: "Saved for now — your browser can clear site data.",
  });
  assert.deepEqual(describeStorageMode("temporary", "UNAVAILABLE"), {
    label: "Temporary", state: "warn", detail: "Not saved — UNAVAILABLE",
  });
  const unknown = describeStorageMode("mystery", "not reported");
  assert.equal(unknown.label, "Unavailable");
  assert.equal(unknown.state, "unavailable");
  assert.match(unknown.detail, /not reported/);
  assert.equal(describeStorageMode(null).label, "Unavailable");
});

test("describeEstimate never invents usage or quota numbers and labels the whole site", () => {
  assert.equal(
    describeEstimate({ usage: 1536, quota: 5 * 1024 * 1024 }),
    "Browser estimate for this whole site (not just Findows): 1.5 KB used of 5.0 MB",
  );
  assert.equal(
    describeEstimate({ usage: 0, quota: 0 }),
    "Browser estimate for this whole site (not just Findows): 0 B used of 0 B",
  );
  for (const bad of [undefined, null, {}, { usage: -1, quota: 10 }, { usage: 1, quota: "10" }, { usage: NaN, quota: 10 }]) {
    assert.equal(describeEstimate(bad), "Browser estimate unavailable", JSON.stringify(bad));
  }
});
