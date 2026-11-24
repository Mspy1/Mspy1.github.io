/* Bootstrap. `services` is the only context apps see. Storage opens
   asynchronously in the background so the desktop paints immediately; apps
   that need it await `services.files.ready()`. */
import { createWindowManager } from "./window-manager.mjs";
import { createRegistry } from "./app-registry.mjs";
import { createShell } from "./shell.mjs";
import { createStorage } from "./storage.mjs";
import { createFileService } from "./file-service.mjs";
import { createPreferences } from "./preferences.mjs";

const params = new URLSearchParams(location.search);
const registry = createRegistry();

const storage = createStorage();
const files = createFileService({ storage, photoViewer: true });
const root = document.getElementById("fw-desktop");
const preferences = createPreferences({ root });
void preferences.ready();

let shell = null;
let unloadBound = false;
let suppressNextUnload = false;

function onBeforeUnload(event) {
  // Only the browser's own prompt is used here; no custom confirm on unload.
  if (suppressNextUnload) {
    suppressNextUnload = false;
    return;
  }
  if (!shell?.hasDirty?.()) return;
  event.preventDefault();
  event.returnValue = "";
}

function setUnloadGuard(enabled) {
  if (enabled && !unloadBound) {
    window.addEventListener("beforeunload", onBeforeUnload);
    unloadBound = true;
  } else if (!enabled && unloadBound) {
    window.removeEventListener("beforeunload", onBeforeUnload);
    unloadBound = false;
  }
}

const services = {
  version: "1.0.0",
  storage,
  files,
  preferences,
  getStorageMode: () => storage.getStorageMode(),
  ready: () => files.ready(),
  openApp: (appId, options = {}) => shell?.openApp(appId, options) ?? null,
  setDirty: (windowId, dirty) => shell?.setDirty(windowId, dirty),
  bindDocument: (windowId, { fileId, mode, draftId } = {}) =>
    wm.dispatch({ type: "BIND_DOCUMENT", id: windowId, fileId, mode, draftId }),
  isUnloadGuardActive: () => unloadBound,
  setUnloadGuard,
  suppressUnloadOnce: () => { suppressNextUnload = true; },
  getWindowCount: () => wm.getState().length,
  subscribeWindows: (listener) => {
    let count = wm.getState().length;
    return wm.subscribe(() => {
      const next = wm.getState().length;
      if (next !== count) {
        count = next;
        listener(next);
      }
    });
  },
};

// Geometry comes from the rendered desktop area, so maximize matches the real
// work area at every breakpoint.
const workArea = () => {
  const area = document.querySelector(".fw-desktop-area");
  if (!area) return { width: window.innerWidth, height: Math.max(320, window.innerHeight - 120) };
  const rect = area.getBoundingClientRect();
  return { width: Math.round(rect.width), height: Math.round(rect.height) };
};

const wm = createWindowManager({ workArea: workArea(), maxWindows: 8 });
shell = createShell({
  root,
  registry,
  wm,
  services,
});

shell.start();
window.addEventListener("resize", () => wm.setWorkArea(workArea()));

// Dev-only inspection hook: ES module exports, never a global object.
export { services, registry, wm, shell, params };
