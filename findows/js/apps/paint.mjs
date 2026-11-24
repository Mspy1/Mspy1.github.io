/* Paint UI: a real 1024×768 raster surface over paint-engine.mjs.
   Pointer capture/cancel, typed coordinates, keyboard drawing, scoped dialogs,
   PNG Save/Save As through services.files, and original-preserving image import.
   No markup injection, no global listeners, no storage access outside services. */
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  MAX_LINE_WIDTH,
  MIN_LINE_WIDTH,
  createPaintEngine,
} from "./paint-engine.mjs";
import { decodeImage, inspectImage } from "../import-export.mjs";

const PALETTE = Object.freeze([
  "#1f2937", "#ffffff", "#e5484d", "#f5a524", "#16b8a6", "#4f6df5",
  "#9b5de5", "#f15bb5", "#00bbf9", "#7cb518", "#6b7280", "#000000",
]);
const TOOL_LABELS = Object.freeze({
  brush: "Brush", eraser: "Eraser", line: "Line", rect: "Rectangle", ellipse: "Ellipse",
});

let instanceCount = 0;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function makeButton(label, action, className = "paint-action") {
  const node = el("button", `paint-action ${className}`, label);
  node.type = "button";
  node.dataset.action = action;
  return node;
}

function safeName(value, fallback = "drawing.png") {
  const base = String(value || "").trim().replace(/[^a-zA-Z0-9._ -]/g, "_");
  if (!base) return fallback;
  return /\.png$/i.test(base) ? base : `${base.replace(/\.[^.]+$/, "")}.png`;
}

function describeError(error) {
  const messages = {
    UNAVAILABLE: "Storage is unavailable. Your drawing is still here — download a copy.",
    QUOTA: "Browser storage is full. Nothing was saved; download a copy.",
    REVISION_CONFLICT: "The saved file is newer than this editor. Nothing was overwritten.",
    NAME_CONFLICT: "A file with that name already exists. Choose another name.",
    MISSING: "That file is no longer available.",
    READ_ONLY: "Imported originals are read-only. Use Save As for your edits.",
    EMPTY_FILE: "That file is empty.",
    FILE_TOO_LARGE: "Images can be at most 10 MiB.",
    UNSUPPORTED_TYPE: "Choose a PNG, JPEG or WebP image. Active content types are not accepted.",
    MALFORMED_IMAGE: "That image is malformed and was not opened.",
    TRUNCATED_IMAGE: "That image is incomplete and was not opened.",
    ANIMATED_IMAGE: "Animated images are not supported. Export a still frame first.",
    DIMENSIONS_TOO_LARGE: "Images can be at most 4096×4096 pixels.",
    INVALID_DIMENSIONS: "That image reports invalid dimensions.",
    DECODE_FAILED: "This image could not be decoded. It may be damaged.",
    DECODE_DIMENSION_MISMATCH: "The decoded image does not match its header. It was not opened.",
    ABORTED: "The image load was cancelled.",
  };
  return messages[error?.code] || error?.message || "That operation could not be completed.";
}

