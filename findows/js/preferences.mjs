/* Findows appearance preferences. One namespaced key, injected storage/media,
   and an explicit in-memory fallback when persistence is unavailable. Nothing
   here touches documents, drafts, the database as a whole or other site keys. */

export const PREFERENCES_KEY = "findows.preferences.v1";
export const DEFAULT_PREFERENCES = Object.freeze({
  theme: "system",
  wallpaper: "dusk",
  reduceMotion: false,
  translucent: true,
});
export const THEME_CHOICES = Object.freeze(["system", "light", "dark"]);
export const WALLPAPER_CHOICES = Object.freeze(["dusk", "tide", "aurora"]);

const COLOR_QUERY = "(prefers-color-scheme: dark)";
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const SESSION_MESSAGE = "Appearance is kept only until this window closes and resets on reload.";

const sanitize = (input = {}) => ({
  theme: THEME_CHOICES.includes(input.theme) ? input.theme : DEFAULT_PREFERENCES.theme,
  wallpaper: WALLPAPER_CHOICES.includes(input.wallpaper) ? input.wallpaper : DEFAULT_PREFERENCES.wallpaper,
  reduceMotion: input.reduceMotion === undefined ? DEFAULT_PREFERENCES.reduceMotion : Boolean(input.reduceMotion),
  translucent: input.translucent === undefined ? DEFAULT_PREFERENCES.translucent : Boolean(input.translucent),
});

/**
 * Accepts a settings-store adapter (get/set/delete by key), a localStorage-like
 * adapter (getItem/setItem/removeItem), an explicit `null` for the local
 * localStorage fallback, or no storage at all for a session-only fallback.
 * An injected adapter that cannot read/write is reported, never silently mixed
 * with another store.
 */
function makeAdapter(storage, key) {
  const shapes = [
    { names: ["getSetting", "setSetting", "deleteSetting"], mode: "settings-store", serialize: false },
    { names: ["readSetting", "writeSetting", "removeSetting"], mode: "settings-store", serialize: false },
    { names: ["getItem", "setItem", "removeItem"], mode: "local", serialize: true },
  ];
  if (storage) {
    for (const shape of shapes) {
      const [read, write, remove] = shape.names;
      if (typeof storage[read] === "function" && typeof storage[write] === "function") {
        return {
          mode: shape.mode,
          read: () => storage[read](key),
          write: (value) => storage[write](key, shape.serialize ? JSON.stringify(value) : value),
          clear: () => storage[remove]?.(key),
        };
      }
    }
    return {
      mode: "session",
      read: () => null,
      write: () => { throw new Error("Injected storage has no settings methods."); },
      clear: () => {},
    };
  }
  try {
    const local = globalThis.localStorage;
    if (local && typeof local.getItem === "function" && typeof local.setItem === "function") {
      return {
        mode: "local",
        read: () => local.getItem(key),
        write: (value) => local.setItem(key, JSON.stringify(value)),
        clear: () => local.removeItem?.(key),
      };
    }
  } catch { /* private mode or blocked storage: session-only fallback */ }
  return { mode: "session", read: () => null, write: () => { throw new Error(SESSION_MESSAGE); }, clear: () => {} };
}

function parseStored(raw) {
  if (raw == null || raw === "") return null;
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" ? sanitize(value) : null;
  } catch {
    return null;
  }
}

/** Build a small observable preference store and apply it to `root.dataset`. */
export function createPreferences({ root, storage = null, media, key = PREFERENCES_KEY } = {}) {
  if (!root || !root.dataset) throw new TypeError("createPreferences needs a DOM root with a dataset");
  const adapter = makeAdapter(storage, key);
  const color = typeof media === "function"
    ? media(COLOR_QUERY)
    : media?.[COLOR_QUERY] ?? media?.colorScheme ?? globalThis.matchMedia?.(COLOR_QUERY) ?? null;
  const motion = typeof media === "function"
    ? media(MOTION_QUERY)
    : media?.[MOTION_QUERY] ?? media?.reducedMotion ?? globalThis.matchMedia?.(MOTION_QUERY) ?? null;

  let current = { ...DEFAULT_PREFERENCES };
  let persistence = adapter.mode;
  let saved = adapter.mode !== "session";
  let lastError = adapter.mode === "session" ? SESSION_MESSAGE : null;
  let disposed = false;
  let writeQueue = Promise.resolve();
  const subscribers = new Set();
  const unwatch = [];

  const browserMotion = () => Boolean(motion?.matches);
  const systemDark = () => Boolean(color?.matches);

  function snapshot() {
    const motionFromBrowser = browserMotion();
    return {
      ...current,
      effectiveTheme: current.theme === "system" ? (systemDark() ? "dark" : "light") : current.theme,
      effectiveReduceMotion: current.reduceMotion || motionFromBrowser,
      motionFromBrowser,
      persistence,
      saved,
      lastError,
    };
  }

  function apply() {
    if (disposed) return;
    const view = snapshot();
    root.dataset.theme = view.effectiveTheme;
    root.dataset.themePref = view.themePref || view.theme;
    root.dataset.wallpaper = view.wallpaper;
    root.dataset.reduceMotion = String(view.effectiveReduceMotion);
    root.dataset.translucent = String(view.translucent);
    root.dataset.motionSource = view.motionFromBrowser ? "browser" : view.reduceMotion ? "preference" : "none";
  }

  function emit() {
    if (disposed) return;
    const view = snapshot();
    for (const listener of [...subscribers]) {
      try { listener(view); } catch { /* a bad listener cannot break preferences */ }
    }
  }

  function watch(query, listener) {
    if (!query) return;
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", listener);
      unwatch.push(() => query.removeEventListener?.("change", listener));
    } else if (typeof query.addListener === "function") {
      query.addListener(listener);
      unwatch.push(() => query.removeListener?.(listener));
    }
  }
  watch(color, () => {
    if (current.theme === "system") { apply(); emit(); }
  });
  watch(motion, () => { apply(); emit(); });

  function persist(value) {
    if (adapter.mode === "session") return Promise.resolve(snapshot());
    writeQueue = writeQueue.then(async () => {
      try {
        await adapter.write(value);
        saved = true;
        lastError = null;
      } catch (error) {
        saved = false;
        lastError = `Not saved — ${error?.message || "storage is unavailable"}. Appearance will reset on reload.`;
      }
    }).catch(() => {});
    return writeQueue.then(() => {
      emit();
      return snapshot();
    });
  }

  function commit(next, { save = true } = {}) {
    current = sanitize(next);
    apply();
    emit();
    return save ? persist(current) : Promise.resolve(snapshot());
  }

  async function ready() {
    try {
      const stored = parseStored(await adapter.read());
      if (stored) current = stored;
      else if (adapter.mode === "session") {
        saved = false;
        lastError = SESSION_MESSAGE;
      }
    } catch (error) {
      saved = false;
      lastError = `Could not load appearance: ${error?.message || "storage is unavailable"}.`;
    }
    apply();
    emit();
    return snapshot();
  }

  return {
    key,
    ready,
    get: snapshot,
    async update(patch = {}) {
      if (disposed) return snapshot();
      return commit({ ...current, ...patch });
    },
    async reset() {
      if (disposed) return snapshot();
      return commit({ ...DEFAULT_PREFERENCES });
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("subscribe needs a function");
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      subscribers.clear();
      for (const stop of unwatch) stop();
      unwatch.length = 0;
    },
  };
}

export default { createPreferences };
