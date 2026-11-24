/* Pure window transitions, including launch identity and dirty state. */
import test from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, clampRect } from "../../findows/js/window-manager.mjs";

const AREA = { width: 1440, height: 856 };
const MIN = { width: 320, height: 200 };

function manager(overrides = {}) {
  return createWindowManager({ workArea: { ...AREA }, maxWindows: 8, ...overrides });
}
function open(m, id, extra = {}) {
  m.dispatch({
    type: "OPEN",
    id,
    appId: extra.appId || id,
    title: extra.title || id,
    icon: extra.icon || id,
    rect: extra.rect || { x: 120, y: 80, width: 640, height: 480 },
    minSize: extra.minSize || MIN,
    ...extra,
  });
}

test("OPEN creates a normal window with saved geometry and a z-order", () => {
  const m = manager();
  open(m, "w1");
  const w = m.getState()[0];
  assert.equal(w.id, "w1");
  assert.equal(w.state, "normal");
  assert.deepEqual(w.rect, { x: 120, y: 80, width: 640, height: 480 });
  assert.deepEqual(w.normalRect, w.rect);
  assert.equal(w.z, 1);
  assert.equal(m.getFocusedId(), "w1");
});

test("singleton apps and already-open documents reopen the existing window", () => {
  const m = manager();
  open(m, "w1", { appId: "help", singleton: true });
  open(m, "w2", { appId: "help", singleton: true });
  assert.equal(m.getState().length, 1);
  assert.equal(m.getFocusedId(), "w1");

  const e = manager();
  open(e, "w1", { appId: "paint", fileId: "file-1" });
  open(e, "w2", { appId: "paint", fileId: "file-1" });
  assert.equal(e.getState().length, 1);
  open(e, "w3", { appId: "paint", fileId: "file-2" });
  assert.equal(e.getState().length, 2, "different documents get distinct windows");
});

test("documents dedupe by app + file + mode, drafts by draftId, never by display title", () => {
  const m = manager();
  open(m, "w1", { appId: "notepad", fileId: "file-1", mode: "edit", title: "notes.txt" });
  open(m, "w2", { appId: "notepad", fileId: "file-1", mode: "edit", title: "a different label" });
  assert.equal(m.getState().length, 1, "same file and mode reopens the same window despite a different title");
  assert.equal(m.getFocusedId(), "w1");
  open(m, "w3", { appId: "notepad", fileId: "file-1", mode: "view" });
  assert.equal(m.getState().length, 2, "a different mode gets its own window");
  assert.deepEqual(
    [m.getWindow("w1").mode, m.getWindow("w3").mode],
    ["edit", "view"],
    "mode is part of window state",
  );

  const d = manager();
  open(d, "w1", { appId: "notepad", draftId: "draft-1", title: "Untitled" });
  open(d, "w2", { appId: "notepad", draftId: "draft-1", title: "Renamed label" });
  assert.equal(d.getState().length, 1, "draft identity wins over the title");
  assert.equal(d.getWindow("w1").draftId, "draft-1");
  assert.equal(d.getWindow("w1").fileId, null);
});

test("DIRTY is tracked per window and CLOSE removes it", () => {
  const m = manager();
  open(m, "w1");
  open(m, "w2");
  m.dispatch({ type: "DIRTY", id: "w1", dirty: true });
  assert.equal(m.getWindow("w1").dirty, true);
  assert.equal(m.getWindow("w2").dirty, false);
  const snapshot = m.getState();
  assert.throws(() => (snapshot[0].dirty = false), TypeError);
  m.dispatch({ type: "CLOSE", id: "w1" });
  assert.equal(m.getWindow("w1"), null);
  assert.equal(m.getState().length, 1);
});

test("the eight-window cap explains itself and still reopens existing windows", () => {
  const m = manager();
  for (let i = 0; i < 8; i++) open(m, `w${i}`);
  open(m, "w9");
  assert.equal(m.getState().length, 8);
  assert.match(m.getNotice() || "", /make room|close/i);
  open(m, "w3", { title: "Reopened" });
  assert.equal(m.getState().length, 8);
  assert.equal(m.getFocusedId(), "w3");
  assert.equal(m.getNotice(), "", "a successful reopen clears the cap notice");
});

test("FOCUS raises z-order and restores a minimized window", () => {
  const m = manager();
  open(m, "w1");
  open(m, "w2");
  assert.equal(m.getFocusedId(), "w2");
  m.dispatch({ type: "FOCUS", id: "w1" });
  assert.equal(m.getFocusedId(), "w1");
  assert.ok(m.getWindow("w1").z > m.getWindow("w2").z);
  m.dispatch({ type: "MINIMIZE", id: "w1" });
  assert.equal(m.getWindow("w1").state, "minimized");
  m.dispatch({ type: "FOCUS", id: "w1" });
  assert.equal(m.getWindow("w1").state, "normal");
  assert.equal(m.getFocusedId(), "w1");
});