export async function mount({
  container, windowId, fileId = null, mode, draftId = null, services = {}, signal,
} = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Paint needs a DOM container");
  }
  if (signal?.aborted) throw new DOMException("Paint window was closed while loading", "AbortError");

  const files = services.files || null;
  const uid = `paint-${++instanceCount}`;
  const listeners = [];
  const objectUrls = new Set();
  const timers = new Set();
  let debounce = null;
  let rafId = null;
  let resizeObserver = null;
  let activeDialog = null;
  let returnFocus = null;
  let saveLock = Promise.resolve();
  const state = {
    fileId: fileId || null,
    baseRevision: null,
    name: "Untitled",
    origin: null,
    draftId: draftId || files?.newDraftId?.("paint") || `paint-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    dirty: false,
    savedNotice: false,
    note: "",
    storageMode: files?.getStorageMode?.() || (mode === "temporary" ? "temporary" : "persistent"),
    disposed: false,
    epoch: 0,
    queue: Promise.resolve(),
    closePromise: null,
    zoom: 1,
    activePointerId: null,
    historySignature: "",
    editCopy: mode === "edit-copy",
    sourceFileId: null,
    sourceRevision: null,
    editGeneration: 0,
    documentToken: 0,
    pendingSaves: new Set(),
    saveInFlight: null,
    lastCommit: null,
    originalFile: null,
    originalValidation: null,
    originalStoredId: null,
  };

  function bindCurrentDocument() {
    services.bindDocument?.(windowId, {
      fileId: state.fileId || null,
      mode: "edit",
      draftId: state.draftId,
    });
  }

  function bumpDocument() {
    state.documentToken += 1;
  }

  /** One write at a time; canClose waits for a settlement instead of dropping it. */
  function trackSave(task) {
    if (state.saveInFlight) return state.saveInFlight;
    const previous = saveLock;
    let release;
    saveLock = new Promise((resolve) => { release = resolve; });
    const promise = (async () => {
      await previous;
      return task();
    })();
    state.saveInFlight = promise;
    state.pendingSaves.add(promise);
    saveButton.disabled = true;
    const cleanup = () => {
      if (state.saveInFlight === promise) state.saveInFlight = null;
      state.pendingSaves.delete(promise);
      saveButton.disabled = false;
      release();
    };
    promise.then(cleanup, cleanup);
    return promise;
  }

  async function settlePendingSaves() {
    await Promise.all([...state.pendingSaves]).catch(() => {});
  }

  const on = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push([target, type, handler]);
  };
  const later = (handler, delay) => {
    const id = setTimeout(() => {
      timers.delete(id);
      handler();
    }, delay);
    timers.add(id);
    return id;
  };
  const cancelLater = (id) => {
    if (id === null) return;
    clearTimeout(id);
    timers.delete(id);
  };

  /* ---------- Chrome ---------- */

  const root = el("section", "paint-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Paint");

  const toolbar = el("div", "paint-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Paint tools");

  const fileGroup = el("div", "paint-group paint-file-group");
  const newButton = makeButton("New", "new", "paint-quiet");
  const openButton = makeButton("Open…", "open", "paint-quiet");
  const importButton = makeButton("Import image…", "import", "paint-quiet");
  const keepOriginal = makeButton("Keep original copy", "keep-original", "paint-quiet");
  keepOriginal.hidden = true;
  const saveButton = makeButton("Save", "save", "paint-primary");
  const saveAsButton = makeButton("Save As…", "save-as");
  const downloadButton = makeButton("Download a copy", "download");
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.className = "paint-file-input";
  fileInput.accept = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
  fileInput.setAttribute("aria-label", "Import a PNG, JPEG or WebP image");
  fileInput.hidden = true;
  fileGroup.append(newButton, openButton, importButton, keepOriginal, saveButton, saveAsButton, downloadButton, fileInput);

  const toolGroup = el("div", "paint-group paint-tool-group");
  toolGroup.setAttribute("role", "group");
  toolGroup.setAttribute("aria-label", "Drawing tools");
  const toolButtons = new Map();
  for (const [tool, label] of Object.entries(TOOL_LABELS)) {
    const button = el("button", "paint-tool", label);
    button.type = "button";
    button.dataset.tool = tool;
    button.setAttribute("aria-pressed", String(tool === "brush"));
    toolButtons.set(tool, button);
    toolGroup.append(button);
  }

  const colorGroup = el("div", "paint-group paint-color-group");
  colorGroup.setAttribute("role", "group");
  colorGroup.setAttribute("aria-label", "Drawing color");
  const palette = el("div", "paint-palette");
  const swatches = new Map();
  for (const color of PALETTE) {
    const swatch = el("button", "paint-swatch");
    swatch.type = "button";
    swatch.dataset.color = color;
    swatch.style.setProperty("--paint-swatch", color);
    swatch.setAttribute("aria-label", `Color ${color}`);
    swatch.setAttribute("aria-pressed", String(color === "#1f2937"));
    swatches.set(color, swatch);
    palette.append(swatch);
  }
  const customLabel = el("label", "paint-custom-label");
  customLabel.append(el("span", "paint-control-label", "Custom"));
  const customColor = document.createElement("input");
  customColor.type = "color";
  customColor.className = "paint-custom-color";
  customColor.value = "#1f2937";
  customColor.setAttribute("aria-label", "Custom drawing color");
  customLabel.append(customColor);
  colorGroup.append(palette, customLabel);

  const widthGroup = el("div", "paint-group paint-width-group");
  const widthLabel = el("label", "paint-width-label");
  widthLabel.append(el("span", "paint-control-label", "Size"));
  const widthInput = document.createElement("input");
  widthInput.type = "range";
  widthInput.className = "paint-width";
  widthInput.min = String(MIN_LINE_WIDTH);
  widthInput.max = String(MAX_LINE_WIDTH);
  widthInput.step = "1";
  widthInput.value = "4";
  widthInput.setAttribute("aria-label", "Brush size in pixels");
  widthLabel.append(widthInput);
  const widthValue = el("output", "paint-width-value", "4 px");
  widthGroup.append(widthLabel, widthValue);

  const actionGroup = el("div", "paint-group paint-action-group");
  const undoButton = makeButton("Undo", "undo");
  const redoButton = makeButton("Redo", "redo");
  const clearButton = makeButton("Clear", "clear", "paint-quiet");
  const fitButton = makeButton("Fit", "fit", "paint-quiet");
  actionGroup.append(undoButton, redoButton, clearButton, fitButton);

  toolbar.append(fileGroup, toolGroup, colorGroup, widthGroup, actionGroup);

  const stage = el("div", "paint-stage");
  const canvas = document.createElement("canvas");
  canvas.className = "paint-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Drawing canvas, 1024 by 768 pixels");
  canvas.setAttribute("aria-describedby", `${uid}-hint`);
  stage.append(canvas);

  const errorBox = el("div", "paint-error");
  errorBox.setAttribute("role", "alert");
  errorBox.hidden = true;

  const statusbar = el("footer", "paint-statusbar");
  const status = el("span", "paint-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const coords = el("div", "paint-coords");
  coords.setAttribute("role", "group");
  coords.setAttribute("aria-label", "Set cursor position");
  const xLabel = el("label", "paint-coord-label");
  xLabel.append(el("span", "paint-control-label", "X"));
  const xInput = document.createElement("input");
  xInput.type = "number";
  xInput.className = "paint-x";
  xInput.min = "0";
  xInput.max = String(CANVAS_WIDTH - 1);
  xInput.value = "512";
  xInput.setAttribute("aria-label", "Cursor X coordinate");
  xLabel.append(xInput);
  const yLabel = el("label", "paint-coord-label");
  yLabel.append(el("span", "paint-control-label", "Y"));
  const yInput = document.createElement("input");
  yInput.type = "number";
  yInput.className = "paint-y";
  yInput.min = "0";
  yInput.max = String(CANVAS_HEIGHT - 1);
  yInput.value = "384";
  yInput.setAttribute("aria-label", "Cursor Y coordinate");
  yLabel.append(yInput);
  const setCursorButton = makeButton("Set", "set-cursor", "paint-quiet");
  setCursorButton.classList.add("paint-set-cursor");
  coords.append(xLabel, yLabel, setCursorButton);
  const zoomLabel = el("span", "paint-zoom", "Zoom 100%");
  const modeChip = el("span", "paint-mode-chip");
  const hint = el("p", "paint-hint", "Raster drawing surface, not a semantic image editor. Arrows move the cursor; Space or Enter draws; Ctrl+Z undoes; Ctrl+Shift+Z redoes; Escape cancels a stroke.");
  hint.id = `${uid}-hint`;
  statusbar.append(status, coords, zoomLabel, modeChip);

  root.append(toolbar, stage, errorBox, statusbar, hint);
  container.replaceChildren(root);

  const engine = createPaintEngine({ canvas, background: "#ffffff", color: "#1f2937", lineWidth: 4, tool: "brush" });

  /* ---------- Status, errors and dirty state ---------- */

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  function clearError() {
    errorBox.textContent = "";
    errorBox.hidden = true;
  }

  function fitCanvas() {
    if (state.disposed) return;
    const box = stage.getBoundingClientRect();
    const availableWidth = Math.max(160, box.width - 32);
    const availableHeight = Math.max(120, box.height - 32);
    const scale = Math.min(1, availableWidth / CANVAS_WIDTH, availableHeight / CANVAS_HEIGHT);
    canvas.style.width = `${Math.floor(CANVAS_WIDTH * scale)}px`;
    canvas.style.height = `${Math.floor(CANVAS_HEIGHT * scale)}px`;
    state.zoom = scale;
    zoomLabel.textContent = `Zoom ${Math.round(scale * 100)}%`;
  }

  function paintStatus() {
    if (state.disposed) return;
    const snapshot = engine.getState();
    const cleanLabel = state.dirty ? "Not saved" : state.savedNotice || state.fileId ? "Saved" : "Not saved";
    status.textContent = `X ${snapshot.cursor.x}, Y ${snapshot.cursor.y} · ${snapshot.tool} · ${snapshot.lineWidth} px · ${CANVAS_WIDTH} × ${CANVAS_HEIGHT} · ${state.name} · ${cleanLabel}${state.note ? ` · ${state.note}` : ""}`;
    undoButton.disabled = !snapshot.canUndo;
    redoButton.disabled = !snapshot.canRedo;
    widthValue.textContent = `${snapshot.lineWidth} px`;
    modeChip.textContent = state.storageMode === "temporary"
      ? "Not saved — download a copy · storage unavailable"
      : "Storage: local to this browser";
  }

  function setDirty(value) {
    state.dirty = Boolean(value);
    if (value) state.savedNotice = false;
    services.setDirty?.(windowId, state.dirty);
    paintStatus();
  }

  function historySignature() {
    const snapshot = engine.getState();
    return `${snapshot.historyStates}:${snapshot.undoDepth}`;
  }

  function markEdited() {
    state.editGeneration += 1;
    setDirty(true);
    scheduleDraft();
  }

  /* ---------- Drafts ---------- */

  async function stopDraftWrites() {
    state.epoch += 1;
    cancelLater(debounce);
    debounce = null;
    await state.queue.catch(() => {});
  }

  async function writeDraft(blobOverride = null) {
    if (!state.dirty || !files?.putDraft) return;
    const blob = (await blobOverride) || await engine.toBlob();
    const record = files.createDraft?.({
      appId: "paint",
      draftId: state.draftId,
      fileId: state.fileId,
      baseRevision: state.baseRevision,
      payload: { blob, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      updatedAt: Date.now(),
    }) || {
      appId: "paint",
      draftId: state.draftId,
      fileId: state.fileId,
      baseRevision: state.baseRevision,
      payload: { blob, width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      updatedAt: Date.now(),
    };
    await files.putDraft(record);
  }

  function scheduleDraft() {
    if (state.disposed || !state.dirty || !files?.putDraft) return;
    const epoch = state.epoch;
    cancelLater(debounce);
    debounce = later(() => {
      debounce = null;
      state.queue = state.queue.then(async () => {
        if (state.disposed || state.epoch !== epoch || !state.dirty) return;
        try {
          await writeDraft();
        } catch {
          state.note = "Draft not saved — download a copy";
          paintStatus();
        }
      }).catch(() => {});
    }, 500);
  }

  /* ---------- Dialogs ---------- */

  function closeDialog() {
    if (!activeDialog) return;
    const current = activeDialog;
    activeDialog = null;
    current.overlay.remove();
    if (!state.disposed && returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
    returnFocus = null;
  }

  function makeDialog(className, title) {
    closeDialog();
    if (!state.disposed) returnFocus = document.activeElement;
    const overlay = el("div", "paint-overlay");
    const panel = el("div", `paint-dialog ${className}`);
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const headingId = `${uid}-${className}-title`;
    const heading = el("h2", "paint-dialog-title", title);
    heading.id = headingId;
    panel.setAttribute("aria-labelledby", headingId);
    const closeX = makeButton("×", "cancel", "paint-dialog-x");
    closeX.setAttribute("aria-label", "Close dialog");
    const body = el("div", "paint-dialog-body");
    panel.append(closeX, heading, body);
    overlay.append(panel);
    root.append(overlay);
    activeDialog = { overlay, panel, body };

    const dismiss = () => closeDialog();
    closeX.addEventListener("click", dismiss);
    on(panel, "keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...panel.querySelectorAll("button:not([disabled]),input:not([disabled]),select:not([disabled])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    (panel.querySelector("button") || panel).focus?.({ preventScroll: true });
    return activeDialog;
  }

  async function folderChoices() {
    let folders = [];
    try {
      folders = ((await files?.list?.("root")) || []).filter((entry) => entry?.kind === "folder");
    } catch {
      folders = [];
    }
    if (!folders.length) folders = [{ id: "documents", name: "Documents" }];
    return folders;
  }

  function nameAndFolderForm(body, defaultName, defaultParent) {
    const form = el("form", "paint-form");
    const nameLabel = el("label", "paint-field");
    nameLabel.append(el("span", "paint-control-label", "File name"));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "paint-file-name";
    nameInput.value = defaultName;
    nameLabel.append(nameInput);
    const parentLabel = el("label", "paint-field");
    parentLabel.append(el("span", "paint-control-label", "Folder"));
    const parentSelect = document.createElement("select");
    parentSelect.className = "paint-parent";
    parentLabel.append(parentSelect);
    form.append(nameLabel, parentLabel);
    return { form, nameInput, parentSelect, parentLabel };
  }

  async function addFolderOptions(parentSelect, folders, preferred) {
    parentSelect.replaceChildren();
    for (const folder of folders) {
      const option = document.createElement("option");
      option.value = folder.id;
      option.textContent = folder.name;
      parentSelect.append(option);
    }
    parentSelect.value = folders.some((folder) => folder.id === preferred) ? preferred : folders[0].id;
  }

  /* ---------- Export, Save and Save As ---------- */

  function download() {
    const url = URL.createObjectURL(state.lastBlobForDownload || null);
    objectUrls.add(url);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeName(state.name);
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    const timer = later(() => {
      URL.revokeObjectURL(url);
      objectUrls.delete(url);
    }, 1000);
    void timer;
    clearError();
  }

  async function downloadCurrent() {
    const blob = await engine.toBlob();
    state.lastBlobForDownload = blob;
    download();
  }

  function failureDialog(error) {
    const message = describeError(error);
    showError(message);
    const { body } = makeDialog("paint-failure-dialog", "Nothing was saved");
    body.append(el("p", "", message));
    body.append(el("p", "paint-dialog-note", "Your drawing is still in the canvas. Choose how to keep it."));
    const actions = el("div", "paint-dialog-actions");
    const copy = makeButton("Save a copy", "save-copy", "paint-primary");
    const skip = makeButton("Download a copy", "download");
    const cancel = makeButton("Keep editing", "cancel", "paint-quiet");
    actions.append(copy, skip, cancel);
    body.append(actions);
    cancel.addEventListener("click", closeDialog);
    skip.addEventListener("click", () => { closeDialog(); downloadCurrent(); });
    copy.addEventListener("click", () => { closeDialog(); saveAs(); });
  }

  function conflictDialog() {
    const { body } = makeDialog("paint-conflict-dialog", "Saved file changed");
    body.append(el("p", "", "A newer version was saved since this window opened. Nothing was overwritten."));
    const actions = el("div", "paint-dialog-actions");
    const reload = makeButton("Reload saved file", "reload", "paint-primary");
    const copy = makeButton("Save a copy", "copy", "paint-copy");
    const cancel = makeButton("Cancel", "cancel", "paint-quiet");
    actions.append(reload, copy, cancel);
    body.append(actions);
    cancel.addEventListener("click", closeDialog);
    copy.addEventListener("click", () => { closeDialog(); saveAs(); });
    reload.addEventListener("click", async () => {
      try {
        await loadFileIntoCanvas(state.fileId);
        closeDialog();
        state.note = "Reloaded the saved version";
        setDirty(false);
      } catch (error) {
        failureDialog(error);
      }
    });
  }

  async function decodeIntoCanvas(blob, declaredType) {
    const validation = await inspectImage(blob, { declaredType });
    const decoded = await decodeImage(blob, validation, { signal });
    try {
      engine.initializeFromImage(decoded.image);
    } finally {
      decoded.release();
    }
    return validation;
  }

  async function loadFileIntoCanvas(id) {
    const entry = await files.read(id);
    state.sourceFileId = entry.id;
    state.sourceRevision = entry.revision;
    if (state.editCopy) {
      state.fileId = null;
      state.baseRevision = null;
      state.name = `Copy of ${entry.name}`;
      state.origin = "copy";
      bumpDocument();
      if (entry.blob) await decodeIntoCanvas(entry.blob, entry.mediaType);
      state.savedNotice = false;
      state.note = "Editing a copy — Save As to keep your changes";
      setDirty(false);
      state.note = "Editing a copy — Save As to keep your changes";
      bindCurrentDocument();
      paintStatus();
      return entry;
    }
    state.fileId = entry.id;
    state.name = entry.name;
    state.baseRevision = entry.revision;
    state.origin = entry.origin || null;
    bumpDocument();
    if (entry.blob) await decodeIntoCanvas(entry.blob, entry.mediaType);
    state.savedNotice = true;
    state.note = state.origin === "import" ? "Imported original — use Save As for edits" : "";
    setDirty(false);
    state.note = state.origin === "import" ? "Imported original — use Save As for edits" : "";
    paintStatus();
    return entry;
  }

  async function save() {
    if (state.disposed) return false;
    clearError();
    await stopDraftWrites();
    if (!files || state.storageMode === "temporary") {
      showError("Not saved — download a copy. Storage is unavailable.");
      paintStatus();
      return false;
    }
    if (!state.fileId || state.origin === "import" || state.origin === "picker" || state.origin === "copy") {
      return saveAs();
    }
    return trackSave(async () => {
      const generation = state.editGeneration;
      const token = state.documentToken;
      const draftIdAtSave = state.draftId;
      const fileId = state.fileId;
      const revision = state.baseRevision;
      state.lastCommit = null;
      try {
        const blob = await engine.toBlob();
        const entry = await files.write(
          fileId,
          { blob, image: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT } },
          revision,
          { draftId: draftIdAtSave },
        );
        state.lastCommit = {
          ok: true,
          generation,
          documentToken: token,
          draftId: draftIdAtSave,
          revision: entry.revision,
          fileId: entry.id,
        };
        if (state.disposed || state.documentToken !== token) {
          state.note = "An older save finished after the document changed";
          paintStatus();
          return false;
        }
        state.fileId = entry.id;
        state.name = entry.name;
        state.baseRevision = entry.revision;
        state.origin = entry.origin || "created";
        if (state.editGeneration !== generation) {
          state.savedNotice = false;
          state.note = "Newer drawing is still unsaved — a saved copy exists";
          setDirty(true);
          scheduleDraft();
          paintStatus();
          return false;
        }
        state.savedNotice = true;
        state.note = "";
        setDirty(false);
        paintStatus();
        return true;
      } catch (error) {
        state.lastCommit = null;
        if (error?.code === "REVISION_CONFLICT") {
          conflictDialog();
          return false;
        }
        failureDialog(error);
        return false;
      }
    });
  }

  async function saveAs() {
    if (state.disposed) return false;
    clearError();
    if (!files || state.storageMode === "temporary") {
      showError("Not saved — download a copy. Storage is unavailable.");
      return false;
    }
    const folders = await folderChoices();
    const { body } = makeDialog("paint-save-dialog", "Save a copy");
    const { form, nameInput, parentSelect } = nameAndFolderForm(
      body,
      safeName(state.name === "Untitled" ? "drawing.png" : state.name),
      "documents",
    );
    nameInput.classList.add("paint-save-name");
    parentSelect.classList.add("paint-save-parent");
    await addFolderOptions(parentSelect, folders, "documents");
    const actions = el("div", "paint-dialog-actions");
    const create = makeButton("Save here", "create", "paint-primary paint-create");
    const cancel = makeButton("Cancel", "cancel", "paint-quiet paint-cancel");
    actions.append(create, cancel);
    form.append(actions);
    body.append(form);
    nameInput.focus();
    nameInput.select();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      let creating = false;
      cancel.addEventListener("click", () => { closeDialog(); finish(false); });
      form.addEventListener("submit", (event) => { event.preventDefault(); create.click(); });
      create.addEventListener("click", async () => {
        if (creating) return;
        const name = safeName(nameInput.value);
        if (!name) {
          showError("Give the file a name before saving.");
          nameInput.focus();
          return;
        }
        creating = true;
        create.disabled = true;
        const generation = state.editGeneration;
        const token = state.documentToken;
        const draftIdAtSave = state.draftId;
        state.lastCommit = null;
        try {
          if (state.saveInFlight) await state.saveInFlight.catch(() => {});
          await stopDraftWrites();
          const entry = await trackSave(async () => {
            const blob = await engine.toBlob();
            return files.create({
              parentId: parentSelect.value,
              name,
              kind: "file",
              mediaType: "image/png",
              blob,
              image: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
              origin: "created",
            }, { draftId: draftIdAtSave });
          });
          state.lastCommit = {
            ok: true,
            generation,
            documentToken: token,
            draftId: draftIdAtSave,
            revision: entry.revision,
            fileId: entry.id,
          };
          if (state.disposed || state.documentToken !== token) {
            state.note = "An older save finished after the document changed";
            paintStatus();
            closeDialog();
            finish(false);
            return;
          }
          state.fileId = entry.id;
          state.name = entry.name;
          state.baseRevision = entry.revision;
          state.origin = entry.origin || "created";
          bumpDocument();
          bindCurrentDocument();
          if (state.editGeneration !== generation) {
            state.savedNotice = false;
            state.note = `Newer drawing is still unsaved — ${entry.name} holds an older copy`;
            setDirty(true);
            scheduleDraft();
            closeDialog();
            paintStatus();
            finish(false);
            return;
          }
          state.savedNotice = true;
          state.note = `Saved as ${entry.name}`;
          setDirty(false);
          closeDialog();
          paintStatus();
          finish(true);
        } catch (error) {
          state.lastCommit = null;
          closeDialog();
          if (error?.code === "REVISION_CONFLICT") conflictDialog();
          else failureDialog(error);
          finish(false);
        } finally {
          creating = false;
          create.disabled = false;
        }
      });
    });
  }

  /* ---------- Open, import and original preservation ---------- */

  function openApp(appId, extra = {}) {
    services.openApp?.(appId, { mode: "browse", source: openButton, ...extra });
  }

  async function openDialog() {
    const { body } = makeDialog("paint-open-dialog", "Open a saved picture");
    body.append(el("p", "paint-dialog-note", "Saved pictures live in this browser. Opening one uses its own Paint window."));
    const list = el("div", "paint-open-list");
    let entries = [];
    try {
      const [pictures, documents] = await Promise.all([files?.list?.("pictures"), files?.list?.("documents")]);
      entries = [...(pictures || []), ...(documents || [])].filter((entry) =>
        entry?.kind === "file" && String(entry.mediaType || "").startsWith("image/"));
    } catch {
      entries = [];
    }
    if (!entries.length) list.append(el("p", "paint-empty", "No saved pictures yet."));
    for (const entry of entries) {
      const item = makeButton(`${entry.name} · ${entry.size} bytes`, "select-file", "paint-open-item");
      item.dataset.fileId = entry.id;
      item.addEventListener("click", () => {
        list.querySelectorAll(".paint-open-item").forEach((node) => node.removeAttribute("aria-current"));
        item.setAttribute("aria-current", "true");
        state.openSelection = entry.id;
      });
      list.append(item);
    }
    body.append(list);
    const actions = el("div", "paint-dialog-actions");
    const browse = makeButton("Browse in Files", "browse", "paint-quiet");
    const openNew = makeButton("Open in a new window", "open-new", "paint-primary");
    const cancel = makeButton("Cancel", "cancel", "paint-quiet paint-cancel");
    actions.append(openNew, browse, cancel);
    body.append(actions);
    cancel.addEventListener("click", closeDialog);
    browse.addEventListener("click", () => { closeDialog(); openApp("files"); });
    openNew.addEventListener("click", () => {
      if (!state.openSelection) {
        showError("Choose a picture from the list first.");
        return;
      }
      const id = state.openSelection;
      state.openSelection = null;
      closeDialog();
      openApp("paint", { mode: "edit", fileId: id });
    });
  }

  async function keepOriginalDialog() {
    if (!state.originalFile || !files) return;
    const { body } = makeDialog("paint-original-dialog", "Keep the original file");
    body.append(el("p", "paint-dialog-note", "This stores the untouched bytes you picked as a separate file. Your drawing stays unsaved until you choose Save As."));
    const folders = await folderChoices();
    const { form, nameInput, parentSelect } = nameAndFolderForm(
      body,
      safeName(state.originalFile.name),
      "pictures",
    );
    nameInput.classList.add("paint-original-name");
    await addFolderOptions(parentSelect, folders, "pictures");
    const actions = el("div", "paint-dialog-actions");
    const create = makeButton("Store original", "create", "paint-primary paint-create");
    const cancel = makeButton("Cancel", "cancel", "paint-quiet paint-cancel");
    actions.append(create, cancel);
    form.append(actions);
    body.append(form);
    nameInput.focus();
    nameInput.select();
    cancel.addEventListener("click", closeDialog);
    form.addEventListener("submit", (event) => { event.preventDefault(); create.click(); });
    create.addEventListener("click", async () => {
      const name = safeName(nameInput.value, safeName(state.originalFile.name));
      try {
        const input = {
          parentId: parentSelect.value,
          name,
          blob: state.originalFile,
          mediaType: state.originalValidation.mediaType,
          image: { width: state.originalValidation.width, height: state.originalValidation.height },
          origin: "import",
        };
        const entry = files.createImage
          ? await files.createImage(input)
          : await files.create({ ...input, kind: "file" });
        state.originalStoredId = entry.id;
        keepOriginal.hidden = true;
        keepOriginal.disabled = true;
        state.note = `Original saved as ${entry.name}; your drawing is still unsaved`;
        closeDialog();
        clearError();
        paintStatus();
      } catch (error) {
        showError(describeError(error));
      }
    });
  }

  on(fileInput, "change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    let validation;
    try {
      validation = await inspectImage(file, { declaredType: file.type });
    } catch (error) {
      showError(describeError(error));
      return;
    }
    if (!(await canClose())) return;
    let decoded = null;
    try {
      decoded = await decodeImage(file, validation, { signal });
      engine.initializeFromImage(decoded.image);
    } catch (error) {
      showError(describeError(error));
      return;
    } finally {
      decoded?.release();
    }
    await stopDraftWrites();
    state.fileId = null;
    state.baseRevision = null;
    state.name = file.name;
    state.origin = "picker";
    bumpDocument();
    state.originalFile = file;
    state.originalValidation = validation;
    state.originalStoredId = null;
    keepOriginal.hidden = false;
    keepOriginal.disabled = false;
    state.note = `Imported ${file.name} — original untouched`;
    markEdited();
    bindCurrentDocument();
  });

  /* ---------- Tools, colors, width, coordinates ---------- */

  function selectTool(tool) {
    try {
      engine.setTool(tool);
    } catch {
      return;
    }
    for (const [name, button] of toolButtons) button.setAttribute("aria-pressed", String(name === tool));
    paintStatus();
  }

  function selectColor(color) {
    try {
      engine.setColor(color);
    } catch {
      return;
    }
    for (const [value, swatch] of swatches) swatch.setAttribute("aria-pressed", String(value === color));
    customColor.value = color;
    paintStatus();
  }

  function setCursorFromInputs() {
    const x = Number(xInput.value);
    const y = Number(yInput.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      showError("Enter whole X and Y coordinates from 0 to 1023 and 0 to 767.");
      return;
    }
    const point = engine.setCursor({ x, y });
    xInput.value = String(point.x);
    yInput.value = String(point.y);
    paintStatus();
  }

  on(toolbar, "click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target || !toolbar.contains(target)) return;
    if (target.dataset.tool) {
      selectTool(target.dataset.tool);
      return;
    }
    switch (target.dataset.action) {
      case "new": openApp("paint", { mode: "edit", source: newButton }); break;
      case "open": openDialog(); break;
      case "import": fileInput.click(); break;
      case "keep-original": keepOriginalDialog(); break;
      case "save": save(); break;
      case "save-as": saveAs(); break;
      case "download": downloadCurrent(); break;
      case "undo": engine.undo(); markEdited(); break;
      case "redo": engine.redo(); markEdited(); break;
      case "clear": engine.clear(); markEdited(); break;
      case "fit": fitCanvas(); break;
      case "set-cursor": setCursorFromInputs(); break;
      default: break;
    }
  });

  for (const [color, swatch] of swatches) {
    on(swatch, "click", () => selectColor(color));
  }
  on(setCursorButton, "click", setCursorFromInputs);
  on(customColor, "input", () => selectColor(customColor.value));
  on(widthInput, "input", () => {
    engine.setLineWidth(Number(widthInput.value) || MIN_LINE_WIDTH);
    paintStatus();
  });

  /* ---------- Pointer drawing with native capture ---------- */

  function releasePointer(id) {
    state.activePointerId = null;
    try { canvas.releasePointerCapture(id); } catch { /* capture may already be gone */ }
  }

  on(canvas, "pointerdown", (event) => {
    if (state.disposed || activeDialog || event.button !== 0 || state.activePointerId !== null) return;
    event.preventDefault();
    state.activePointerId = event.pointerId;
    state.historySignature = historySignature();
    try { canvas.setPointerCapture(event.pointerId); } catch { /* capture is an enhancement */ }
    engine.beginStroke(engine.pointFromEvent(event));
    paintStatus();
  });
  on(canvas, "pointermove", (event) => {
    if (event.pointerId !== state.activePointerId) return;
    event.preventDefault();
    engine.extendStroke(engine.pointFromEvent(event));
    const point = engine.getState().cursor;
    xInput.value = String(point.x);
    yInput.value = String(point.y);
    paintStatus();
  });
  on(canvas, "pointerup", (event) => {
    if (event.pointerId !== state.activePointerId) return;
    event.preventDefault();
    engine.endStroke();
    markEdited();
    releasePointer(event.pointerId);
    paintStatus();
  });
  on(canvas, "pointercancel", (event) => {
    if (event.pointerId !== state.activePointerId) return;
    event.preventDefault();
    engine.cancelStroke();
    releasePointer(event.pointerId);
    paintStatus();
  });
  on(canvas, "lostpointercapture", (event) => {
    if (event.pointerId !== state.activePointerId) return;
    if (engine.getState().strokeActive) engine.cancelStroke();
    state.activePointerId = null;
    paintStatus();
  });

  /* ---------- Scoped keyboard drawing ---------- */

  on(root, "keydown", (event) => {
    if (state.disposed || activeDialog || event.isComposing || event.keyCode === 229) return;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select, button")) return;
    if (event.ctrlKey || event.metaKey) {
      const key = String(event.key || "").toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) engine.redo(); else engine.undo();
        markEdited();
      } else if (key === "y") {
        event.preventDefault();
        engine.redo();
        markEdited();
      }
      return;
    }
    if (event.altKey) return;
    const arrows = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const arrow = arrows[event.key];
    if (arrow) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      engine.moveCursor(arrow[0] * step, arrow[1] * step);
      const point = engine.getState().cursor;
      xInput.value = String(point.x);
      yInput.value = String(point.y);
      paintStatus();
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      engine.stampAtCursor();
      markEdited();
      return;
    }
    if (event.key === "Escape" && engine.getState().strokeActive) {
      event.preventDefault();
      engine.cancelStroke();
      paintStatus();
    }
  });

  /* ---------- Close guard and lifetime ---------- */

  async function canClose() {
    if (state.disposed) return true;
    if (state.closePromise) return state.closePromise;
    await settlePendingSaves();
    if (state.disposed || !state.dirty) return true;
    state.closePromise = new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        state.closePromise = null;
        resolve(value);
      };
      const { body } = makeDialog("paint-close-dialog", "Save changes before closing?");
      body.append(el("p", "", "Your drawing stays in a recoverable draft until you choose. You can cancel and keep editing."));
      const actions = el("div", "paint-dialog-actions");
      const saveIt = makeButton("Save", "save", "paint-primary paint-save");
      const discard = makeButton("Discard", "discard", "paint-discard");
      const cancel = makeButton("Cancel", "cancel", "paint-quiet paint-cancel");
      actions.append(saveIt, discard, cancel);
      body.append(actions);
      cancel.addEventListener("click", () => { closeDialog(); finish(false); });
      discard.addEventListener("click", async () => {
        await stopDraftWrites();
        try { await files?.deleteDraft?.(state.draftId); } catch { /* editing stays available */ }
        closeDialog();
        setDirty(false);
        finish(true);
      });
      saveIt.addEventListener("click", async () => {
        await settlePendingSaves();
        await save();
        if (!state.dirty) {
          closeDialog();
          finish(true);
          return;
        }
        finish(false);
      });
    });
    return state.closePromise;
  }

  async function loadInitial() {
    try {
      if (draftId && files?.readDraft) {
        const draft = await files.readDraft(draftId);
        if (draft?.payload?.blob) {
          await decodeIntoCanvas(draft.payload.blob, "image/png");
          state.draftId = draft.draftId;
          state.sourceFileId = draft.fileId || null;
          state.sourceRevision = draft.baseRevision || null;
          state.fileId = state.editCopy ? null : draft.fileId || null;
          state.baseRevision = state.editCopy ? null : draft.baseRevision || null;
          state.name = state.editCopy ? "Copy of recovered draft" : "Recovered draft";
          state.origin = state.editCopy ? "copy" : draft.fileId ? "created" : null;
          state.note = state.editCopy
            ? "Recovered draft as a copy — Save As to keep it"
            : "Recovered unsaved draft — not saved to the file";
          bumpDocument();
          setDirty(true);
          bindCurrentDocument();
          paintStatus();
          return;
        }
      }
      if (state.fileId && files?.read) await loadFileIntoCanvas(state.fileId);
    } catch (error) {
      showError(describeError(error));
      state.fileId = null;
      state.baseRevision = null;
      state.name = "Untitled";
      state.note = "";
      setDirty(false);
    }
    paintStatus();
  }

  await loadInitial();

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => fitCanvas());
    resizeObserver.observe(stage);
  }
  fitCanvas();
  if (typeof requestAnimationFrame === "function") {
    rafId = requestAnimationFrame(() => { rafId = null; fitCanvas(); });
  }
  paintStatus();

  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    state.epoch += 1;
    cancelLater(debounce);
    debounce = null;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    if (rafId !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
    resizeObserver?.disconnect();
    for (const [target, type, handler] of listeners) target.removeEventListener(type, handler);
    listeners.length = 0;
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
    const generationAtDispose = state.editGeneration;
    const tokenAtDispose = state.documentToken;
    const draftIdAtDispose = state.draftId;
    const snapshot = state.dirty && files?.putDraft
      ? engine.toBlob().catch(() => null)
      : null;
    if (snapshot) {
      const flushDraft = async (blob) => {
        if (!blob) return;
        // A successful commit for this exact snapshot deletes its draft in the
        // same transaction. Recreating it here would leave a stale draft beside
        // a fully saved file; a failed or newer commit still needs recovery.
        const commit = state.lastCommit;
        if (commit?.ok && commit.generation === generationAtDispose &&
            commit.documentToken === tokenAtDispose && commit.draftId === draftIdAtDispose) {
          return;
        }
        await writeDraft(blob);
      };
      const pendingSave = (state.saveInFlight || saveLock).catch(() => {});
      state.queue = state.queue.catch(() => {})
        .then(() => pendingSave)
        .then(() => snapshot)
        .then(flushDraft)
        .catch(() => {});
    }
    signal?.removeEventListener?.("abort", onAbort);
    closeDialog();
    engine.dispose();
    root.remove();
  }

  return {
    canClose,
    focus() {
      if (activeDialog) activeDialog.panel.querySelector("button")?.focus({ preventScroll: true });
      else canvas.focus({ preventScroll: true });
    },
    dispose,
  };
}

export default { mount };
