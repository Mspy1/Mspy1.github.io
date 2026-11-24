/* Settings preferences: isolated key, injected storage/media, explicit fallback. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  createPreferences,
} from "../../findows/js/preferences.mjs";

function fakeRoot() {
  return { dataset: {} };
}

function mql(matches) {
  const listeners = new Set();
  return {
    matches,
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); },
    emit(next) { this.matches = next; for (const listener of listeners) listener({ matches: next }); },
  };
}

function fakeStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  const calls = [];
  return {
    values,
    calls,
    getSetting(key) { calls.push(["get", key]); return values.get(key) ?? null; },
    setSetting(key, value) { calls.push(["set", key]); values.set(key, value); return Promise.resolve(); },
    deleteSetting(key) { calls.push(["delete", key]); values.delete(key); return Promise.resolve(); },
  };
}

test("defaults apply to the injected root and system theme follows the media query", async () => {
  const root = fakeRoot();
  const colorScheme = mql(true);
  const prefs = createPreferences({ root, storage: null, media: { colorScheme, reducedMotion: mql(false) } });
  await prefs.ready();
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.dataset.themePref, "system");
  assert.equal(root.dataset.wallpaper, "dusk");
  assert.equal(root.dataset.reduceMotion, "false");
  assert.equal(root.dataset.translucent, "true");
  assert.deepEqual(
    { ...prefs.get() },
    { ...DEFAULT_PREFERENCES, effectiveTheme: "dark", effectiveReduceMotion: false, motionFromBrowser: false, persistence: "session", saved: false, lastError: prefs.get().lastError },
  );
  await prefs.update({ theme: "light" });
  assert.equal(root.dataset.theme, "light");
  assert.equal(root.dataset.themePref, "light");
  colorScheme.emit(false);
  assert.equal(root.dataset.theme, "light", "an explicit light theme does not follow the OS");
  prefs.dispose();
});

test("browser reduced motion always wins over the saved preference", async () => {
  const root = fakeRoot();
  const reducedMotion = mql(true);
  const prefs = createPreferences({ root, storage: null, media: { colorScheme: mql(false), reducedMotion } });
  await prefs.ready();
  await prefs.update({ reduceMotion: false });
  assert.equal(root.dataset.reduceMotion, "true");
  assert.equal(prefs.get().motionFromBrowser, true);
  reducedMotion.emit(false);
  assert.equal(root.dataset.reduceMotion, "false", "removing the OS preference reveals the saved false value");
  await prefs.update({ reduceMotion: true });
  assert.equal(root.dataset.reduceMotion, "true");
  assert.equal(prefs.get().motionFromBrowser, false);
  prefs.dispose();
});

test("wallpaper and translucency updates apply and notify subscribers", async () => {
  const root = fakeRoot();
  const prefs = createPreferences({ root, storage: null, media: { colorScheme: mql(false), reducedMotion: mql(false) } });
  await prefs.ready();
  const seen = [];
  const unsubscribe = prefs.subscribe((snapshot) => seen.push(snapshot.wallpaper));
  await prefs.update({ wallpaper: "tide", translucent: false });
  assert.equal(root.dataset.wallpaper, "tide");
  assert.equal(root.dataset.translucent, "false");
  assert.deepEqual(seen, ["tide"]);
  unsubscribe();
  await prefs.update({ wallpaper: "aurora" });
  assert.equal(seen.length, 1, "unsubscribe stops notifications");
  assert.equal(root.dataset.wallpaper, "aurora");
  prefs.dispose();
});

test("only the isolated settings key is used and a second instance reads the same prefs", async () => {
  const store = fakeStore({ "findows.test.unrelated": "keep me" });
  const media = { colorScheme: mql(false), reducedMotion: mql(false) };
  const first = createPreferences({ root: fakeRoot(), storage: store, media });
  await first.ready();
  await first.update({ theme: "dark", wallpaper: "tide" });
  assert.ok(store.calls.every((call) => call[1] === PREFERENCES_KEY), "no other key is touched");
  assert.equal(store.values.get("findows.test.unrelated"), "keep me");
  assert.equal(first.get().persistence, "settings-store");
  assert.equal(first.get().saved, true);
  const second = createPreferences({ root: fakeRoot(), storage: store, media });
  await second.ready();
  assert.equal(second.get().theme, "dark");
  assert.equal(second.get().wallpaper, "tide");
  first.dispose();
  second.dispose();
});

test("reset writes only defaults to its own key and leaves other data intact", async () => {
  const store = fakeStore({
    [PREFERENCES_KEY]: { theme: "dark", wallpaper: "aurora", reduceMotion: true, translucent: false },
    "findows.test.unrelated": "keep me",
  });
  const prefs = createPreferences({ root: fakeRoot(), storage: store, media: { colorScheme: mql(false), reducedMotion: mql(false) } });
  await prefs.ready();
  assert.equal(prefs.get().theme, "dark");
  await prefs.reset();
  assert.deepEqual(store.values.get(PREFERENCES_KEY), DEFAULT_PREFERENCES);
  assert.equal(store.values.get("findows.test.unrelated"), "keep me");
  assert.equal(store.calls.filter((call) => call[0] === "delete").length, 0, "reset never deletes a settings key or database");
  prefs.dispose();
});

test("write failures keep changes in memory, disclose unsaved state and allow retry", async () => {
  const store = fakeStore();
  let fail = true;
  store.setSetting = (key, value) => {
    store.calls.push(["set", key]);
    if (fail) return Promise.reject(new Error("quota"));
    store.values.set(key, value);
    return Promise.resolve();
  };
  const prefs = createPreferences({ root: fakeRoot(), storage: store, media: { colorScheme: mql(false), reducedMotion: mql(false) } });
  await prefs.ready();
  const snapshot = await prefs.update({ theme: "dark" });
  assert.equal(snapshot.theme, "dark", "the chosen appearance still applies");
  assert.equal(snapshot.saved, false);
  assert.match(snapshot.lastError, /not saved/i);
  fail = false;
  const retried = await prefs.update({});
  assert.equal(retried.saved, true);
  assert.equal(retried.lastError, null);
  prefs.dispose();
});

test("localStorage fallback uses the single namespaced key; absent storage is session-only", async () => {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  try {
    const prefs = createPreferences({ root: fakeRoot(), media: { colorScheme: mql(false), reducedMotion: mql(false) } });
    await prefs.ready();
    await prefs.update({ wallpaper: "aurora" });
    assert.deepEqual([...values.keys()], [PREFERENCES_KEY]);
    const reloaded = createPreferences({ root: fakeRoot(), media: { colorScheme: mql(false), reducedMotion: mql(false) } });
    await reloaded.ready();
    assert.equal(reloaded.get().wallpaper, "aurora");
    assert.equal(reloaded.get().persistence, "local");
    prefs.dispose();
    reloaded.dispose();
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
  const sessionOnly = createPreferences({ root: fakeRoot(), media: { colorScheme: mql(false), reducedMotion: mql(false) } });
  await sessionOnly.ready();
  assert.equal(sessionOnly.get().persistence, "session");
  assert.equal(sessionOnly.get().saved, false);
  assert.match(sessionOnly.get().lastError, /reset/i);
  sessionOnly.dispose();
});
