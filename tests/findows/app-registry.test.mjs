/* Shell integration: the registry ships real apps, no fixtures. */
import test from "node:test";
import assert from "node:assert/strict";
import { createRegistry } from "../../findows/js/app-registry.mjs";

const fixture = (id) => ({
  id,
  title: id.toUpperCase(),
  keywords: [id],
  icon: id,
  singleton: true,
  accepts: [],
  minSize: { width: 320, height: 200 },
  load: async () => ({ mount: async () => ({ canClose: () => true, dispose() {} }) }),
});

test("all ready apps are registered and load mountable modules", async () => {
  const r = createRegistry();
  const ids = r.list().map((a) => a.id);
  for (const id of [
    "help", "calculator", "clock", "files", "notepad", "settings", "diagnostics",
    "minesweeper", "sticky-notes", "paint", "photo-viewer",
    "unit-converter", "json-formatter", "base64-codec", "hash-tool", "date-calculator",
    "world-clock", "color-tools", "text-toolkit", "character-map", "markdown-preview",
    "read-aloud", "snake", "nonogram", "fifteen-puzzle", "game-of-life", "tone-generator",
    "sokoban", "block-drop", "hangman", "mastermind",
  ]) {
    assert.ok(ids.includes(id), `missing ready app: ${id}`);
  }
  assert.ok(!ids.some((id) => /fixture|probe/i.test(id)));
  for (const app of r.list()) assert.equal(typeof (await app.load()).mount, "function", app.id);
  const help = r.getApp("help");
  assert.equal(help.title, "Help");
  assert.equal(help.singleton, true);
  assert.deepEqual(help.accepts, []);
  assert.ok(Array.isArray(help.keywords) && help.keywords.length > 0);
  assert.deepEqual(help.minSize, { width: 320, height: 200 });
  assert.equal(typeof help.load, "function");

  const calc = r.getApp("calculator");
  assert.equal(calc.title, "Calculator");
  assert.equal(calc.icon, "calculator", "uses the icon-clock lane's asset");
  assert.equal(calc.singleton, true);
  assert.deepEqual(calc.accepts, []);
  assert.deepEqual(calc.minSize, { width: 320, height: 320 });
  assert.ok(calc.keywords.some((k) => /math|arithmetic|calc/i.test(k)), "calculator keywords are searchable");
  assert.equal(typeof calc.load, "function");
});

test("getApp is case-insensitive and returns null for unknown ids", () => {
  const r = createRegistry();
  assert.equal(r.getApp("HELP").id, "help");
  assert.equal(r.getApp("does-not-exist"), null);
});

test("search matches titles and keywords case-insensitively with explicit empty states", () => {
  const r = createRegistry();
  assert.deepEqual(r.search(""), r.list(), "empty query lists all shipped apps");
  assert.deepEqual(r.search("  HELP  ").map((a) => a.id), ["help"]);
  assert.deepEqual(r.search("keyboard").map((a) => a.id), ["help"], "keyword search works");
  assert.deepEqual(r.search("about").map((a) => a.id), ["help"]);
  assert.ok(r.search("calc").some((app) => app.id === "calculator"));
  assert.ok(r.search("math").some((app) => app.id === "calculator"));
  assert.deepEqual(r.search("zzzz-no-match"), [], "no-match state is an explicit empty array");
});

test("registerApp is extensible but rejects duplicates and incomplete definitions", () => {
  const r = createRegistry();
  r.registerApp(fixture("future"));
  assert.ok(r.getApp("future"));
  assert.deepEqual(r.search("future").map((a) => a.id), ["future"]);
  assert.throws(() => r.registerApp(fixture("future")), /duplicate/i);
  assert.throws(() => r.registerApp({ id: "broken" }), /invalid|required/i);
});

test("load is lazy and cached, and returns a mountable app module", async () => {
  const r = createRegistry();
  let calls = 0;
  r.registerApp({
    ...fixture("counted"),
    load: async () => {
      calls++;
      return { mount: async () => ({ canClose: () => true, dispose() {} }) };
    },
  });
  const app = r.getApp("counted");
  assert.equal(calls, 0, "module must not load on registration");
  const first = await app.load();
  const second = await app.load();
  assert.equal(calls, 1, "module load must be cached");
  assert.equal(first, second);
  assert.equal(typeof first.mount, "function");
});

test("list and search results are readonly snapshots", () => {
  const r = createRegistry();
  const list = r.list();
  assert.throws(() => list.push({}), TypeError);
  const results = r.search("help");
  assert.throws(() => results.pop(), TypeError);
});

test("a registry load failure does not permanently poison the Retry path", async () => {
  let calls = 0;
  const r = createRegistry([{ ...fixture("retry"), load: async () => {
    if (++calls === 1) throw new Error("temporary load failure");
    return { mount() {} };
  } }]);
  await assert.rejects(r.getApp("retry").load(), /temporary load failure/);
  assert.equal(typeof (await r.getApp("retry").load()).mount, "function");
  assert.equal(calls, 2);
});
