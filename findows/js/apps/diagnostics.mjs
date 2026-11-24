/* Diagnostics: a read-only panel of real Findows facts.
   Sources are limited to services.version, services.getWindowCount(),
   services.files, navigator.onLine and navigator.storage.estimate().
   Nothing here inspects the device, other tabs, other sites or a server. */

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/** Pure readers are exported so the fact policy can be tested without a DOM. */
export function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "Unavailable";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function readVersion(services) {
  const value = services && typeof services === "object" ? services.version : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : "Unavailable";
}

export function readWindowCount(value) {
  return Number.isInteger(value) && value >= 0 ? String(value) : "Unavailable";
}

export function readNetwork(value) {
  return value === true ? "Online" : value === false ? "Offline" : "Unavailable";
}

export function describeStorageMode(mode, reason) {
  const detail = reason == null || reason === "" ? null : String(reason);
  if (mode === "persistent") {
    return { label: "Persistent", state: "ok", detail: detail || "Saved for now — your browser can clear site data." };
  }
  if (mode === "temporary") {
    return {
      label: "Temporary",
      state: "warn",
      detail: detail ? `Not saved — ${detail}` : "Not saved in this browser.",
    };
  }
  return {
    label: "Unavailable",
    state: "unavailable",
    detail: detail || "Storage information is not available.",
  };
}

export function describeEstimate(data) {
  if (!data || typeof data !== "object") return "Browser estimate unavailable";
  const { usage, quota } = data;
  if (!Number.isFinite(usage) || usage < 0 || !Number.isFinite(quota) || quota < 0) {
    return "Browser estimate unavailable";
  }
  return `Browser estimate for this whole site (not just Findows): ${formatBytes(usage)} used of ${formatBytes(quota)}`;
}

let instanceCount = 0;

