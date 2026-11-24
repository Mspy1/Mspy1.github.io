/* Notepad: an accessible plain-text editor built only from textContent and
   native controls. All keyboard handling is scoped to this app's own root;
   composition events and browser navigation shortcuts are never intercepted.
   Storage is reached only through services.files; every draft belongs to one
   editor window, and no saved file changes without an explicit revision-checked
   Save that the service commits atomically. */
import {
  MAX_IMPORT_BYTES,
  decodeText,
  describeError,
  findMatches,
  lineColumn,
  nextMatch,
  safeDownloadName,
  validateTextImport,
} from "./notepad-logic.mjs";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const button = (label, action, className = "np-button") => {
  const node = el("button", className, label);
  node.type = "button";
  node.dataset.action = action;
  return node;
};

let instanceCount = 0;

export async function mount({ container, windowId, fileId = null, mode, draftId = null, services = {}, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Notepad needs a DOM container");
  }
  if (signal?.aborted) throw new DOMException("Notepad window was closed while loading", "AbortError");

  const files = services.files || null;
  const newDraftId = () =>
    files?.newDraftId?.("notepad") ||
    `notepad-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
  const uid = `np-${++instanceCount}`;
  const root = el("section", "np-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Notepad");

  const state = {
    fileId: fileId || null,
    name: "Untitled",
    baseRevision: null,
    draftId: draftId || newDraftId(),
    dirty: false,
    savedNotice: false,
    wrap: false,
    mode: files?.getStorageMode?.() || (mode === "temporary" ? "temporary" : "persistent"),
    draftProblem: "",
    note: "",
    epoch: 0,
    queue: Promise.resolve(),
    closePromise: null,
    saveLock: null,
    docEpoch: 0,
    namingDialog: false,
    lastCommit: null,
    disposed: false,
  };
  const timers = new Set();
  const objectUrls = new Set();
  let debounce = null;
  let activeDialog = null;
  let returnFocus = null;

  /* ---------- Chrome ---------- */

  const toolbar = el("div", "np-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Notepad actions");
  const newButton = button("New", "new", "np-button np-new");
  const openButton = button("Open…", "open", "np-button np-open");
  const saveButton = button("Save", "save", "np-button np-save np-primary");
  const saveAsButton = button("Save As…", "save-as", "np-button np-save-as");
  const downloadButton = button("Download a copy", "download", "np-button np-download");
  const findButton = button("Find", "find", "np-button np-find-toggle");
  const wrapButton = button("Word wrap", "wrap", "np-button np-wrap-toggle");
  wrapButton.setAttribute("aria-pressed", "false");
  const recoverButton = button("Recover drafts", "recover", "np-button np-recover");
  const filesButton = button("Files", "files", "np-button");
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.className = "np-file-input";
  fileInput.accept = ".txt,text/plain";
  fileInput.setAttribute("aria-label", "Import a UTF-8 text file");
  fileInput.hidden = true;
  toolbar.append(newButton, openButton, saveButton, saveAsButton, downloadButton,
    findButton, wrapButton, recoverButton, filesButton, fileInput);

  const findbar = el("div", "np-findbar");
  findbar.hidden = true;
  const findInput = document.createElement("input");
  findInput.type = "search";
  findInput.className = "np-find-input";
  findInput.placeholder = "Find in document";
  findInput.setAttribute("aria-label", "Find in document");
  const caseButton = button("Aa", "case", "np-button np-find-case");
  caseButton.setAttribute("aria-pressed", "false");
  caseButton.setAttribute("aria-label", "Match case");
  const findNext = button("Find next", "find-next", "np-button np-find-next");
  findNext.setAttribute("aria-keyshortcuts", "F3");
  const findClose = button("Close find", "find-close", "np-button np-find-close");
  findClose.setAttribute("aria-label", "Close find bar");
  findbar.append(findInput, caseButton, findNext, findClose);

  const recoveryPanel = el("div", "np-recovery-panel");
  recoveryPanel.hidden = true;

  const editor = document.createElement("textarea");
  editor.className = "np-editor";
  editor.setAttribute("aria-label", "Document text");
  editor.setAttribute("aria-describedby", `${uid}-hint`);
  editor.setAttribute("dir", "auto");
  editor.wrap = "off";
  editor.spellcheck = false;
  editor.setAttribute("autocapitalize", "off");

  const hint = el("p", "np-hint", "Plain text only. Text is never run as markup or code.");
  hint.id = `${uid}-hint`;
  const errorBox = el("div", "np-error");
  errorBox.setAttribute("role", "alert");
  errorBox.hidden = true;

  const statusbar = el("footer", "np-statusbar");
  const status = el("span", "np-status", "Ln 1, Col 1 · Untitled · Not saved");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const modeChip = el("span", "np-mode-chip", "Storage: local");
  statusbar.append(status, modeChip);

  root.append(toolbar, findbar, recoveryPanel, editor, hint, errorBox, statusbar);
  container.replaceChildren(root);

  /* ---------- Status and drafts ---------- */

  const setNote = (message) => {
    state.note = message || "";
    paintStatus();
  };

  const setDirty = (value) => {
    state.dirty = Boolean(value);
    if (value) {
      state.savedNotice = false;
      state.note = "";
    }
    services.setDirty?.(windowId, state.dirty);
    paintStatus();
  };

  function paintStatus() {
    if (state.disposed) return;
    services.bindDocument?.(windowId, { fileId: state.fileId, mode: "edit", draftId: state.draftId });
    const { line, column } = lineColumn(editor.value, editor.selectionStart);
    const label = state.dirty ? "Not saved" : state.savedNotice || state.fileId ? "Saved" : "Not saved";
    status.textContent = `Ln ${line}, Col ${column} · ${state.name} · ${label}${state.draftProblem ? ` · ${state.draftProblem}` : ""}${state.note ? ` · ${state.note}` : ""}`;
    modeChip.textContent = state.mode === "temporary"
      ? "Not saved — download a copy · storage unavailable"
      : "Storage: local to this browser";
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  function clearError() {
    errorBox.textContent = "";
    errorBox.hidden = true;
  }

  /** Cancel any pending debounce and wait for an in-flight draft request. */
  async function stopDraftWrites() {
    state.epoch += 1;
    if (debounce !== null) {
      clearTimeout(debounce);
      debounce = null;
    }
    await state.queue.catch(() => {});
  }

  function scheduleDraft() {
    if (state.disposed || !state.dirty || !files?.putDraft) return;
    const epoch = state.epoch;
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      state.queue = state.queue.then(async () => {
        if (state.disposed || state.epoch !== epoch || !state.dirty) return;
        try {
          const record = files.createDraft({
            appId: "notepad",
            draftId: state.draftId,
            fileId: state.fileId,
            baseRevision: state.baseRevision,
            payload: { text: editor.value },
            updatedAt: Date.now(),
          });
          await files.putDraft(record);
          state.draftProblem = "";
        } catch (error) {
          state.draftProblem = "Draft not saved — download a copy";
          if (error?.code === "UNAVAILABLE" || error?.code === "QUOTA") {
            state.mode = "temporary";
          }
        }
        paintStatus();
      }).catch(() => {});
    }, 220);
  }

  const onEdit = () => {
    setDirty(true);
    clearError();
    scheduleDraft();
  };
  editor.addEventListener("input", onEdit);
  for (const eventName of ["click", "keyup", "select"]) {
    editor.addEventListener(eventName, paintStatus);
  }

  /* ---------- Dialogs ---------- */

  function closeDialog() {
    if (!activeDialog) return;
    const current = activeDialog;
    activeDialog = null;
    current.overlay.remove();
    if (current.panel?.classList?.contains("np-save-dialog")) state.namingDialog = false;
    const target = returnFocus?.isConnected && !returnFocus.disabled ? returnFocus : editor;
    if (!state.disposed && target?.isConnected) target.focus?.({ preventScroll: true });
    returnFocus = null;
  }

  function makeDialog(className, title, { onEscape, returnFocus: requestedFocus } = {}) {
    closeDialog();
    if (!state.disposed) {
      returnFocus = requestedFocus?.isConnected ? requestedFocus : document.activeElement;
    }
    const overlay = el("div", "np-overlay");
    const panel = el("div", `np-dialog ${className}`);
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const headingId = `${uid}-${className}-title`;
    const heading = el("h2", "np-dialog-title", title);
    heading.id = headingId;
    panel.setAttribute("aria-labelledby", headingId);
    const closeX = button("×", "close", "np-dialog-x");
    closeX.setAttribute("aria-label", "Close dialog");
    const body = el("div", "np-dialog-body");
    panel.append(closeX, heading, body);
    overlay.append(panel);
    root.append(overlay);
    activeDialog = { overlay, panel, body, onEscape };
    closeX.addEventListener("click", () => {
      if (activeDialog?.panel === panel) {
        activeDialog.onEscape?.();
        closeDialog();
      }
    });
    panel.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeDialog?.panel === panel) {
          activeDialog.onEscape?.();
          closeDialog();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...panel.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
        .filter((node) => node.offsetParent !== null || node === document.activeElement);
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

  /* ---------- Export ---------- */

  function download() {
    const blob = new Blob([editor.value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeDownloadName(state.name);
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
    clearError();
  }

  /* ---------- Save / Save As / failure recovery ---------- */

  async function folderChoices() {
    let folders = [];
    try {
      const roots = (await files?.list?.("root")) || [];
      folders = roots.filter((entry) => entry?.kind === "folder");
    } catch {
      folders = [];
    }
    if (!folders.length) folders = [{ id: "documents", name: "Documents" }];
    return folders;
  }

  function failureDialog(error) {
    const message = describeError(error);
    showError(message);
    const { body } = makeDialog("np-recovery-dialog", "Nothing was saved", {
      onEscape: () => {},
    });
    body.append(el("p", "", message));
    body.append(el("p", "np-dialog-note", "Your work is still in the editor. Choose how to keep it."));
    const actions = el("div", "np-dialog-actions");
    const skip = button("Download a copy", "download");
    const copy = button("Save a copy", "save-copy", "np-button np-primary");
    const cancel = button("Keep editing", "cancel");
    actions.append(copy, skip, cancel);
    body.append(actions);
    skip.addEventListener("click", () => download());
    copy.addEventListener("click", () => { closeDialog(); saveAs(); });
    cancel.addEventListener("click", () => closeDialog());
    return message;
  }

  /** One commit at a time: duplicate Save/Save As actions reuse the same work. */
  function withSaveLock(work) {
    if (state.saveLock) return state.saveLock;
    const invoker = document.activeElement;
    saveButton.disabled = true;
    saveAsButton.disabled = true;
    state.saveLock = (async () => {
      try {
        return await work(invoker);
      } finally {
        state.saveLock = null;
        if (!state.disposed) {
          saveButton.disabled = false;
          saveAsButton.disabled = false;
        }
      }
    })();
    return state.saveLock;
  }

  function save() {
    return withSaveLock(saveInternal);
  }

  async function saveInternal(invoker) {
    if (state.disposed) return false;
    clearError();
    state.lastCommit = null;
    await stopDraftWrites();
    const fileId = state.fileId;
    if (!fileId) return saveAsInternal(invoker);
    const snapshot = editor.value;
    const draftId = state.draftId;
    const baseRevision = state.baseRevision;
    const docEpoch = state.docEpoch;
    try {
      const entry = await files.write(fileId, { text: snapshot }, baseRevision, { draftId });
      state.lastCommit = { ok: true, text: snapshot, draftId };
      if (state.disposed || state.docEpoch !== docEpoch || state.fileId !== fileId) return false;
      state.baseRevision = entry.revision;
      state.name = entry.name;
      if (editor.value !== snapshot) {
        setDirty(true);
        scheduleDraft();
        setNote("Saved an earlier version; your newer text is still not saved");
        return true;
      }
      state.savedNotice = true;
      state.note = "";
      setDirty(false);
      state.draftProblem = "";
      paintStatus();
      return true;
    } catch (error) {
      state.lastCommit = { ok: false, draftId };
      failureDialog(error);
      return false;
    }
  }

  function saveAs() {
    return withSaveLock(saveAsInternal);
  }

  async function saveAsInternal(invoker) {
    if (state.disposed) return false;
    clearError();
    state.lastCommit = null;
    const folders = await folderChoices();
    let finishDialog = () => {};
    const { body } = makeDialog("np-save-dialog", "Save a copy", {
      onEscape: () => finishDialog(false),
      returnFocus: invoker,
    });
    state.namingDialog = true;
    const form = el("form", "np-save-form");
    const nameLabel = el("label", "np-field");
    nameLabel.append(el("span", "", "File name"));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "np-save-name";
    nameInput.value = state.name === "Untitled" ? "Untitled.txt" : state.name;
    nameLabel.append(nameInput);
    const parentLabel = el("label", "np-field");
    parentLabel.append(el("span", "", "Folder"));
    const parentSelect = document.createElement("select");
    parentSelect.className = "np-save-parent";
    for (const folder of folders) {
      const option = document.createElement("option");
      option.value = folder.id;
      option.textContent = folder.name;
      parentSelect.append(option);
    }
    parentSelect.value = folders.some((folder) => folder.id === "documents") ? "documents" : folders[0].id;
    parentLabel.append(parentSelect);
    const actions = el("div", "np-dialog-actions");
    const create = button("Save here", "create", "np-button np-primary");
    const cancel2 = button("Cancel", "cancel");
    actions.append(create, cancel2);
    form.append(nameLabel, parentLabel, actions);
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
      finishDialog = finish;
      cancel2.addEventListener("click", () => { closeDialog(); finish(false); });
      create.addEventListener("click", async () => {
        const name = nameInput.value.trim();
        if (!name) {
          showError("Give the file a name before saving.");
          nameInput.focus();
          return;
        }
        await stopDraftWrites();
        const snapshot = editor.value;
        const draftId = state.draftId;
        const docEpoch = state.docEpoch;
        try {
          const entry = await files.createText(
            { parentId: parentSelect.value, name, text: snapshot, origin: "created" },
            { draftId },
          );
          state.lastCommit = { ok: true, text: snapshot, draftId };
          if (state.disposed || state.docEpoch !== docEpoch) {
            closeDialog();
            finish(false);
            return;
          }
          state.fileId = entry.id;
          state.name = entry.name;
          state.baseRevision = entry.revision;
          if (editor.value !== snapshot) {
            setDirty(true);
            scheduleDraft();
            setNote("Saved an earlier version; your newer text is still not saved");
            closeDialog();
            finish(true);
            return;
          }
          state.savedNotice = true;
          state.note = "";
          setDirty(false);
          state.draftProblem = "";
          closeDialog();
          paintStatus();
          finish(true);
        } catch (error) {
          state.lastCommit = { ok: false, draftId };
          closeDialog();
          failureDialog(error);
          finish(false);
        }
      });
      form.addEventListener("submit", (event) => { event.preventDefault(); create.click(); });
    });
  }

  /* ---------- Recovery ---------- */

  function recoveryMessage(draft, recovery) {
    const name = state.name || "this document";
    if (recovery.state === "current") {
      return `This draft matches the same saved version of ${name}. The saved file has not changed; resume the draft when you are ready.`;
    }
    if (recovery.state === "stale") {
      return `The saved file is newer than this draft (revision ${recovery.currentRevision}). Both versions are kept. Review them before saving anything.`;
    }
    if (recovery.state === "orphaned") {
      return "The file this draft belongs to is no longer available. Save a copy or download the draft; nothing is written to storage automatically.";
    }
    return "This untitled draft was never saved to a file. Resume it, save a copy or download it.";
  }

  async function showRecovery(draft, recovery) {
    recoveryPanel.replaceChildren();
    recoveryPanel.hidden = false;
    const title = el("h2", "np-recovery-title", "Draft recovery");
    const message = el("p", "np-recovery-message", recoveryMessage(draft, recovery));
    recoveryPanel.append(title, message);
    const actions = el("div", "np-recovery-actions");
    const resume = button("Resume draft in editor", "resume", "np-button np-primary");
    const review = button("Review both versions", "review", "np-button");
    const copy = button("Download draft", "download", "np-button");
    const discard = button("Discard draft", "discard", "np-button np-danger");
    const dismiss = button("Keep working without the draft", "dismiss", "np-button np-quiet");
    actions.append(resume, review, copy, discard, dismiss);
    recoveryPanel.append(actions);

    const applyResume = async () => {
      if (!(await guardReplace())) return;
      state.docEpoch += 1;
      state.fileId = recovery.state === "orphaned" ? null : draft.fileId;
      state.baseRevision = recovery.state === "current" ? recovery.currentRevision :
        recovery.state === "stale" ? draft.baseRevision : null;
      state.name = recovery.state === "orphaned" ? "Recovered draft" : state.name;
      editor.value = draft.payload?.text ?? "";
      state.draftId = draft.draftId;
      recoveryPanel.hidden = true;
      setDirty(true);
      scheduleDraft();
      setNote("Draft resumed in the editor — not saved");
    };
    resume.addEventListener("click", () => { applyResume(); });
    review.addEventListener("click", () => {
      const { body } = makeDialog("np-review", "Review both versions", { onEscape: () => {} });
      const grid = el("div", "np-review-grid");
      const draftBox = el("pre", "np-review-text");
      draftBox.append(el("strong", "", "Draft text\n\n"), draft.payload?.text ?? "");
      const savedBox = el("pre", "np-review-text");
      savedBox.append(el("strong", "", "Saved text\n\n"), state.reviewSavedText ?? "");
      grid.append(draftBox, savedBox);
      body.append(grid);
      const actions2 = el("div", "np-dialog-actions");
      const useDraft = button("Use draft in editor", "use", "np-button np-primary");
      const close2 = button("Close review", "close");
      actions2.append(useDraft, close2);
      body.append(actions2);
      useDraft.addEventListener("click", () => { closeDialog(); applyResume(); });
      close2.addEventListener("click", () => closeDialog());
    });
    copy.addEventListener("click", () => {
      const previous = editor.value;
      editor.value = draft.payload?.text ?? "";
      download();
      editor.value = previous;
    });
    discard.addEventListener("click", async () => {
      const { body } = makeDialog("np-discard-dialog", "Discard this draft?", { onEscape: () => {} });
      body.append(el("p", "", "The draft copy will be removed. The saved file is not changed."));
      const actions2 = el("div", "np-dialog-actions");
      const yes = button("Discard draft", "discard", "np-button np-danger");
      const no = button("Keep draft", "cancel");
      actions2.append(yes, no);
      body.append(actions2);
      no.addEventListener("click", () => closeDialog());
      yes.addEventListener("click", async () => {
        await stopDraftWrites();
        try { await files?.deleteDraft?.(draft.draftId); } catch { /* keep the editor usable */ }
        closeDialog();
        recoveryPanel.hidden = true;
        clearError();
      });
    });
    dismiss.addEventListener("click", () => { recoveryPanel.hidden = true; });
  }

  async function openDraftById(id) {
    if (!files?.readDraft) return;
    closeDialog();
    try {
      const draft = await files.readDraft(id);
      if (!draft) {
        recoveryPanel.hidden = false;
        recoveryPanel.replaceChildren(el("p", "np-recovery-message", "That draft is no longer available."));
        return;
      }
      let entry = null;
      if (draft.fileId) {
        try { entry = await files.read(draft.fileId); } catch { entry = null; }
      }
      state.reviewSavedText = entry?.text ?? "";
      const recovery = files.draftRecovery(draft, entry);
      await showRecovery(draft, recovery);
    } catch (error) {
      showError(describeError(error));
    }
  }

  async function recoverDialog() {
    if (!files?.listDrafts) {
      showError("Draft recovery needs local storage. Download a copy to keep this document.");
      return;
    }
    const { body } = makeDialog("np-drafts-dialog", "Recover drafts", { onEscape: () => {} });
    body.append(el("p", "np-dialog-note", "Opening a draft always shows what it contains first. Nothing is applied automatically."));
    const list = el("div", "np-draft-list");
    let drafts = [];
    try { drafts = (await files.listDrafts()).filter((draft) => draft.appId === "notepad"); } catch { drafts = []; }
    if (!drafts.length) {
      list.append(el("p", "np-empty", "No recoverable Notepad drafts."));
    }
    for (const draft of drafts) {
      const item = el("div", "np-draft-item");
      item.dataset.draftId = draft.draftId;
      let label = "Untitled draft";
      let detail = "Never saved to a file";
      if (draft.fileId) {
        label = draft.fileId;
        try {
          const entry = await files.read(draft.fileId);
          label = entry.name;
          detail = files.draftRecovery(draft, entry).state === "stale"
            ? "The saved file is newer — review before using"
            : "Matches the saved version";
        } catch {
          detail = "Saved copy is no longer available";
        }
      }
      item.append(el("span", "np-draft-name", label), el("span", "np-draft-detail", detail));
      const open = button("Open draft", "open-draft", "np-button");
      open.addEventListener("click", () => openDraftById(draft.draftId));
      item.append(open);
      list.append(item);
    }
    body.append(list);
    const actions = el("div", "np-dialog-actions");
    const close3 = button("Close", "close");
    actions.append(close3);
    body.append(actions);
    close3.addEventListener("click", () => closeDialog());
  }

  /* ---------- Navigation and guard ---------- */

  function openApp(appId, options) {
    services.openApp?.(appId, options);
  }

  async function guardReplace() {
    return canClose();
  }

  async function canClose() {
    if (state.disposed) return true;
    if (state.closePromise) return state.closePromise;
    if (state.namingDialog) return false;
    // Wait for an in-flight save before deciding, but share that wait so
    // repeated close clicks cannot create duplicate dialogs.
    if (state.saveLock) {
      if (!state.closePromise) state.closePromise = state.saveLock.then(() => null);
      await state.closePromise;
      if (state.closePromise) state.closePromise = null;
      if (state.disposed) return true;
    }
    if (!state.dirty) return true;
    if (state.closePromise) return state.closePromise;
    let resolveClose;
    state.closePromise = new Promise((resolve) => { resolveClose = resolve; });
    const closePromise = state.closePromise;
    let closeSettled = false;
    const finish = (value) => {
      if (closeSettled) return;
      closeSettled = true;
      if (state.closePromise === closePromise) state.closePromise = null;
      resolveClose(value);
    };
    {
      const { body } = makeDialog("np-close-dialog", "Save changes before closing?", {
        onEscape: () => finish(false),
      });
      body.append(el("p", "", "Your changes are kept in a recoverable draft until you choose. You can cancel and keep editing."));
      const actions = el("div", "np-dialog-actions");
      const save2 = button("Save", "save", "np-button np-primary");
      const discard = button("Discard", "discard", "np-button np-danger");
      const cancel2 = button("Cancel", "cancel");
      actions.append(save2, discard, cancel2);
      body.append(actions);
      cancel2.addEventListener("click", () => { closeDialog(); finish(false); });
      discard.addEventListener("click", async () => {
        await stopDraftWrites();
        try { await files?.deleteDraft?.(state.draftId); } catch { /* editing stays available */ }
        closeDialog();
        setDirty(false);
        finish(true);
      });
      save2.addEventListener("click", async () => {
        const saved = await save();
        if (saved) closeDialog();
        finish(saved);
      });
    }
    return closePromise;
  }

  /* ---------- Find ---------- */

  function openFind() {
    findbar.hidden = false;
    findInput.focus();
    findInput.select();
  }
  function closeFind() {
    findbar.hidden = true;
    editor.focus({ preventScroll: true });
  }

  function runFind() {
    const query = findInput.value;
    if (!query) {
      setNote("Type text to find.");
      findInput.focus();
      return;
    }
    const matches = findMatches(editor.value, query, {
      caseSensitive: caseButton.getAttribute("aria-pressed") === "true",
    });
    if (!matches.length) {
      setNote(`No matches for “${query}”`);
      return;
    }
    const caret = editor.selectionStart !== editor.selectionEnd ? editor.selectionEnd : editor.selectionStart;
    const result = nextMatch(matches, caret) || nextMatch(matches, -1);
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(result.match.start, result.match.end);
    setNote(`Match ${result.ordinal} of ${result.total}${result.wrapped ? " · wrapped to first" : ""}`);
  }

  /* ---------- Toolbar wiring ---------- */

  newButton.addEventListener("click", () => openApp("notepad", { mode: "edit", source: newButton }));
  openButton.addEventListener("click", async () => {
    const { body } = makeDialog("np-open-dialog", "Open a saved note", { onEscape: () => {} });
    body.append(el("p", "np-dialog-note", "Saved notes live in this browser. Opening one creates or focuses its own editor window."));
    const list = el("div", "np-open-list");
    let entries = [];
    try { entries = (await files?.list?.("documents")) || []; } catch { entries = []; }
    const texts = entries.filter((entry) => entry?.kind === "file" && String(entry.mediaType).startsWith("text/"));
    if (!texts.length) list.append(el("p", "np-empty", "No saved notes in Documents yet."));
    for (const entry of texts) {
      const item = el("button", "np-open-item");
      item.type = "button";
      item.dataset.fileId = entry.id;
      item.append(el("span", "np-open-name", entry.name), el("span", "np-open-size", `${entry.size} bytes`));
      item.addEventListener("click", () => {
        list.querySelectorAll(".np-open-item").forEach((node) => node.removeAttribute("aria-current"));
        item.setAttribute("aria-current", "true");
        state.openSelection = entry.id;
      });
      list.append(item);
    }
    body.append(list);
    const actions = el("div", "np-dialog-actions");
    const openNew = button("Open in a new window", "open-new", "np-button np-primary");
    const browse = button("Browse in Files", "browse", "np-button");
    const cancel2 = button("Cancel", "cancel");
    actions.append(openNew, browse, cancel2);
    body.append(actions);
    cancel2.addEventListener("click", () => closeDialog());
    browse.addEventListener("click", () => { closeDialog(); openApp("files", { mode: "browse", source: openButton }); });
    openNew.addEventListener("click", () => {
      if (!state.openSelection) {
        showError("Choose a note from the list first.");
        return;
      }
      closeDialog();
      openApp("notepad", { fileId: state.openSelection, mode: "edit", source: openButton });
      state.openSelection = null;
    });
  });
  saveButton.addEventListener("click", () => { save(); });
  saveAsButton.addEventListener("click", () => { saveAs(); });
  downloadButton.addEventListener("click", () => download());
  findButton.addEventListener("click", () => openFind());
  findNext.addEventListener("click", () => runFind());
  findClose.addEventListener("click", () => closeFind());
  findInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); runFind(); }
  });
  caseButton.addEventListener("click", () => {
    const pressed = caseButton.getAttribute("aria-pressed") === "true";
    caseButton.setAttribute("aria-pressed", String(!pressed));
    runFind();
  });
  wrapButton.addEventListener("click", () => {
    state.wrap = !state.wrap;
    editor.wrap = state.wrap ? "soft" : "off";
    wrapButton.setAttribute("aria-pressed", String(state.wrap));
  });
  recoverButton.addEventListener("click", () => { recoverDialog(); });
  filesButton.addEventListener("click", () => openApp("files", { mode: "browse", source: filesButton }));

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const problem = validateTextImport({ name: file.name, size: file.size, type: file.type });
    if (problem) { showError(problem); return; }
    if (!(await guardReplace())) return;
    const decoded = await decodeText(await file.arrayBuffer());
    if (!decoded.ok) { showError(decoded.error); return; }
    await stopDraftWrites();
    state.docEpoch += 1;
    state.fileId = null;
    state.baseRevision = null;
    state.draftId = newDraftId();
    state.name = file.name;
    editor.value = decoded.text;
    editor.setSelectionRange(0, 0);
    recoveryPanel.hidden = true;
    setDirty(true);
    scheduleDraft();
    setNote(`Imported ${file.name}`);
  });

  /* ---------- Scoped keyboard shortcuts ---------- */

  root.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || activeDialog || event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey) {
      const key = String(event.key || "").toLowerCase();
      if (key === "s") { event.preventDefault(); save(); return; }
      if (key === "f") { event.preventDefault(); openFind(); return; }
      return; // Ctrl+N/W/O/R, Alt+arrows and browser navigation are left alone
    }
    if (event.altKey) return;
    if (event.key === "F3") { event.preventDefault(); runFind(); return; }
    if (event.key === "Escape" && !findbar.hidden) { event.preventDefault(); closeFind(); }
  });

  /* ---------- Initial document and lifetime ---------- */

  async function loadInitial() {
    try {
      if (draftId && files?.readDraft) {
        const draft = await files.readDraft(draftId);
        if (draft) {
          state.draftId = draft.draftId;
          state.fileId = draft.fileId ?? null;
          state.baseRevision = draft.baseRevision ?? null;
          let entry = null;
          if (draft.fileId) {
            try { entry = await files.read(draft.fileId); } catch { entry = null; }
          }
          state.name = entry?.name || "Recovered draft";
          state.reviewSavedText = entry?.text ?? "";
          state.savedNotice = Boolean(entry);
          editor.value = entry?.text ?? "";
          editor.setSelectionRange(0, 0);
          setDirty(false);
          paintStatus();
          await showRecovery(draft, files.draftRecovery(draft, entry));
          return;
        }
      }
      if (state.fileId && files?.read) {
        const entry = await files.read(state.fileId);
        state.name = entry.name;
        state.baseRevision = entry.revision;
        editor.value = entry.text ?? "";
        editor.setSelectionRange(0, 0);
        state.savedNotice = true;
        setDirty(false);
      }
    } catch (error) {
      showError(describeError(error));
      state.fileId = null;
      state.baseRevision = null;
      state.name = "Untitled";
      editor.value = "";
    }
    paintStatus();
  }
  await loadInitial();

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    state.epoch += 1;
    if (debounce !== null) clearTimeout(debounce);
    debounce = null;
    state.namingDialog = false;
    if (state.dirty && files?.putDraft) {
      const textAtDispose = editor.value;
      const draftIdAtDispose = state.draftId;
      const flushDraft = async () => {
        // A pending Save deletes its own draft atomically on success. Writing
        // the same draft afterwards would resurrect it; a failed or stale
        // commit still gets best-effort recovery.
        if (state.lastCommit?.ok && state.lastCommit.text === textAtDispose &&
            state.lastCommit.draftId === draftIdAtDispose) return;
        try {
          const record = files.createDraft({
            appId: "notepad",
            draftId: state.draftId,
            fileId: state.fileId,
            baseRevision: state.baseRevision,
            payload: { text: textAtDispose },
            updatedAt: Date.now(),
          });
          await files.putDraft(record);
        } catch { /* best-effort flush while the window goes away */ }
      };
      if (state.saveLock) state.saveLock.then(flushDraft, flushDraft);
      else state.queue = state.queue.then(flushDraft).catch(() => {});
    }
    signal?.removeEventListener?.("abort", onAbort);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
    closeDialog();
    root.remove();
  }
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  return {
    canClose,
    focus: () => {
      if (activeDialog) activeDialog.panel.querySelector("button")?.focus({ preventScroll: true });
      else editor.focus({ preventScroll: true });
    },
    dispose,
  };
}

export default { mount };