test("MOVE clamps reachable title bars and RESIZE respects minimum geometry", () => {
  const m = manager();
  open(m, "w1");
  m.dispatch({ type: "MOVE", id: "w1", x: -500, y: -500 });
  assert.ok(m.getWindow("w1").rect.x >= 0);
  assert.ok(m.getWindow("w1").rect.y >= 0);
  m.dispatch({ type: "MOVE", id: "w1", x: 99999, y: 99999 });
  assert.ok(m.getWindow("w1").rect.x <= AREA.width - 120, "title bar must stay reachable");
  assert.ok(m.getWindow("w1").rect.y <= AREA.height - 40);
  m.dispatch({ type: "RESIZE", id: "w1", rect: { x: 10, y: 10, width: 40, height: 40 } });
  assert.ok(m.getWindow("w1").rect.width >= MIN.width);
  assert.ok(m.getWindow("w1").rect.height >= MIN.height);
});

test("SNAP and MAXIMIZE save the normal rectangle and RESTORE returns to it", () => {
  const m = manager();
  open(m, "w1");
  const before = { ...m.getWindow("w1").rect };
  m.dispatch({ type: "SNAP", id: "w1", side: "left" });
  assert.equal(m.getWindow("w1").state, "snapped-left");
  assert.equal(m.getWindow("w1").rect.x, 0);
  assert.equal(m.getWindow("w1").rect.width, AREA.width / 2);
  assert.deepEqual(m.getWindow("w1").normalRect, before);
  m.dispatch({ type: "RESTORE", id: "w1" });
  assert.equal(m.getWindow("w1").state, "normal");
  assert.deepEqual(m.getWindow("w1").rect, before);

  m.dispatch({ type: "SNAP", id: "w1", side: "right" });
  assert.equal(m.getWindow("w1").state, "snapped-right");
  assert.equal(m.getWindow("w1").rect.x, AREA.width / 2);
  m.dispatch({ type: "MAXIMIZE", id: "w1" });
  assert.equal(m.getWindow("w1").state, "maximized");
  assert.deepEqual(m.getWindow("w1").rect, { x: 0, y: 0, ...AREA });
  m.dispatch({ type: "RESTORE", id: "w1" });
  assert.deepEqual(m.getWindow("w1").rect, before, "maximize from a snap keeps the original rectangle");
});

test("MINIMIZE preserves the previous state; RESTORE returns to that state", () => {
  const m = manager();
  open(m, "w1");
  m.dispatch({ type: "MAXIMIZE", id: "w1" });
  const maximized = { ...m.getWindow("w1").rect };
  m.dispatch({ type: "MINIMIZE", id: "w1" });
  assert.equal(m.getWindow("w1").state, "minimized");
  assert.equal(m.getWindow("w1").prevState, "maximized");
  assert.deepEqual(m.getWindow("w1").rect, maximized, "DOM/geometry survives minimize");
  m.dispatch({ type: "RESTORE", id: "w1" });
  assert.equal(m.getWindow("w1").state, "maximized");
});

test("minimize and close focus the next eligible window, then nothing", () => {
  const m = manager();
  open(m, "w1");
  open(m, "w2");
  open(m, "w3");
  m.dispatch({ type: "FOCUS", id: "w2" });
  m.dispatch({ type: "MINIMIZE", id: "w1" });
  assert.equal(m.getFocusedId(), "w2", "minimizing an inactive window keeps focus");
  m.dispatch({ type: "CLOSE", id: "w2" });
  assert.equal(m.getFocusedId(), "w3", "close focuses the highest-z eligible window");
  assert.equal(m.getState().length, 2);
  m.dispatch({ type: "RESTORE", id: "w1" });
  m.dispatch({ type: "CLOSE", id: "w1" });
  m.dispatch({ type: "CLOSE", id: "w3" });
  assert.equal(m.getFocusedId(), null);
  assert.equal(m.getState().length, 0);
});

test("getState is readonly and work-area changes re-clamp windows", () => {
  const m = manager();
  open(m, "w1", { rect: { x: 1300, y: 700, width: 200, height: 160 } });
  const state = m.getState();
  assert.throws(() => state.push({}), TypeError);
  assert.throws(() => (state[0].rect.x = 0), TypeError);
  m.setWorkArea({ width: 800, height: 600 });
  assert.ok(m.getWindow("w1").rect.x <= 800 - 120);
  assert.ok(m.getWindow("w1").rect.y <= 600 - 40);
});

test("clampRect is a pure helper usable by drag and resize paths", () => {
  const r = clampRect({ x: -20, y: -20, width: 2000, height: 2000 }, AREA, MIN);
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
  assert.ok(r.width <= AREA.width);
  assert.ok(r.height <= AREA.height);
  assert.ok(r.width >= MIN.width);
});