export async function mount({
  container,
  windowId,
  services = {},
  signal,
} = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Diagnostics needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Diagnostics window was closed while loading", "AbortError");
  }

  const uid = `diag-${++instanceCount}`;
  const shell = services && typeof services === "object" ? services : {};
  const view = container.ownerDocument?.defaultView || globalThis.window || null;
  let disposed = false;
  let generation = 0;
  let unsubscribeWindows = null;
  let pollTimer = null;
  let onOnline = null;
  let onOffline = null;

  /* ---------- Surface ---------- */

  const root = el("section", "diag-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Diagnostics");

  const header = el("header", "diag-header");
  const eyebrow = el("span", "diag-eyebrow", "Findows · diagnostics");
  const title = el("h1", "diag-title", "Diagnostics");
  title.tabIndex = -1;
  const lead = el("p", "diag-lead",
    "Read-only facts about this Findows window. Nothing here scans your device, reads other tabs or contacts a server.");
  header.append(eyebrow, title, lead);

  const status = el("p", "diag-status", "Ready · read-only facts.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const grid = el("div", "diag-grid");
  function card(name, heading, detailText) {
    const article = el("article", `diag-card diag-card-${name}`);
    const headingNode = el("h2", "diag-card-title", heading);
    const value = el("p", `diag-value diag-${name}`, "Unavailable");
    value.dataset.state = "unavailable";
    const detail = el("p", "diag-detail", detailText);
    article.append(headingNode, value, detail);
    grid.append(article);
    return { article, value, detail };
  }

  const versionFact = card("version", "App version", "The version reported by this Findows build.");
  const windowFact = card("windows", "Open windows", "Findows windows open on this desktop.");
  const networkFact = card("network", "Connection", "Browser network state; no connection test is made.");
  const storageFact = card("storage", "Local storage", "How this desktop saves your files.");
  storageFact.detail.classList.add("diag-storage-detail");
  const estimate = el("p", "diag-estimate", "Browser estimate unavailable");
  storageFact.article.append(estimate);

  const footer = el("footer", "diag-footer");
  const refreshButton = el("button", "diag-refresh", "Refresh facts");
  refreshButton.type = "button";
  refreshButton.id = `${uid}-refresh`;
  const note = el("p", "diag-note",
    "Unavailable means the browser or this desktop did not provide a value. Facts are never guessed or read from other websites.");
  footer.append(refreshButton, note);

  root.append(header, status, grid, footer);
  container.replaceChildren(root);

  function setFact(node, label, stateName) {
    if (!node || disposed) return;
    if (node.textContent !== label) node.textContent = label;
    node.dataset.state = stateName;
  }

  /* ---------- Reading facts ---------- */

  async function refresh({ quiet = false } = {}) {
    if (disposed) return;
    const token = ++generation;
    root.setAttribute("aria-busy", "true");

    const version = readVersion(shell);
    setFact(versionFact.value, version, version === "Unavailable" ? "unavailable" : "ok");
    const network = readNetwork(globalThis.navigator?.onLine);
    setFact(networkFact.value, network,
      network === "Online" ? "online" : network === "Offline" ? "offline" : "unavailable");

    let windowText = "Unavailable";
    if (typeof shell.getWindowCount === "function") {
      try {
        windowText = readWindowCount(await shell.getWindowCount());
      } catch {
        windowText = "Unavailable";
      }
    }
    if (disposed || token !== generation) return;
    setFact(windowFact.value, windowText, windowText === "Unavailable" ? "unavailable" : "ok");

    let storage = describeStorageMode(null);
    if (shell.files && typeof shell.files === "object") {
      try {
        if (typeof shell.files.ready === "function") await shell.files.ready();
        if (disposed || token !== generation) return;
        storage = describeStorageMode(shell.files.getStorageMode?.(), shell.files.getModeReason?.());
      } catch (error) {
        storage = {
          label: "Unavailable",
          state: "unavailable",
          detail: error?.message || "Storage check failed.",
        };
      }
    }
    if (disposed || token !== generation) return;
    setFact(storageFact.value, storage.label, storage.state);
    storageFact.detail.textContent = storage.detail;

    let estimateText = "Browser estimate unavailable";
    try {
      const data = await globalThis.navigator?.storage?.estimate?.();
      if (data) estimateText = describeEstimate(data);
    } catch {
      /* A blocked estimate stays explicitly unavailable. */
    }
    if (disposed || token !== generation) return;
    estimate.textContent = estimateText;
    root.removeAttribute("aria-busy");
    if (!quiet) status.textContent = "Facts updated just now.";
  }

  async function refreshWindowsOnly() {
    if (disposed || typeof shell.getWindowCount !== "function") return;
    let next = "Unavailable";
    try {
      next = readWindowCount(await shell.getWindowCount());
    } catch {
      next = "Unavailable";
    }
    setFact(windowFact.value, next, next === "Unavailable" ? "unavailable" : "ok");
  }

  /* ---------- Reactive sources, each with cleanup ---------- */

  refreshButton.addEventListener("click", () => { void refresh(); });

  if (view && typeof view.addEventListener === "function") {
    onOnline = () => { void refresh({ quiet: true }); };
    onOffline = () => { void refresh({ quiet: true }); };
    view.addEventListener("online", onOnline);
    view.addEventListener("offline", onOffline);
  }

  if (typeof shell.subscribeWindows === "function") {
    try {
      const stop = shell.subscribeWindows(() => { void refresh({ quiet: true }); });
      if (typeof stop === "function") unsubscribeWindows = stop;
    } catch {
      /* The Refresh button remains available if subscribing fails. */
    }
  } else if (view && typeof view.setInterval === "function") {
    // No push API: poll only the cheap window count so it still changes when tools open.
    pollTimer = view.setInterval(() => { void refreshWindowsOnly(); }, 5000);
  }

  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  await refresh({ quiet: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    signal?.removeEventListener?.("abort", onAbort);
    if (typeof unsubscribeWindows === "function") {
      try { unsubscribeWindows(); } catch { /* already stopped */ }
      unsubscribeWindows = null;
    }
    if (view && typeof view.removeEventListener === "function") {
      if (onOnline) view.removeEventListener("online", onOnline);
      if (onOffline) view.removeEventListener("offline", onOffline);
    }
    if (pollTimer !== null) {
      view.clearInterval(pollTimer);
      pollTimer = null;
    }
    root.remove();
  }

  return {
    canClose: () => true,
    focus() {
      try { title.focus({ preventScroll: true }); } catch { title.focus(); }
    },
    dispose,
  };
}

export default { mount };
