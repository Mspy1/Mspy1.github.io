/* Files: an accessible, Windows-inspired browser file manager.
   Only real storage entries appear here. Folders navigate by stable parent ids;
   files open through the file service's real association and stable id. No
   device browsing, no active document insertion, no invented app icons.
   Contract: docs/superpowers/plans/2026-11-24-findows.md §§3–4 and the
   Gate 2 durability contract. Parent owns registry/shell wiring. */
import { RESERVED, STORAGE_CODES, StorageError } from "../storage.mjs";
import {
  TRASH_ID,
  buildCrumbs,
  formatSize,
  formatTypedError,
  isTrashId,
  mediaTypeLabel,
  moveTargets,
  safeFilename,
} from "./files-helpers.mjs";

const PLACES = Object.freeze([
  { id: RESERVED.DESKTOP, name: "Desktop" },
  { id: RESERVED.DOCUMENTS, name: "Documents" },
  { id: RESERVED.PICTURES, name: "Pictures" },
  { id: TRASH_ID, name: "Recycle Bin" },
]);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, act, className = "files-button") {
  const node = el("button", className, label);
  node.type = "button";
  node.dataset.act = act;
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : "—";
}

function iconKind(entry) {
  if (entry.kind === "folder") return "folder";
  const mediaType = String(entry.mediaType ?? "");
  if (mediaType === "text/plain") return "text";
  if (mediaType.startsWith("image/")) return "image";
  return "generic";
}

/**
 * Mount the app. `services.files` is the Gate 2 façade; `services.openApp` is
 * the shell's dispatcher. Extra mount arguments are accepted for the shared
 * contract but Files never fabricates a draft or a destination app.
 */
