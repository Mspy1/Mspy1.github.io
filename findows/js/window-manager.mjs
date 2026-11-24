/* Pure window transitions. No DOM, no browser globals, no storage.
   The shell is the only renderer; this module owns state and invariants. */

const MIN_VISIBLE_X = 120;
const MIN_VISIBLE_Y = 40;
const DEFAULT_MIN = { width: 320, height: 200 };

const num = (value, fallback) => (Number.isFinite(value) ? Math.round(value) : fallback);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export function clampRect(rect, workArea, minSize = DEFAULT_MIN) {
  const area = workArea || { width: 1280, height: 720 };
  const min = minSize || DEFAULT_MIN;
  const width = clamp(num(rect?.width, min.width), Math.min(min.width, area.width), area.width);
  const height = clamp(num(rect?.height, min.height), Math.min(min.height, area.height), area.height);
  return {
    x: clamp(num(rect?.x, 0), 0, Math.max(0, area.width - MIN_VISIBLE_X)),
    y: clamp(num(rect?.y, 0), 0, Math.max(0, area.height - MIN_VISIBLE_Y)),
    width,
    height,
  };
}

function freezeWindow(w) {
  return Object.freeze({
    ...w,
    rect: Object.freeze({ ...w.rect }),
    normalRect: Object.freeze({ ...w.normalRect }),
    minSize: Object.freeze({ ...w.minSize }),
    mode: w.mode || null,
    draftId: w.draftId || null,
    dirty: Boolean(w.dirty),
  });
}

