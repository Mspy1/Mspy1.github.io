/* Sticky Notes: small local notes with autosave, color, pin, search, bounded
   text, a time-bounded delete undo, and explicit export when storage fails.
   Only the stickyNotes store is used; no global listeners or markup strings. */

import { NOTE_COLORS, NOTE_LIMITS, matchesSearch, notePreview, sanitizeText, sortNotes } from "./sticky-logic.mjs";
import { openStickyStore } from "./sticky-store.mjs";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const COLOR_LABELS = Object.freeze({ sun: "Sun", mint: "Mint", sky: "Sky", lilac: "Lilac" });
let instanceCount = 0;

export async function mount({ container, windowId, services = {}, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Sticky Notes needs a DOM container");
  }
  if (signal?.aborted) throw new DOMException("Sticky Notes window was closed while loading", "AbortError");

  const injectedStore = services.stickyStore || null;
  const store = injectedStore || (await openStickyStore());
  const uid = `sn-${++instanceCount}`;
  const root = el("section", "sn-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Sticky Notes");

  let disposed = false;
  let notes = [];
  let selectedId = null;
  let dirtyId = null;
  let pendingText = "";
  let statusTextValue = "Loading notes…";
  let activeDialog = null;
  let returnFocus = null;
  let undoRecord = null;
  let undoTimer = null;
  let countdownTimer = null;
  let debounce = null;
  let writeQueue = Promise.resolve();
  let textGeneration = 0;
  const timers = new Set();
  const objectUrls = new Set();

  /* ---------- Layout ---------- */

  const header = el("header", "sn-header");
  const eyebrow = el("span", "sn-eyebrow", "Findows · notes");
  const title = el("h1", "sn-title", "Sticky Notes");
  title.tabIndex = -1;
  const lead = el("p", "sn-lead", "Short notes stay in this browser. Edits save themselves; deleting keeps an Undo for a few seconds.");
  header.append(eyebrow, title, lead);

  const toolbar = el("div", "sn-toolbar");
  const newButton = el("button", "sn-button sn-new", "New note");
  newButton.type = "button";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "sn-search";
  search.placeholder = "Search notes";
  search.setAttribute("aria-label", "Search notes");
  toolbar.append(newButton, search);

  const statusRow = el("div", "sn-status-row");
  const status = el("span", "sn-status", statusTextValue);
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const modeChip = el("span", "sn-mode-chip", "Saved on this device");
  statusRow.append(status, modeChip);

  const conflictBar = el("div", "sn-conflict-bar");
  conflictBar.hidden = true;
  const reloadButton = el("button", "sn-button sn-reload", "Reload saved note");
  reloadButton.type = "button";
  const keepButton = el("button", "sn-button sn-keep", "Keep my text");
  keepButton.type = "button";
  conflictBar.append(el("span", "", "Another window changed this note. Nothing was overwritten."), reloadButton, keepButton);

  const layout = el("div", "sn-layout");
  const list = el("div", "sn-list");
  list.setAttribute("aria-label", "Notes");
  const empty = el("p", "sn-empty", "No notes yet. Choose New note to start one.");
  const editorPanel = el("section", "sn-editor-panel");
  const editorHead = el("div", "sn-editor-head");
  const editorLabel = el("span", "sn-editor-label", "No note selected");
  const pinButton = el("button", "sn-button sn-pin", "Pin");
  pinButton.type = "button";
  pinButton.setAttribute("aria-pressed", "false");
  const deleteButton = el("button", "sn-button sn-delete sn-danger", "Delete");
  deleteButton.type = "button";
  const copyButton = el("button", "sn-button sn-copy", "Copy text");
  copyButton.type = "button";
  const downloadButton = el("button", "sn-button sn-download", "Download note");
  downloadButton.type = "button";
  editorHead.append(editorLabel, pinButton, copyButton, downloadButton, deleteButton);

  const colors = el("div", "sn-colors");
  colors.setAttribute("role", "group");
  colors.setAttribute("aria-label", "Note color");
  const colorButtons = [];
  for (const color of NOTE_COLORS) {
    const item = el("button", `sn-button sn-color sn-color-${color}`);
    item.type = "button";
    item.dataset.color = color;
    item.setAttribute("aria-label", `${COLOR_LABELS[color]} note color`);
    item.setAttribute("aria-pressed", "false");
    colorButtons.push(item);
    colors.append(item);
  }

  const text = document.createElement("textarea");
  text.className = "sn-text";
  text.setAttribute("aria-label", "Note text");
  text.maxLength = NOTE_LIMITS.MAX_TEXT;
  text.setAttribute("aria-describedby", `${uid}-hint`);
  text.spellcheck = false;
  const hint = el("p", "sn-hint", "Plain text only. Notes stay in this browser and are not shared.", `${uid}-hint`);
  hint.id = `${uid}-hint`;
  const editorFoot = el("div", "sn-editor-foot");
  const count = el("span", "sn-count", `0 / ${NOTE_LIMITS.MAX_TEXT}`);
  const revision = el("span", "sn-revision", "");
  editorFoot.append(count, revision);
  editorPanel.append(editorHead, colors, text, hint, editorFoot);
  layout.append(list, editorPanel);

  const undo = el("div", "sn-undo");
  undo.setAttribute("role", "status");
  undo.hidden = true;
  const undoLabel = el("span", "sn-undo-label", "Note deleted.");
  const undoButton = el("button", "sn-button sn-undo-button", "Undo");
  undoButton.type = "button";
  undo.append(undoLabel, undoButton);

  root.append(header, toolbar, statusRow, conflictBar, layout, undo);
  container.replaceChildren(root);

  /* ---------- Status and dialogs ---------- */

  function setStatus(message) {
    statusTextValue = message;
    if (!disposed) status.textContent = message;
    const temporary = store.getMode?.() === "temporary" || /not saved|conflict/i.test(message);
    modeChip.textContent = temporary ? "Not saved — export a copy" : "Saved on this device";
  }

  function closeDialog() {
    if (!activeDialog) return;
    const current = activeDialog;
    activeDialog = null;
    current.overlay.remove();
    if (!disposed && returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
    returnFocus = null;
  }

  function makeDialog(className, heading) {
    closeDialog();
    if (!disposed) returnFocus = document.activeElement;
    const overlay = el("div", "sn-overlay");
    const panel = el("div", `sn-dialog ${className}`);
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const headingId = `${uid}-${className}-title`;
    const h = el("h2", "sn-dialog-title", heading);
    h.id = headingId;
    panel.setAttribute("aria-labelledby", headingId);
    const closeX = el("button", "sn-button sn-dialog-x", "×");
    closeX.type = "button";
    closeX.setAttribute("aria-label", "Close dialog");
    const body = el("div", "sn-dialog-body");
    panel.append(closeX, h, body);
    overlay.append(panel);
    root.append(overlay);
    activeDialog = { overlay, panel, body };
    closeX.addEventListener("click", closeDialog);
    panel.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); closeDialog(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...panel.querySelectorAll("button:not([disabled])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    (body.querySelector("button") || closeX).focus({ preventScroll: true });
    return body;
  }

  /* ---------- Rendering ---------- */

  function currentText() {
    return dirtyId && dirtyId === selectedId ? pendingText : text.value;
  }

  function renderList() {
    list.replaceChildren();
    const visible = notes.filter((note) => matchesSearch(note, search.value));
    for (const note of visible) {
      const item = el("button", `sn-button sn-note-item sn-color-${note.color}`);
      item.type = "button";
      item.dataset.id = note.id;
      if (note.id === selectedId) item.setAttribute("aria-current", "true");
      item.append(
        el("span", "sn-note-pin", note.pinned ? "●" : ""),
        el("span", "sn-note-preview", notePreview(note)),
      );
      item.addEventListener("click", () => selectNote(note.id));
      list.append(item);
    }
    empty.hidden = visible.length > 0 || notes.length > 0;
    if (!notes.length) list.append(empty);
    else if (!visible.length) list.append(el("p", "sn-empty", "No notes match this search."));
    newButton.disabled = notes.length >= NOTE_LIMITS.MAX_NOTES;
  }

  function renderEditor() {
    const note = notes.find((item) => item.id === selectedId) || null;
    if (!note) {
      editorLabel.textContent = "No note selected";
      text.value = "";
      text.disabled = true;
      pinButton.disabled = true;
      deleteButton.disabled = true;
      for (const item of colorButtons) item.disabled = true;
      count.textContent = `0 / ${NOTE_LIMITS.MAX_TEXT}`;
      revision.textContent = "";
      return;
    }
    text.disabled = false;
    pinButton.disabled = false;
    deleteButton.disabled = false;
    for (const item of colorButtons) item.disabled = false;
    editorLabel.textContent = `${COLOR_LABELS[note.color] || "Note"} note${note.pinned ? " · pinned" : ""}`;
    if (!(dirtyId && dirtyId === note.id)) text.value = note.text;
    pinButton.setAttribute("aria-pressed", String(note.pinned));
    for (const item of colorButtons) item.setAttribute("aria-pressed", String(item.dataset.color === note.color));
    const length = [...currentText()].length;
    count.textContent = `${length} / ${NOTE_LIMITS.MAX_TEXT}`;
    revision.textContent = note.revision > 0 ? `Revision ${note.revision}` : "Not saved yet";
  }

  function repaint() {
    if (disposed) return;
    renderList();
    renderEditor();
    status.textContent = statusTextValue;
  }

  /* ---------- Persistence ---------- */

  function handleFailure(error, id, patch) {
    if (error?.code === "REVISION_CONFLICT") {
      setStatus("Conflict — another window changed this note. Your text is kept.");
      conflictBar.hidden = false;
    } else {
      setStatus(`Not saved — ${error?.message || "storage unavailable"}`);
    }
    if (id) dirtyId = id;
    if (patch && "text" in patch) pendingText = sanitizeText(patch.text);
    services.setDirty?.(windowId, true);
    repaint();
  }

  async function commitUpdate(id, patch, generation) {
    const note = notes.find((item) => item.id === id);
    if (!note) return false;
    if (note.localOnly) {
      Object.assign(note, patch, { updatedAt: Date.now() });
      setStatus("Not saved — storage unavailable; export a copy");
      repaint();
      return false;
    }
    setStatus("Saving…");
    try {
      const updated = await store.update(id, patch, note.revision);
      notes = sortNotes(notes.map((item) => (item.id === id ? updated : item)));
      const superseded = Number.isInteger(generation) && generation !== textGeneration;
      if (superseded) {
        // An older snapshot committed while newer text is pending: keep the
        // newer edit dirty and say exactly what happened.
        setStatus("Saved an earlier version; your newer text is still not saved");
        services.setDirty?.(windowId, true);
        repaint();
        return true;
      }
      if (dirtyId === id && "text" in patch) dirtyId = null;
      setStatus("Saved locally");
      services.setDirty?.(windowId, false);
      repaint();
      return true;
    } catch (error) {
      handleFailure(error, id, patch);
      return false;
    }
  }

  async function flushText(generation) {
    if (debounce !== null) { clearTimeout(debounce); debounce = null; }
    const id = dirtyId;
    const value = pendingText;
    if (!id) return true;
    dirtyId = null;
    const saved = await commitUpdate(id, { text: value }, generation);
    if (!saved && notes.find((note) => note.id === id)) {
      dirtyId = id;
      pendingText = value;
    }
    return saved;
  }

  function scheduleText() {
    textGeneration += 1;
    const generation = textGeneration;
    dirtyId = selectedId;
    pendingText = sanitizeText(text.value);
    services.setDirty?.(windowId, true);
    setStatus("Saving…");
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      writeQueue = writeQueue.then(() => flushText(generation)).catch(() => false);
    }, 400);
  }

  async function selectNote(id) {
    if (debounce !== null || dirtyId) {
      writeQueue = writeQueue.then(() => flushText()).catch(() => false);
      await writeQueue;
    }
    if (disposed) return;
    selectedId = id;
    conflictBar.hidden = true;
    repaint();
  }

  /* ---------- Actions ---------- */

  async function createNote() {
    if (notes.length >= NOTE_LIMITS.MAX_NOTES) {
      setStatus(`You can keep up to ${NOTE_LIMITS.MAX_NOTES} notes in this browser.`);
      return;
    }
    await selectNote(selectedId);
    try {
      const note = await store.create({ text: "", color: "sun" });
      notes = [...notes, note];
      selectedId = note.id;
      dirtyId = null;
      conflictBar.hidden = true;
      setStatus("Saved locally");
    } catch (error) {
      const local = {
        id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        text: "", color: "sun", pinned: false, createdAt: Date.now(), updatedAt: Date.now(), revision: 0, localOnly: true,
      };
      notes = [...notes, local];
      selectedId = local.id;
      dirtyId = local.id;
      pendingText = "";
      setStatus(`Not saved — ${error?.message || "storage unavailable"}; export a copy`);
    }
    repaint();
    text.focus({ preventScroll: true });
  }

  async function removeNote() {
    const note = notes.find((item) => item.id === selectedId);
    if (!note) return;
    await selectNote(selectedId);
    let deleted = null;
    if (note.localOnly) {
      deleted = note;
      notes = notes.filter((item) => item.id !== note.id);
    } else {
      try {
        deleted = await store.remove(note.id, note.revision);
        notes = notes.filter((item) => item.id !== note.id);
        setStatus("Saved locally");
      } catch (error) {
        handleFailure(error, note.id, null);
        return;
      }
    }
    selectedId = notes[0]?.id ?? null;
    dirtyId = null;
    showUndo(deleted);
    repaint();
  }

  function stopUndo() {
    if (undoTimer !== null) { clearTimeout(undoTimer); undoTimer = null; }
    if (countdownTimer !== null) { clearInterval(countdownTimer); countdownTimer = null; }
    undo.hidden = true;
    undoRecord = null;
  }

  function showUndo(record) {
    stopUndo();
    undoRecord = record;
    undo.hidden = false;
    let remaining = Math.ceil(NOTE_LIMITS.UNDO_MS / 1000);
    undoLabel.textContent = `Note deleted. Undo in ${remaining}s.`;
    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) undoLabel.textContent = `Note deleted. Undo in ${remaining}s.`;
    }, 1000);
    undoTimer = setTimeout(stopUndo, NOTE_LIMITS.UNDO_MS);
  }

  async function undoDelete() {
    const record = undoRecord;
    if (!record) return;
    stopUndo();
    try {
      const restored = record.localOnly ? record : await store.restore(record);
      notes = [...notes, restored];
      selectedId = restored.id;
      dirtyId = restored.localOnly ? restored.id : null;
      setStatus(restored.localOnly ? "Not saved — storage unavailable" : "Saved locally");
    } catch (error) {
      handleFailure(error, null, null);
    }
    repaint();
  }

  function download() {
    const blob = new Blob([currentText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `findows-note-${Date.now()}.txt`;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    const timer = setTimeout(() => {
      timers.delete(timer);
      URL.revokeObjectURL(url);
      objectUrls.delete(url);
    }, 1000);
    timers.add(timer);
  }

  async function copy() {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      setStatus("Copy is blocked — this browser has no clipboard API. Use Download note instead.");
      status.textContent = statusTextValue;
      return;
    }
    try {
      await clipboard.writeText(currentText());
      setStatus("Note copied to the clipboard");
    } catch {
      setStatus("Copy was blocked — use Download note instead");
    }
    status.textContent = statusTextValue;
  }

  async function canClose() {
    if (disposed) return true;
    await writeQueue.catch(() => {});
    if (!dirtyId && !/not saved|conflict/i.test(statusTextValue)) return true;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        closeDialog();
        resolve(value);
      };
      const body = makeDialog("sn-close-dialog", "Keep this note?");
      body.append(el("p", "", "This note has unsaved changes. Save now, copy or download a copy, or discard the local changes."));
      const actions = el("div", "sn-dialog-actions");
      const saveNow = el("button", "sn-button sn-primary", "Save now");
      saveNow.type = "button";
      saveNow.dataset.action = "save";
      const copyNow = el("button", "sn-button", "Copy text");
      copyNow.type = "button";
      copyNow.dataset.action = "copy";
      const discard = el("button", "sn-button sn-danger", "Discard changes");
      discard.type = "button";
      discard.dataset.action = "discard";
      const cancel = el("button", "sn-button", "Cancel");
      cancel.type = "button";
      cancel.dataset.action = "cancel";
      actions.append(saveNow, copyNow, discard, cancel);
      body.append(actions);
      saveNow.addEventListener("click", async () => finish(await flushText()));
      copyNow.addEventListener("click", () => { copy(); });
      discard.addEventListener("click", () => {
        const note = notes.find((item) => item.id === dirtyId);
        if (note && !note.localOnly) text.value = note.text;
        dirtyId = null;
        conflictBar.hidden = true;
        services.setDirty?.(windowId, false);
        setStatus("Local changes discarded");
        finish(true);
      });
      cancel.addEventListener("click", () => finish(false));
    });
  }

  /* ---------- Wiring ---------- */

  newButton.addEventListener("click", () => { createNote(); });
  search.addEventListener("input", renderList);
  text.addEventListener("input", () => {
    scheduleText();
    count.textContent = `${[...text.value].length} / ${NOTE_LIMITS.MAX_TEXT}`;
  });
  pinButton.addEventListener("click", () => {
    const note = notes.find((item) => item.id === selectedId);
    if (note) commitUpdate(note.id, { pinned: !note.pinned });
  });
  for (const item of colorButtons) {
    item.addEventListener("click", () => {
      const note = notes.find((entry) => entry.id === selectedId);
      if (note) commitUpdate(note.id, { color: item.dataset.color });
    });
  }
  deleteButton.addEventListener("click", () => { removeNote(); });
  undoButton.addEventListener("click", () => { undoDelete(); });
  copyButton.addEventListener("click", () => { copy(); });
  downloadButton.addEventListener("click", download);
  reloadButton.addEventListener("click", async () => {
    try {
      const latest = await store.list();
      notes = latest;
      dirtyId = null;
      conflictBar.hidden = true;
      setStatus("Saved locally");
      repaint();
    } catch (error) {
      handleFailure(error, null, null);
    }
  });
  keepButton.addEventListener("click", () => { conflictBar.hidden = true; });

  /* ---------- Initial load and lifetime ---------- */

  try {
    await store.ready();
    notes = await store.list();
    selectedId = notes[0]?.id ?? null;
    setStatus(store.getMode?.() === "temporary" ? "Not saved — storage unavailable" : "Saved locally");
  } catch (error) {
    notes = [];
    selectedId = null;
    setStatus(`Not saved — ${error?.message || "storage unavailable"}`);
  }
  repaint();

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    if (debounce !== null) clearTimeout(debounce);
    debounce = null;
    stopUndo();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
    if (dirtyId) {
      const id = dirtyId;
      const value = pendingText;
      writeQueue = writeQueue.then(() => {
        const note = notes.find((item) => item.id === id);
        if (note && !note.localOnly) return store.update(id, { text: value }, note.revision);
      }).catch(() => {});
    }
    closeDialog();
    root.remove();
    if (!injectedStore) store.close?.();
  }
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  return {
    canClose,
    focus: () => (text.disabled ? newButton.focus({ preventScroll: true }) : text.focus({ preventScroll: true })),
    dispose,
  };
}

export default { mount };