export async function mount({
  container,
  windowId = "",
  fileId = null,
  mode = "browse",
  draftId = null,
  services = {},
  signal,
} = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Files needs a DOM container.");
  }
  if (signal?.aborted) {
    throw new DOMException("Files window was closed while loading", "AbortError");
  }
  const files = services?.files;
  if (!files || typeof files.list !== "function") {
    throw new TypeError("Files needs services.files from the desktop.");
  }

  let disposed = false;
  let currentId = RESERVED.ROOT;
  let selectedId = null;
  let currentItems = [];
  let currentCrumbs = [];
  let currentDialog = null;
  let dialogSequence = 0;
  let dialogBusy = false;
  let returnFocus = null;
  let loadGeneration = 0;
  const objectUrls = new Set();

  const root = el("div", "files-app");
  root.dataset.windowId = windowId;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Files");

  const header = el("header", "files-header");
  const heading = el("h1", "files-title", "Files");
  heading.tabIndex = -1;
  const subtitle = el("p", "files-subtitle", "Folders saved in this browser. Nothing here reads your device.");
  const modeBadge = el("span", "files-mode", "Checking storage…");
  modeBadge.dataset.role = "mode";
  header.append(heading, subtitle, modeBadge);

  const toolbar = el("div", "files-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Folder actions");
  toolbar.append(
    button("↑ Up", "up"),
    button("New folder", "new-folder", "files-button files-button--primary"),
    button("Refresh", "refresh"),
    button("Recycle Bin", "trash"),
  );

  const crumbs = el("nav", "files-crumbs");
  crumbs.dataset.role = "crumbs";
  crumbs.setAttribute("aria-label", "Current location");

  const body = el("div", "files-body");
  const places = el("aside", "files-places");
  places.setAttribute("aria-label", "Places");
  places.append(el("h2", "files-places-title", "Places"));
  for (const place of PLACES) {
    const node = button(place.name, "place", "files-place");
    node.dataset.place = place.id;
    places.append(node);
  }

  const main = el("section", "files-main");
  main.setAttribute("aria-label", "Items in this folder");
  const listHead = el("div", "files-list-head");
  listHead.setAttribute("aria-hidden", "true");
  listHead.append(el("span", "files-head-cell"));
  for (const label of ["Name", "Type", "Size", "Modified", ""]) {
    listHead.append(el("span", "files-head-cell", label));
  }
  const list = el("ul", "files-list");
  list.dataset.role = "list";
  const empty = el("div", "files-empty");
  empty.dataset.role = "empty";
  empty.hidden = true;
  const emptyIcon = el("span", "files-empty-icon", "▢");
  emptyIcon.setAttribute("aria-hidden", "true");
  empty.append(emptyIcon, el("p", "files-empty-text", "This folder is empty."));
  main.append(listHead, list, empty);

  const details = el("aside", "files-details");
  details.dataset.role = "details";
  details.setAttribute("aria-label", "Selected item");
  details.append(el("h2", "files-details-title", "Details"));

  body.append(places, main, details);

  const errorBox = el("div", "files-error");
  errorBox.dataset.role = "error";
  errorBox.setAttribute("role", "alert");
  errorBox.hidden = true;
  const errorText = el("span", "files-error-text");
  const retryButton = button("Retry storage", "retry-storage");
  retryButton.hidden = true;
  errorBox.append(errorText, retryButton);

  const status = el("p", "files-status", "Loading folders…");
  status.dataset.role = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  const dialogLayer = el("div", "files-dialog-layer");
  root.append(header, toolbar, crumbs, body, errorBox, status, dialogLayer);
  container.replaceChildren(root);

  /* ------------------------------------------------------------- messages -- */

  function clearMessages() {
    errorText.textContent = "";
    retryButton.hidden = true;
    errorBox.hidden = true;
    status.textContent = "";
  }

  function setError(message) {
    if (disposed) return;
    status.textContent = "";
    errorText.textContent = message;
    retryButton.hidden = !/^UNAVAILABLE\b/.test(message);
    errorBox.hidden = false;
  }

  function setStatus(message) {
    if (disposed) return;
    errorBox.hidden = true;
    errorText.textContent = "";
    retryButton.hidden = true;
    status.textContent = message;
  }

  function updateMode() {
    if (disposed) return;
    const storageMode = typeof files.getStorageMode === "function" ? files.getStorageMode() : null;
    const temporary = storageMode === "temporary";
    modeBadge.dataset.mode = temporary ? "temporary" : "persistent";
    modeBadge.textContent = temporary ? "Temporary mode · not saved" : "Saved in this browser";
    const reason = typeof files.getModeReason === "function" ? files.getModeReason() : null;
    modeBadge.title = temporary && reason ? `Storage: ${reason}` : "";
  }

  /* --------------------------------------------------------------- dialogs -- */

  function closeDialog() {
    if (currentDialog) {
      currentDialog.box.removeEventListener("keydown", currentDialog.onKeydown);
      currentDialog.overlay.remove();
      currentDialog = null;
      dialogBusy = false;
    }
    dialogLayer.replaceChildren();
    if (!disposed && returnFocus?.isConnected) {
      try { returnFocus.focus({ preventScroll: true }); } catch { returnFocus.focus(); }
    }
    returnFocus = null;
  }

  function textField(label, value, help) {
    const wrap = el("label", "files-field");
    wrap.append(el("span", "files-field-label", label));
    const input = document.createElement("input");
    input.type = "text";
    input.className = "files-input";
    input.value = value ?? "";
    input.maxLength = 255;
    input.autocomplete = "off";
    input.spellcheck = false;
    wrap.append(input);
    if (help) wrap.append(el("small", "files-field-help", help));
    return wrap;
  }

  function openDialog({ title, description, body: content, confirmLabel, danger = false, onSubmit }) {
    closeDialog();
    if (!disposed) returnFocus = document.activeElement instanceof Element ? document.activeElement : null;
    const seq = ++dialogSequence;
    const overlay = el("div", "files-dialog-overlay");
    const box = el("div", "files-dialog");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    const titleEl = el("h2", "files-dialog-title", title);
    titleEl.id = `files-dialog-title-${seq}`;
    box.setAttribute("aria-labelledby", titleEl.id);

    const form = document.createElement("form");
    form.className = "files-dialog-form";
    const area = el("div", "files-dialog-content");
    const descriptionEl = description ? el("p", "files-dialog-description", description) : null;
    if (descriptionEl) {
      descriptionEl.id = `files-dialog-description-${seq}`;
      box.setAttribute("aria-describedby", descriptionEl.id);
      area.append(descriptionEl);
    }
    if (content) area.append(content);
    const dialogError = el("p", "files-dialog-error");
    dialogError.dataset.role = "dialog-error";
    dialogError.setAttribute("role", "alert");
    dialogError.hidden = true;
    area.append(dialogError);

    const actions = el("div", "files-dialog-actions");
    const cancel = button("Cancel", "cancel");
    const confirm = button(confirmLabel, "confirm", danger ? "files-button files-button--danger" : "files-button files-button--primary");
    confirm.type = "submit";
    actions.append(cancel, confirm);
    form.append(area, actions);
    box.append(titleEl, form);
    overlay.append(box);
    dialogLayer.replaceChildren(overlay);
    currentDialog = { overlay, box, form, confirm };

    /* The dialog is aria-modal, so Tab must not reach the list, toolbar or shell.
       Mirror the Settings/Sticky Notes trap, scoped to this dialog box only. */
    const onDialogKeydown = (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...box.querySelectorAll(
        'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )].filter((node) => node.getClientRects().length > 0 || node === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!box.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    box.addEventListener("keydown", onDialogKeydown);
    currentDialog.onKeydown = onDialogKeydown;

    cancel.addEventListener("click", closeDialog);
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) closeDialog();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (dialogBusy || disposed || !currentDialog) return;
      dialogBusy = true;
      confirm.disabled = true;
      dialogError.hidden = true;
      dialogError.textContent = "";
      try {
        await onSubmit({ form });
        if (!disposed && currentDialog?.form === form) closeDialog();
      } catch (error) {
        dialogError.textContent = formatTypedError(error);
        dialogError.hidden = false;
        setError(formatTypedError(error));
      } finally {
        dialogBusy = false;
        if (document.contains(confirm)) {
          confirm.disabled = false;
          try { confirm.focus({ preventScroll: true }); } catch { confirm.focus(); }
        }
      }
    });

    const firstField = box.querySelector("input:not([type='checkbox']), select");
    try { (firstField || confirm).focus({ preventScroll: true }); } catch { (firstField || confirm).focus(); }
  }

  /* ------------------------------------------------------------ navigation -- */

  async function buildBreadcrumbs(id) {
    const byId = new Map();
    const seen = new Set();
    let cursor = id;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      let node;
      try {
        node = await files.read(cursor);
      } catch {
        break;
      }
      byId.set(cursor, node);
      cursor = node.parentId;
    }
    return buildCrumbs(byId, id);
  }

  async function collectFolders() {
    const folders = [];
    const seen = new Set();
    const walk = async (id) => {
      if (!id || seen.has(id) || disposed) return;
      seen.add(id);
      let node;
      try {
        node = await files.read(id);
      } catch {
        return;
      }
      if (node.kind !== "folder" || node.trashedAt != null) return;
      folders.push(node);
      let children = [];
      try {
        children = await files.list(id);
      } catch {
        return;
      }
      for (const child of children) {
        if (child.kind === "folder") await walk(child.id);
      }
    };
    await walk(RESERVED.ROOT);
    if (currentId !== TRASH_ID && !seen.has(currentId)) await walk(currentId);
    return folders;
  }

  async function load() {
    if (disposed) return;
    /* Capture both the requested folder and a generation before any await. A newer
       navigation changes currentId and bumps the generation, so an older listing
       that settles later can never overwrite the rows or breadcrumb. */
    const generation = ++loadGeneration;
    const id = currentId;
    const trash = isTrashId(id);
    const stale = () => disposed || generation !== loadGeneration || id !== currentId;
    try {
      let items;
      let crumbList;
      if (trash) {
        if (typeof files.listTrash !== "function") {
          throw new StorageError(STORAGE_CODES.UNAVAILABLE, "This file service cannot show the Recycle Bin.");
        }
        items = await files.listTrash();
        crumbList = [{ id: TRASH_ID, name: "Recycle Bin" }];
      } else {
        const folder = await files.read(id);
        if (folder.kind !== "folder") {
          throw new StorageError(STORAGE_CODES.INVALID_PARENT, "Only a folder can be browsed.");
        }
        items = await files.list(id);
        crumbList = await buildBreadcrumbs(id);
      }
      if (stale()) return;
      currentItems = Array.isArray(items) ? items : [];
      currentCrumbs = crumbList;
      if (!currentItems.some((entry) => entry.id === selectedId)) selectedId = null;
      renderCrumbs();
      renderList();
      renderPlaces();
      renderDetails();
      updateMode();
      clearMessages();
    } catch (error) {
      if (stale()) return;
      currentItems = [];
      currentCrumbs = [];
      selectedId = null;
      renderCrumbs();
      renderList();
      renderPlaces();
      renderDetails();
      updateMode();
      setError(formatTypedError(error));
    }
  }

  async function navigate(id, source = "navigation") {
    if (disposed || typeof id !== "string" || !id) return;
    closeDialog();
    const generation = loadGeneration + 1;
    if (id === currentId) {
      await load();
      return;
    }
    currentId = id;
    selectedId = null;
    clearMessages();
    await load();
    if (source === "up" && generation === loadGeneration) setStatus("Moved up one folder.");
  }

  async function goUp() {
    if (isTrashId(currentId)) {
      await navigate(RESERVED.ROOT, "up");
      return;
    }
    let parentId = null;
    try {
      const current = await files.read(currentId);
      parentId = current.parentId;
    } catch (error) {
      setError(formatTypedError(error));
      return;
    }
    if (!parentId) {
      setStatus("You are at the top of Findows.");
      return;
    }
    await navigate(parentId, "up");
  }

  /* ---------------------------------------------------------------- render -- */

  function renderCrumbs() {
    crumbs.replaceChildren();
    const trail = currentCrumbs.length ? currentCrumbs : [{ id: currentId, name: isTrashId(currentId) ? "Recycle Bin" : "Findows" }];
    trail.forEach((crumb, index) => {
      if (index > 0) crumbs.append(el("span", "files-crumb-separator", "›"));
      const node = button(crumb.name, "crumb", "files-crumb");
      node.dataset.crumbId = crumb.id;
      if (index === trail.length - 1) node.setAttribute("aria-current", "page");
      crumbs.append(node);
    });
  }

  function renderPlaces() {
    places.querySelectorAll("[data-place]").forEach((node) => {
      const active = node.dataset.place === currentId;
      node.classList.toggle("is-active", active);
      if (active) node.setAttribute("aria-current", "page");
      else node.removeAttribute("aria-current");
    });
  }

  function addRowAction(holder, label, act, entry) {
    const node = button(label, act, "files-row-action");
    node.dataset.entryId = entry.id;
    node.setAttribute("aria-label", act === "trash" ? `Move ${entry.name} to Recycle Bin` : `${label} ${entry.name}`);
    holder.append(node);
  }

  function renderList() {
    list.replaceChildren();
    empty.hidden = currentItems.length > 0;
    if (!currentItems.length) {
      empty.querySelector(".files-empty-text").textContent = isTrashId(currentId)
        ? "The Recycle Bin is empty."
        : "This folder is empty. Saved files appear here when other Findows apps save them.";
    }
    for (const entry of currentItems) {
      const row = el("li", "files-row");
      row.dataset.id = entry.id;
      if (selectedId === entry.id) row.classList.add("is-selected");

      const icon = el("span", "files-file-icon", "");
      icon.dataset.kind = iconKind(entry);
      icon.setAttribute("aria-hidden", "true");

      const name = button(entry.name, "name", "files-name");
      name.dataset.entryId = entry.id;
      const kindLabel = entry.kind === "folder" && !isTrashId(currentId) ? "Open folder" : "Select";
      const readable = entry.kind === "folder" ? mediaTypeLabel(entry) : `${mediaTypeLabel(entry)}, ${formatSize(entry.size)}`;
      name.setAttribute("aria-label", `${kindLabel} ${entry.name}, ${readable}`);
      if (entry.kind === "folder" && !isTrashId(currentId)) name.title = "Open folder";

      const type = el("span", "files-type", mediaTypeLabel(entry));
      const size = el("span", "files-size", entry.kind === "folder" ? "—" : formatSize(entry.size));
      const modified = el("span", "files-modified", formatDate(entry.updatedAt));
      const actions = el("span", "files-row-actions");

      if (isTrashId(currentId)) {
        addRowAction(actions, "Restore", "restore", entry);
        if (entry.kind === "file") addRowAction(actions, "Download", "download", entry);
        addRowAction(actions, "Delete forever", "purge", entry);
      } else {
        if (entry.kind === "file") {
          addRowAction(actions, "Open", "open", entry);
          addRowAction(actions, "Download", "download", entry);
        }
        addRowAction(actions, "Rename", "rename", entry);
        addRowAction(actions, "Move", "move", entry);
        addRowAction(actions, "Delete", "trash", entry);
      }

      row.addEventListener("click", (event) => {
        if (event.target instanceof Element && event.target.closest("button")) return;
        select(entry);
      });
      row.append(icon, name, type, size, modified, actions);
      list.append(row);
    }
  }

  function select(entry) {
    if (disposed) return;
    selectedId = entry.id;
    list.querySelectorAll(".files-row").forEach((row) => row.classList.toggle("is-selected", row.dataset.id === entry.id));
    renderDetails();
  }

  function renderDetails() {
    const selected = currentItems.find((entry) => entry.id === selectedId) || null;
    details.replaceChildren();
    details.append(el("h2", "files-details-title", "Details"));
    if (!selected) {
      details.append(el("p", "files-details-empty", "Select an item to see its details and actions."));
      return;
    }
    const card = el("div", "files-details-card");
    const title = el("h3", "files-details-name", selected.name);
    title.title = selected.name;
    card.append(title);
    const rows = el("dl", "files-details-list");
    const facts = [
      ["Type", mediaTypeLabel(selected)],
      ["Size", selected.kind === "folder" ? "—" : formatSize(selected.size)],
      ["Modified", formatDate(selected.updatedAt)],
      ["Revision", String(selected.revision)],
    ];
    if (selected.kind === "file" && selected.mediaType) facts.push(["Format", selected.mediaType]);
    for (const [term, value] of facts) {
      rows.append(el("dt", "files-details-term", term), el("dd", "files-details-value", value));
    }
    card.append(rows);
    const actions = el("div", "files-details-actions");
    const add = (label, act, className = "files-button") => {
      const node = button(label, act, className);
      node.dataset.entryId = selected.id;
      actions.append(node);
    };
    if (isTrashId(currentId)) {
      add("Restore", "restore", "files-button files-button--primary");
      if (selected.kind === "file") add("Download", "download");
      add("Delete forever", "purge", "files-button files-button--danger");
    } else {
      if (selected.kind === "file") add("Open", "open", "files-button files-button--primary");
      if (selected.kind === "file") add("Download", "download");
      add("Rename", "rename");
      add("Move", "move");
      add("Recycle Bin", "trash");
    }
    card.append(actions);
    details.append(card);
  }

  /* --------------------------------------------------------------- actions -- */

  function openEntry(entry) {
    clearMessages();
    if (entry.kind !== "file") {
      setError("Only files can be opened in another app. Open a folder to browse it.");
      return;
    }
    const association = typeof files.getAppForFile === "function" ? files.getAppForFile(entry) : null;
    if (!association?.appId) {
      setError("No app can open this file type in Findows.");
      return;
    }
    if (typeof services.openApp !== "function") {
      setError("Findows can't open this item: the desktop has no open action.");
      return;
    }
    try {
      services.openApp(association.appId, {
        fileId: entry.id,
        mode: association.mode,
        draftId: draftId ?? null,
        source: "files",
      });
      setStatus(`Opened “${entry.name}”.`);
    } catch (error) {
      setError(formatTypedError(error));
    }
  }

  function downloadEntry(entry) {
    clearMessages();
    if (entry.kind !== "file") {
      setError("Folders are not downloaded here.");
      return;
    }
    let blob = null;
    try {
      blob = entry.text != null ? new Blob([entry.text], { type: entry.mediaType || "text/plain" }) : entry.blob;
    } catch (error) {
      setError(formatTypedError(error));
      return;
    }
    if (!blob || typeof blob.size !== "number") {
      setError("This file has no downloadable content.");
      return;
    }
    try {
      const url = URL.createObjectURL(blob);
      objectUrls.add(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeFilename(entry.name, entry.mediaType);
      anchor.rel = "noopener";
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        objectUrls.delete(url);
      }, 1000);
      setStatus(`Downloaded a copy of “${entry.name}”.`);
    } catch (error) {
      setError(formatTypedError(error));
    }
  }

  function newFolderDialog() {
    if (isTrashId(currentId)) {
      setError("Open a regular folder before creating a new folder.");
      return;
    }
    openDialog({
      title: "New folder",
      description: "The folder is created in the folder you are viewing.",
      body: textField("Folder name", ""),
      confirmLabel: "Create folder",
      onSubmit: async ({ form }) => {
        const name = form.querySelector("input[type='text']").value;
        if (!name.trim()) throw new StorageError(STORAGE_CODES.INVALID_NAME, "Enter a folder name.");
        clearMessages();
        const created = await files.create({ parentId: currentId, name, kind: "folder" });
        selectedId = created.id;
        await load();
        setStatus(`Created folder “${created.name}”.`);
      },
    });
  }

  function renameDialog(entry) {
    openDialog({
      title: "Rename",
      description: `Change the name of “${entry.name}”. Nothing is overwritten.`,
      body: textField("Name", entry.name),
      confirmLabel: "Save name",
      onSubmit: async ({ form }) => {
        const name = form.querySelector("input[type='text']").value;
        clearMessages();
        const updated = await files.rename(entry.id, name, entry.revision);
        selectedId = updated.id;
        await load();
        setStatus(`Renamed to “${updated.name}”.`);
      },
    });
  }

  async function moveDialog(entry) {
    let targets = [];
    try {
      const folders = await collectFolders();
      targets = moveTargets(folders, { excludeId: entry.id });
    } catch (error) {
      setError(formatTypedError(error));
      return;
    }
    if (!targets.length) {
      setError("There is no folder you can move this item into.");
      return;
    }
    const select = document.createElement("select");
    select.className = "files-select";
    select.setAttribute("aria-label", "Destination folder");
    for (const target of targets) {
      const option = document.createElement("option");
      option.value = target.id;
      option.textContent = target.path || target.name;
      select.append(option);
    }
    const known = targets.find((target) => target.id === entry.parentId);
    select.value = known ? known.id : targets[0].id;
    openDialog({
      title: "Move to folder",
      description: `Choose where to move “${entry.name}”. The same item keeps its identity.`,
      body: select,
      confirmLabel: "Move here",
      onSubmit: async () => {
        clearMessages();
        const moved = await files.move(entry.id, select.value, entry.revision);
        selectedId = moved.id;
        await load();
        setStatus(`Moved “${moved.name}”.`);
      },
    });
  }

  function trashEntry(entry) {
    openDialog({
      title: "Move to Recycle Bin",
      description: `Move “${entry.name}” to the Recycle Bin? You can restore it later.`,
      confirmLabel: "Move to Recycle Bin",
      danger: true,
      onSubmit: async () => {
        clearMessages();
        await files.trash(entry.id, entry.revision);
        if (selectedId === entry.id) selectedId = null;
        await load();
        setStatus(`Moved “${entry.name}” to the Recycle Bin.`);
      },
    });
  }

  async function finishRestore(result, fallbackName) {
    const restored = result?.entry;
    let destinationName = "Documents";
    if (result?.destinationId) {
      try {
        const destination = await files.read(result.destinationId);
        if (destination?.name) destinationName = destination.name;
      } catch {
        /* keep the disclosed default name */
      }
    }
    await load();
    const name = restored?.name || fallbackName || "item";
    setStatus(
      result?.usedSafeParent
        ? `Restored “${name}” to ${destinationName} because its original folder is no longer available.`
        : `Restored “${name}” to ${destinationName}.`,
    );
  }

  function restoreRetryDialog(entry) {
    openDialog({
      title: "Restore with a new name",
      description: "Nothing was overwritten. Choose an unused name in the destination folder.",
      body: textField("Name for the restored item", `${entry.name} (restored)`),
      confirmLabel: "Restore with this name",
      onSubmit: async ({ form }) => {
        const name = form.querySelector("input[type='text']").value;
        clearMessages();
        const result = await files.restore(entry.id, entry.revision, { name });
        await finishRestore(result, result?.entry?.name || name);
      },
    });
  }

  async function restoreEntry(entry) {
    clearMessages();
    try {
      const result = await files.restore(entry.id, entry.revision);
      await finishRestore(result, entry.name);
    } catch (error) {
      setError(formatTypedError(error));
      if (error?.code === STORAGE_CODES.NAME_CONFLICT) restoreRetryDialog(entry);
    }
  }

  function purgeDialog(entry) {
    const label = el("label", "files-check");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.required = true;
    label.append(checkbox, el("span", "files-check-text", "I understand this cannot be undone."));
    openDialog({
      title: "Delete permanently",
      description: `Permanently delete “${entry.name}”? This cannot be undone.`,
      body: label,
      confirmLabel: "Delete permanently",
      danger: true,
      onSubmit: async () => {
        clearMessages();
        await files.purge(entry.id, entry.revision);
        selectedId = null;
        await load();
        setStatus(`Permanently deleted “${entry.name}”.`);
      },
    });
  }

  async function retryStorage() {
    clearMessages();
    try {
      if (typeof files.retry === "function") await files.retry();
    } catch (error) {
      setError(formatTypedError(error));
      return;
    }
    await load();
  }

  /* ---------------------------------------------------------------- events -- */

  async function onClick(event) {
    if (disposed || !(event.target instanceof Element)) return;
    const control = event.target.closest("[data-act]");
    if (!control || !root.contains(control) || control.closest(".files-dialog")) return;
    const act = control.dataset.act;
    if (control.closest(".files-dialog-layer")) return;

    const row = control.closest(".files-row");
    const id = control.dataset.entryId || row?.dataset.id;
    const entry = currentItems.find((item) => item.id === id) || null;

    if (act === "place") return navigate(control.dataset.place);
    if (act === "crumb") return navigate(control.dataset.crumbId);
    if (act === "up") return goUp();
    if (act === "refresh") {
      clearMessages();
      await load();
      return;
    }
    if (act === "trash" && control.closest(".files-toolbar")) return navigate(TRASH_ID);
    if (act === "new-folder") return newFolderDialog();
    if (act === "retry-storage") return retryStorage();
    if (!entry) return;
    if (act === "name") {
      if (entry.kind === "folder" && !isTrashId(currentId)) return navigate(entry.id);
      select(entry);
      return;
    }
    if (act === "open") return openEntry(entry);
    if (act === "download") return downloadEntry(entry);
    if (act === "rename") return renameDialog(entry);
    if (act === "move") return moveDialog(entry);
    if (act === "restore") return restoreEntry(entry);
    if (act === "purge") return purgeDialog(entry);
    if (act === "trash") return trashEntry(entry);
  }

  function onKeyDown(event) {
    if (disposed || event.key !== "Escape" || !currentDialog) return;
    event.preventDefault();
    event.stopPropagation();
    closeDialog();
  }

  const onAbort = () => dispose();
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeyDown);
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKeyDown);
    for (const url of objectUrls) {
      try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
    }
    objectUrls.clear();
    closeDialog();
    root.remove();
  }

  /* --------------------------------------------------------------- startup -- */

  let startupError = null;
  try {
    if (typeof files.ready === "function") await files.ready();
  } catch (error) {
    startupError = formatTypedError(error);
  }
  if (disposed) return { canClose: () => true, focus() {}, dispose };

  if (fileId && typeof files.read === "function") {
    try {
      const target = await files.read(fileId);
      if (target.kind === "folder") currentId = target.id;
      else {
        currentId = target.parentId || RESERVED.ROOT;
        selectedId = target.id;
      }
    } catch (error) {
      startupError = formatTypedError(error);
      currentId = RESERVED.ROOT;
    }
  }
  if (disposed) return { canClose: () => true, focus() {}, dispose };

  await load();
  if (mode && mode !== "browse") {
    setStatus(`Files opened in “${mode}” mode; showing the folder list.`);
  }
  if (startupError) setError(startupError);

  return {
    canClose: () => true,
    focus() {
      try { heading.focus({ preventScroll: true }); } catch { heading.focus(); }
    },
    dispose,
  };
}

export default { mount };