export function createWindowManager(options = {}) {
  let workArea = { ...(options.workArea || { width: 1280, height: 720 }) };
  let maxWindows = Number.isFinite(options.maxWindows) ? options.maxWindows : 8;
  let sequence = 0;
  let focusedId = null;
  let lastOpenId = null;
  let notice = null;
  let noticeUntil = 0;
  const NOTICE_TTL = 8000;
  let windows = [];
  const listeners = new Set();

  function emit() {
    for (const listener of listeners) listener();
  }
  function eligible() {
    return windows
      .filter((w) => w.state !== "minimized")
      .sort((a, b) => b.z - a.z);
  }
  function nextFocus(excluding) {
    const list = eligible().filter((w) => w.id !== excluding);
    return list.length ? list[0].id : null;
  }
  function raise(id) {
    const w = windows.find((item) => item.id === id);
    if (!w) return;
    const top = windows.reduce((m, item) => Math.max(m, item.z), 0);
    if (w.z !== top) w.z = top + 1;
    focusedId = id;
  }
  function geometryFor(state, normalRect, minSize) {
    if (state === "maximized") return { x: 0, y: 0, width: workArea.width, height: workArea.height };
    if (state === "snapped-left" || state === "snapped-right") {
      return {
        x: state === "snapped-left" ? 0 : workArea.width / 2,
        y: 0,
        width: workArea.width / 2,
        height: workArea.height,
      };
    }
    // Resize/compact transitions must respect the declared minimum, just like
    // OPEN/RESIZE/RESTORE do. Snapped and maximized stay deliberately exempt.
    return clampRect(normalRect, workArea, minSize);
  }

  function dispatch(action) {
    if (!action || typeof action.type !== "string") return;
    const w = windows.find((item) => item.id === action.id);

    switch (action.type) {
      case "OPEN": {
        const appId = action.appId || action.id;
        const mode = action.mode || null;
        const draftId = action.draftId || null;
        const byId = action.id ? windows.find((item) => item.id === action.id) : null;
        const byDraft = draftId ? windows.find((item) => item.draftId === draftId) : null;
        const byDocument = action.fileId
          ? windows.find((item) => item.appId === appId && item.fileId === action.fileId && (item.mode || null) === mode)
          : null;
        const bySingleton = action.singleton
          ? windows.find((item) => item.appId === appId)
          : null;
        const existing = byId || byDraft || byDocument || bySingleton;
        if (existing) {
          raise(existing.id);
          notice = null;
          noticeUntil = 0;
          lastOpenId = existing.id;
          emit();
          return;
        }
        if (windows.length >= maxWindows) {
          notice = `Close a window to make room for ${action.title || appId}. Nothing was closed automatically.`;
          noticeUntil = Date.now() + NOTICE_TTL;
          emit();
          return;
        }
        const minSize = { ...(action.minSize || DEFAULT_MIN) };
        const index = sequence++;
        const rect = clampRect(
          action.rect || {
            x: 96 + (index % 4) * 36,
            y: 72 + (index % 4) * 28,
            width: Math.min(720, workArea.width - 120),
            height: Math.min(520, workArea.height - 96),
          },
          workArea,
          minSize,
        );
        const id = action.id || `${appId}-${sequence}`;
        windows.push({
          id,
          appId,
          title: action.title || appId,
          icon: action.icon || appId,
          fileId: action.fileId || null,
          mode,
          draftId,
          dirty: false,
          singleton: Boolean(action.singleton),
          state: "normal",
          rect,
          normalRect: { ...rect },
          prevState: "normal",
          minSize,
          z: windows.reduce((m, item) => Math.max(m, item.z), 0) + 1,
        });
        notice = null;
        noticeUntil = 0;
        focusedId = id;
        lastOpenId = id;
        break;
      }
      case "DIRTY": {
        if (!w) return;
        w.dirty = Boolean(action.dirty);
        break;
      }
      case "BIND_DOCUMENT": {
        if (!w) return;
        const { fileId = null, mode = null, draftId = null } = action;
        if (w.fileId === fileId && w.mode === mode && w.draftId === draftId) return;
        Object.assign(w, { fileId, mode, draftId });
        break;
      }
      case "FOCUS": {
        if (!w) return;
        if (w.state === "minimized") w.state = w.prevState || "normal";
        raise(w.id);
        break;
      }
      case "MOVE": {
        if (!w) return;
        w.rect = clampRect({ ...w.rect, x: action.x, y: action.y }, workArea, w.minSize);
        if (w.state === "normal") w.normalRect = { ...w.rect };
        break;
      }
      case "RESIZE": {
        if (!w) return;
        w.rect = clampRect(action.rect || w.rect, workArea, w.minSize);
        if (w.state === "normal") w.normalRect = { ...w.rect };
        break;
      }
      case "SNAP": {
        if (!w) return;
        if (w.state === "normal") w.normalRect = { ...w.rect };
        w.state = action.side === "right" ? "snapped-right" : "snapped-left";
        w.rect = geometryFor(w.state, w.normalRect, w.minSize);
        raise(w.id);
        break;
      }
      case "MAXIMIZE": {
        if (!w) return;
        if (w.state === "normal") w.normalRect = { ...w.rect };
        w.state = "maximized";
        w.rect = geometryFor(w.state, w.normalRect, w.minSize);
        raise(w.id);
        break;
      }
      case "RESTORE": {
        if (!w) return;
        if (w.state === "minimized") {
          w.state = w.prevState || "normal";
        } else if (w.state === "snapped-left" || w.state === "snapped-right" || w.state === "maximized") {
          w.state = "normal";
          w.rect = clampRect(w.normalRect, workArea, w.minSize);
        }
        raise(w.id);
        break;
      }
      case "MINIMIZE": {
        if (!w || w.state === "minimized") return;
        w.prevState = w.state;
        w.state = "minimized";
        focusedId = nextFocus(w.id);
        break;
      }
      case "CLOSE": {
        if (!w) return;
        const wasFocused = focusedId === w.id;
        windows = windows.filter((item) => item.id !== w.id);
        if (wasFocused) focusedId = nextFocus(w.id);
        break;
      }
      default:
        return;
    }
    emit();
  }

  return {
    dispatch,
    getState: () => Object.freeze(windows.map(freezeWindow)),
    getWindow: (id) => {
      const w = windows.find((item) => item.id === id);
      return w ? freezeWindow(w) : null;
    },
    getFocusedId: () => focusedId,
    getLastOpenId: () => lastOpenId,
    // Non-destructive: unrelated emits must not swallow the one explanation
    // the user gets for a rejected open. It expires on its own TTL instead.
    getNotice: () => (notice && Date.now() < noticeUntil ? notice : ""),
    setWorkArea(area) {
      workArea = { ...area };
      for (const w of windows) {
        if (w.state === "minimized") continue;
        w.rect = geometryFor(w.state, w.normalRect, w.minSize);
      }
      emit();
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
