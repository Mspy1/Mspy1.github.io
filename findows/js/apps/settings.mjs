/* Settings UI: appearance controls over the shared preferences store, factual
   local-storage information, and a separate confirmed Recycle Bin purge.
   Every value is written with textContent; no global listeners or markup. */

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const button = (label, action, className = "set-button") => {
  const node = el("button", className, label);
  node.type = "button";
  node.dataset.action = action;
  return node;
};

const THEMES = Object.freeze([
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]);
const WALLPAPERS = Object.freeze([
  { value: "dusk", label: "Dusk" },
  { value: "tide", label: "Tide" },
  { value: "aurora", label: "Aurora" },
]);

const formatBytes = (value) => {
  if (!Number.isFinite(value) || value < 0) return "Unavailable";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

let instanceCount = 0;

export async function mount({ container, windowId, services = {}, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Settings needs a DOM container");
  }
  if (signal?.aborted) throw new DOMException("Settings window was closed while loading", "AbortError");

  const uid = `set-${++instanceCount}`;
  const preferences = services.preferences || null;
  const files = services.files || null;
  const desktop = document.getElementById("fw-desktop") || container.ownerDocument?.body;
  let disposed = false;
  let activeDialog = null;
  let returnFocus = null;

  const root = el("section", "set-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Settings");

  if (!preferences) {
    const error = el("div", "set-error", "Preferences are not available in this window. Appearance controls are disabled.");
    error.setAttribute("role", "alert");
    root.append(error);
    container.replaceChildren(root);
    const onAbort = () => dispose();
    signal?.addEventListener?.("abort", onAbort, { once: true });
    function dispose() {
      if (disposed) return;
      disposed = true;
      signal?.removeEventListener?.("abort", onAbort);
      root.remove();
    }
    return { canClose: () => true, focus: () => error.focus?.(), dispose };
  }

  /* ---------- Layout ---------- */

  const header = el("header", "set-header");
  const eyebrow = el("span", "set-eyebrow", "Findows · preferences");
  const title = el("h1", "set-title", "Settings");
  title.tabIndex = -1;
  const lead = el("p", "set-lead", "Choose how this desktop looks. Changes apply immediately and stay on this device when saving works.");
  header.append(eyebrow, title, lead);

  const grid = el("div", "set-grid");

  const appearance = el("section", "set-card set-appearance");
  const appearanceTitle = el("h2", "set-card-title", "Appearance");
  appearance.append(appearanceTitle);

  const themeField = document.createElement("fieldset");
  themeField.className = "set-field";
  const themeLegend = el("legend", "", "Theme");
  themeField.append(themeLegend);
  const themeOptions = el("div", "set-options");
  const themeRadios = [];
  for (const choice of THEMES) {
    const label = el("label", "set-option");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = `${uid}-theme`;
    input.value = choice.value;
    input.className = "set-theme";
    label.append(input, el("span", "", choice.label));
    themeOptions.append(label);
    themeRadios.push(input);
  }
  themeField.append(themeOptions);
  appearance.append(themeField);

  const wallpaperField = document.createElement("fieldset");
  wallpaperField.className = "set-field";
  wallpaperField.append(el("legend", "", "Wallpaper"));
  const wallpaperOptions = el("div", "set-wallpapers");
  const wallpaperRadios = [];
  for (const choice of WALLPAPERS) {
    const label = el("label", "set-wall-option");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = `${uid}-wallpaper`;
    input.value = choice.value;
    input.className = "set-wallpaper";
    const preview = document.createElement("img");
    preview.src = `/findows/assets/wallpaper-${choice.value}.svg`;
    preview.alt = "";
    preview.setAttribute("aria-hidden", "true");
    label.append(input, preview, el("span", "", choice.label));
    wallpaperOptions.append(label);
    wallpaperRadios.push(input);
  }
  wallpaperField.append(wallpaperOptions);
  appearance.append(wallpaperField);

  const motionLabel = el("label", "set-check");
  const motionInput = document.createElement("input");
  motionInput.type = "checkbox";
  motionInput.className = "set-motion";
  motionLabel.append(motionInput, el("span", "", "Reduce Findows motion"));
  const motionNote = el("p", "set-motion-note", "Your browser is already reducing motion. You cannot undo that here.");
  motionNote.hidden = true;

  const translucentLabel = el("label", "set-check");
  const translucentInput = document.createElement("input");
  translucentInput.type = "checkbox";
  translucentInput.className = "set-translucency";
  translucentLabel.append(translucentInput, el("span", "", "Translucent shell"));

  const saveRow = el("div", "set-save-row");
  const saveState = el("span", "set-save-state", "Saved for now — your browser can clear site data");
  saveState.setAttribute("role", "status");
  saveState.setAttribute("aria-live", "polite");
  const retry = button("Try saving again", "retry", "set-button set-retry");
  retry.hidden = true;
  saveRow.append(saveState, retry);
  appearance.append(motionLabel, motionNote, translucentLabel, saveRow);

  const storageCard = el("section", "set-card set-storage");
  storageCard.append(el("h2", "set-card-title", "Local storage"));
  const info = el("dl", "set-storage-info");
  const modeRow = el("div", "set-info-row");
  modeRow.append(el("dt", "", "Saving"), el("dd", "set-storage-mode", "Checking…"));
  const reasonRow = el("div", "set-info-row");
  reasonRow.append(el("dt", "", "Details"), el("dd", "set-storage-reason", "None"));
  info.append(modeRow, reasonRow);
  const estimate = el("p", "set-estimate", "Browser estimate unavailable");
  const purgeResult = el("p", "set-purge-result");
  purgeResult.setAttribute("role", "status");
  purgeResult.setAttribute("aria-live", "polite");
  purgeResult.hidden = true;

  const actions = el("div", "set-actions");
  const resetButton = button("Reset appearance", "reset", "set-button set-reset");
  const purgeButton = button("Empty Recycle Bin…", "purge", "set-button set-purge set-danger");
  actions.append(resetButton, purgeButton);
  const note = el("p", "set-note", "Reset changes only appearance. Saved documents, drafts and unrelated site data are not deleted. Emptying the Recycle Bin is a separate confirmed action.");
  storageCard.append(info, estimate, purgeResult, actions, note);

  const about = el("footer", "set-about", "Findows is a browser simulation. Saving keeps data in this browser only; it is not a backup or cloud sync.");

  grid.append(appearance, storageCard);
  root.append(header, grid, about);
  container.replaceChildren(root);

  /* ---------- Dialogs ---------- */

  function closeDialog() {
    if (!activeDialog) return;
    const current = activeDialog;
    activeDialog = null;
    current.overlay.remove();
    if (!disposed && returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
    returnFocus = null;
  }

  function makeDialog(className, titleText) {
    closeDialog();
    if (!disposed) returnFocus = document.activeElement;
    const overlay = el("div", "set-overlay");
    const panel = el("div", `set-dialog ${className}`);
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const headingId = `${uid}-${className}-title`;
    const heading = el("h2", "set-dialog-title", titleText);
    heading.id = headingId;
    panel.setAttribute("aria-labelledby", headingId);
    const closeX = button("×", "cancel", "set-dialog-x");
    closeX.setAttribute("aria-label", "Close dialog");
    const body = el("div", "set-dialog-body");
    panel.append(closeX, heading, body);
    overlay.append(panel);
    root.append(overlay);
    activeDialog = { overlay, panel, body };
    closeX.addEventListener("click", closeDialog);
    panel.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); closeDialog(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...panel.querySelectorAll('button:not([disabled]),input:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    (body.querySelector("button") || closeX).focus({ preventScroll: true });
    return body;
  }

  /* ---------- Painting ---------- */

  function repaint() {
    if (disposed) return;
    const view = preferences.get();
    for (const radio of themeRadios) radio.checked = radio.value === view.theme;
    for (const radio of wallpaperRadios) radio.checked = radio.value === view.wallpaper;
    motionInput.checked = view.reduceMotion;
    translucentInput.checked = view.translucent;
    motionNote.hidden = !view.motionFromBrowser;
    saveState.textContent = view.saved
      ? "Saved for now — your browser can clear site data"
      : `Not saved — ${view.lastError || "appearance will reset on reload"}`;
    retry.hidden = Boolean(view.saved);
  }

  async function refreshStorage() {
    let mode = "unavailable";
    let reason = "Local storage information is not available in this browser.";
    if (files) {
      try {
        mode = (await files.ready?.()) || files.getStorageMode?.() || "unknown";
        reason = files.getModeReason?.() || "No storage problem reported.";
      } catch (error) {
        reason = error?.message || "Local storage could not be checked.";
      }
    }
    const modeText = mode === "persistent" ? "Persistent (saved for now — your browser can clear site data)" :
      mode === "temporary" ? "Temporary — not saved" : `Unavailable (${mode})`;
    info.querySelector(".set-storage-mode").textContent = modeText;
    info.querySelector(".set-storage-reason").textContent = reason;
    try {
      const estimateData = await navigator.storage?.estimate?.();
      estimate.textContent = estimateData
        ? `Browser estimate for this whole site (not just Findows): ${formatBytes(estimateData.usage)} used of ${formatBytes(estimateData.quota || 0)}`
        : "Browser estimate unavailable";
    } catch {
      estimate.textContent = "Browser estimate unavailable";
    }
  }

  /* ---------- Wiring ---------- */

  for (const radio of themeRadios) {
    radio.addEventListener("change", () => { if (radio.checked) preferences.update({ theme: radio.value }); });
  }
  for (const radio of wallpaperRadios) {
    radio.addEventListener("change", () => { if (radio.checked) preferences.update({ wallpaper: radio.value }); });
  }
  motionInput.addEventListener("change", () => preferences.update({ reduceMotion: motionInput.checked }));
  translucentInput.addEventListener("change", () => preferences.update({ translucent: translucentInput.checked }));
  retry.addEventListener("click", () => preferences.update({}));

  resetButton.addEventListener("click", () => {
    const body = makeDialog("set-reset-dialog", "Reset appearance?");
    body.append(el("p", "", "Theme, wallpaper, motion and translucency return to their defaults. Saved documents, drafts and unrelated site data are not deleted."));
    const actions2 = el("div", "set-dialog-actions");
    const confirm = button("Reset appearance", "confirm", "set-button set-primary");
    const cancel2 = button("Cancel", "cancel");
    actions2.append(confirm, cancel2);
    body.append(actions2);
    cancel2.addEventListener("click", closeDialog);
    confirm.addEventListener("click", async () => {
      await preferences.reset();
      closeDialog();
      repaint();
    });
  });

  purgeButton.addEventListener("click", async () => {
    if (!files?.listTrash || !files?.purge) {
      purgeResult.hidden = false;
      purgeResult.textContent = "Recycle Bin is unavailable because the file service is not connected.";
      return;
    }
    let roots = [];
    try { roots = (await files.listTrash()) || []; } catch (error) {
      purgeResult.hidden = false;
      purgeResult.textContent = `Could not open the Recycle Bin: ${error?.message || "storage unavailable"}.`;
      return;
    }
    const body = makeDialog("set-purge-dialog", "Empty Recycle Bin?");
    body.append(el("p", "", roots.length
      ? `Permanently delete ${roots.length} item${roots.length === 1 ? "" : "s"} and everything inside them from the Recycle Bin? This cannot be undone. Nothing outside the Recycle Bin is affected.`
      : "The Recycle Bin is already empty."));
    const list = el("ul", "set-purge-list");
    for (const entry of roots) list.append(el("li", "", entry.name || entry.id));
    body.append(list);
    const actions2 = el("div", "set-dialog-actions");
    const confirm = button(roots.length ? `Permanently delete ${roots.length}` : "Nothing to delete", "confirm", "set-button set-danger");
    confirm.disabled = roots.length === 0;
    const cancel2 = button("Cancel", "cancel");
    actions2.append(confirm, cancel2);
    body.append(actions2);
    cancel2.addEventListener("click", closeDialog);
    confirm.addEventListener("click", async () => {
      let deleted = 0;
      const failed = [];
      for (const entry of roots) {
        try { await files.purge(entry.id, entry.revision); deleted += 1; }
        catch { failed.push(entry.name || entry.id); }
      }
      closeDialog();
      purgeResult.hidden = false;
      purgeResult.textContent = `Permanently deleted ${deleted} item${deleted === 1 ? "" : "s"} and everything inside.` +
        (failed.length ? ` Could not delete: ${failed.join(", ")}.` : "");
    });
  });

  const unsubscribe = preferences.subscribe(repaint);
  let observer = null;
  if (typeof MutationObserver === "function" && desktop) {
    observer = new MutationObserver(repaint);
    observer.observe(desktop, {
      attributes: true,
      attributeFilter: ["data-theme", "data-theme-pref", "data-wallpaper", "data-reduce-motion", "data-translucent"],
    });
  }

  await refreshStorage();
  repaint();

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    unsubscribe();
    observer?.disconnect();
    closeDialog();
    root.remove();
  }
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  return {
    canClose: () => true,
    focus: () => title.focus({ preventScroll: true }),
    dispose,
  };
}

export default { mount };
