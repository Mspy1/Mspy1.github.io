/* Photo Viewer: read-only preview of validated local image records.
   Validation happens before decode; decode is cancellable and every bitmap is
   released. No remote URLs, no uploads, no writes and no active content.
   Parent owns registry/CSS wiring and the photoViewer association flag. */
import { RESERVED } from "../storage.mjs";
import { SUPPORTED_IMAGE_TYPES, decodeImage, inspectImage } from "../import-export.mjs";
import {
  ZOOM_STEPS,
  clampScale,
  fitScale,
  formatBytes,
  formatDimensions,
  formatImageError,
  safeImageFilename,
} from "./photo-viewer-helpers.mjs";

const GALLERY_FOLDERS = Object.freeze([RESERVED.PICTURES, RESERVED.DOCUMENTS]);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function action(label, act, className = "pv-button") {
  const node = el("button", className, label);
  node.type = "button";
  node.dataset.act = act;
  return node;
}

const isImageEntry = (entry) =>
  Boolean(entry && entry.kind === "file" && SUPPORTED_IMAGE_TYPES.includes(String(entry.mediaType || "").trim().toLowerCase()));

/**
 * mount({ container, windowId, fileId, mode, draftId, services, signal })
 * services.files is read-only here; services.openApp is used only for an
 * explicit unsaved Paint copy. `draftId` is accepted but never created.
 */
export async function mount({
  container,
  windowId = "",
  fileId = null,
  mode = "view",
  draftId = null,
  services = {},
  signal,
} = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Photo Viewer needs a DOM container.");
  }
  if (signal?.aborted) {
    throw new DOMException("Photo Viewer window was closed while loading", "AbortError");
  }
  const files = services?.files;
  if (!files || typeof files.read !== "function") {
    throw new TypeError("Photo Viewer needs services.files from the desktop.");
  }

  let disposed = false;
  let loadToken = 0;
  let decodeAbort = null;
  let decoded = null;
  let currentEntry = null;
  let currentBlob = null;
  let currentName = "";
  let currentValidation = null;
  let siblings = [];
  let fitMode = true;
  let zoomScale = 1;
  const downloadUrls = new Set();

  const root = el("div", "pv-app");
  root.dataset.windowId = windowId;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Photo Viewer");

  const header = el("header", "pv-header");
  const heading = el("h1", "pv-title", "Photo Viewer");
  heading.tabIndex = -1;
  const subtitle = el("p", "pv-subtitle", "A read-only look at images saved in this browser, or a local preview you choose.");
  const badge = el("span", "pv-mode", "Read-only · no edits");
  badge.dataset.role = "mode";
  header.append(heading, subtitle, badge);

  const toolbar = el("div", "pv-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Image actions");
  const fitButton = action("Fit", "fit");
  const actualButton = action("Actual size", "actual");
  const zoomOut = action("−", "zoom-out", "pv-button pv-button--icon");
  zoomOut.setAttribute("aria-label", "Zoom out");
  const zoomLabel = el("output", "pv-zoom", "—");
  zoomLabel.dataset.role = "zoom";
  zoomLabel.setAttribute("aria-label", "Current zoom");
  const zoomIn = action("+", "zoom-in", "pv-button pv-button--icon");
  zoomIn.setAttribute("aria-label", "Zoom in");
  const previous = action("‹ Previous", "previous");
  const next = action("Next ›", "next");
  const downloadButton = action("Download copy", "download");
  const editCopyButton = action("Edit a copy in Paint", "edit-copy", "pv-button pv-button--accent");
  const chooseLocal = action("Preview a local image…", "choose-local");
  toolbar.append(fitButton, actualButton, zoomOut, zoomLabel, zoomIn, previous, next, downloadButton, editCopyButton, chooseLocal);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp";
  fileInput.dataset.role = "file-input";
  fileInput.hidden = true;
  fileInput.tabIndex = -1;

  const content = el("div", "pv-content");
  const stage = el("section", "pv-stage");
  stage.dataset.role = "stage";
  stage.tabIndex = 0;
  stage.setAttribute("aria-label", "Image preview. Plus and minus zoom, 0 fits, 1 shows actual size, arrow keys change image.");
  const canvas = document.createElement("canvas");
  canvas.className = "pv-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "No image is open");
  canvas.style.display = "none";
  const loading = el("div", "pv-loading", "Checking and decoding image…");
  loading.dataset.role = "loading";
  loading.hidden = true;
  loading.setAttribute("role", "status");
  const empty = el("div", "pv-empty");
  empty.dataset.role = "empty";
  empty.append(el("span", "pv-empty-glyph", "▧"), el("p", "pv-empty-text", "Choose a saved image or preview a local image."));
  stage.append(canvas, loading, empty);

  const gallery = el("aside", "pv-gallery");
  gallery.dataset.role = "gallery";
  gallery.setAttribute("aria-label", "Saved images");
  gallery.append(el("h2", "pv-gallery-title", "Saved images"));
  const galleryList = el("ul", "pv-gallery-list");
  galleryList.dataset.role = "gallery-list";
  gallery.append(galleryList, el("p", "pv-gallery-note", "Local preview only. Nothing is uploaded or saved."));
  content.append(stage, gallery);

  const footer = el("footer", "pv-footer");
  const name = el("span", "pv-name", "No image open");
  name.dataset.role = "name";
  const validation = el("span", "pv-validation", "Not validated yet");
  validation.dataset.role = "validation";
  const dimensions = el("span", "pv-dimensions", "—");
  dimensions.dataset.role = "dimensions";
  const position = el("span", "pv-position", "—");
  position.dataset.role = "position";
  footer.append(name, validation, dimensions, position);

  const errorBox = el("div", "pv-error");
  errorBox.dataset.role = "error";
  errorBox.setAttribute("role", "alert");
  errorBox.hidden = true;
  const status = el("p", "pv-status");
  status.dataset.role = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  root.append(header, toolbar, fileInput, content, errorBox, footer, status);
  container.replaceChildren(root);

  /* ------------------------------------------------------------- messages -- */

  function clearMessages() {
    errorBox.textContent = "";
    errorBox.hidden = true;
    status.textContent = "";
  }

  function setError(message) {
    if (disposed) return;
    status.textContent = "";
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function setStatus(message) {
    if (disposed) return;
    errorBox.hidden = true;
    errorBox.textContent = "";
    status.textContent = message;
  }

  /* ------------------------------------------------------------- controls -- */

  function siblingAt(offset) {
    if (!currentEntry || !siblings.length) return null;
    const index = siblings.findIndex((entry) => entry.id === currentEntry.id);
    return index < 0 ? null : siblings[index + offset] || null;
  }

  function updateControls() {
    if (disposed) return;
    const hasImage = Boolean(decoded);
    for (const control of [fitButton, actualButton, zoomOut, zoomIn]) control.disabled = !hasImage;
    downloadButton.disabled = !currentBlob;
    editCopyButton.disabled = !currentEntry;
    previous.disabled = !siblingAt(-1);
    next.disabled = !siblingAt(1);
    zoomLabel.textContent = hasImage ? fitMode ? "Fit" : `${Math.round(zoomScale * 100)}%` : "—";
    canvas.style.display = hasImage ? "" : "none";
    empty.hidden = hasImage || !loading.hidden;
  }

  function showEmpty(message) {
    if (disposed) return;
    loadToken += 1;
    decodeAbort?.abort();
    releaseDecoded();
    currentBlob = null;
    currentEntry = null;
    currentValidation = null;
    name.textContent = "No image open";
    validation.textContent = "Not validated yet";
    dimensions.textContent = "—";
    position.textContent = "—";
    loading.hidden = true;
    canvas.style.display = "none";
    empty.hidden = false;
    if (message) empty.querySelector(".pv-empty-text").textContent = message;
    updateControls();
  }

  function releaseDecoded() {
    decoded?.release?.();
    decoded = null;
  }

  /* ---------------------------------------------------------- decode/show -- */

  async function showBlob(blob, { name: displayName, declaredType, entry = null }) {
    const token = ++loadToken;
    decodeAbort?.abort();
    releaseDecoded();
    /* Nothing is actionable until validation and decode both succeed. */
    currentBlob = null;
    currentEntry = null;
    currentValidation = null;
    decoded = null;
    currentName = displayName || "image";
    fitMode = true;
    zoomScale = 1;
    clearMessages();
    validation.textContent = "Checking image…";
    dimensions.textContent = "—";
    loading.hidden = false;
    empty.hidden = true;
    updateControls();

    try {
      const validation = await inspectImage(blob, { declaredType: declaredType || blob?.type });
      if (disposed || token !== loadToken) return token;
      const controller = new AbortController();
      decodeAbort = controller;
      const result = await decodeImage(blob, validation, { signal: controller.signal });
      if (disposed || token !== loadToken || controller.signal.aborted) {
        result.release();
        return token;
      }
      decoded = result;
      currentValidation = validation;
      currentBlob = blob;
      currentEntry = entry;
      loading.hidden = true;
      renderMeta();
      draw();
      updateControls();
      setStatus(`Showing ${currentName}. Viewing did not change the saved file.`);
    } catch (error) {
      if (disposed || token !== loadToken || error?.code === "ABORTED") return token;
      loading.hidden = true;
      releaseDecoded();
      currentBlob = null;
      currentEntry = null;
      currentValidation = null;
      decodeAbort = null;
      name.textContent = currentName;
      validation.textContent = "Rejected · not shown";
      dimensions.textContent = "—";
      position.textContent = "—";
      canvas.setAttribute("aria-label", "No image is open");
      setError(formatImageError(error));
      updateControls();
    }
    return token;
  }

  function renderMeta() {
    if (!decoded || !currentValidation) return;
    const labels = Object.freeze({ png: "PNG", jpeg: "JPEG", webp: "WebP" });
    const label = labels[currentValidation.type] || currentValidation.type.toUpperCase();
    name.textContent = currentName;
    name.title = currentName;
    validation.textContent = `${label} · checked before decode · ${formatBytes(currentValidation.size)} · still image`;
    dimensions.textContent = formatDimensions(currentValidation.width, currentValidation.height);
    canvas.setAttribute("aria-label", `${currentName}, ${label} image, ${formatDimensions(currentValidation.width, currentValidation.height)} pixels`);
  }

  function draw() {
    if (!decoded || disposed) return;
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const availableWidth = Math.max(120, stage.clientWidth - 36);
    const availableHeight = Math.max(120, stage.clientHeight - 36);
    const wanted = fitMode ? fitScale(decoded.width, decoded.height, availableWidth, availableHeight) : zoomScale;
    const scale = clampScale(wanted, decoded.width, decoded.height, ratio);
    const cssWidth = Math.max(1, Math.round(decoded.width * scale));
    const cssHeight = Math.max(1, Math.round(decoded.height * scale));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.max(1, Math.round(cssWidth * ratio));
    canvas.height = Math.max(1, Math.round(cssHeight * ratio));
    const context = canvas.getContext("2d");
    context.setTransform(canvas.width / decoded.width, 0, 0, canvas.height / decoded.height, 0, 0);
    context.clearRect(0, 0, decoded.width, decoded.height);
    try {
      context.drawImage(decoded.image, 0, 0);
    } catch (error) {
      setError(formatImageError(error));
      return;
    }
    zoomLabel.textContent = fitMode ? "Fit" : `${Math.round(scale * 100)}%`;
  }

  function zoomBy(direction) {
    if (!decoded) return;
    const current = zoomScale;
    let index = ZOOM_STEPS.findIndex((step) => step >= current - 1e-6);
    if (index < 0) index = ZOOM_STEPS.length - 1;
    index = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + direction));
    fitMode = false;
    zoomScale = ZOOM_STEPS[index];
    draw();
    setStatus(`Zoom ${Math.round(zoomScale * 100)} percent.`);
  }

  function fit() {
    if (!decoded) return;
    fitMode = true;
    draw();
    setStatus("Fit to window.");
  }

  function actualSize() {
    if (!decoded) return;
    fitMode = false;
    zoomScale = 1;
    draw();
    setStatus("Actual size, 100 percent.");
  }

  async function step(offset) {
    const target = siblingAt(offset);
    if (!target) {
      setStatus(offset > 0 ? "There is no later image in this folder." : "There is no earlier image in this folder.");
      return;
    }
    await openStored(target);
  }

  async function openStored(entry) {
    position.textContent = "Finding nearby images…";
    const token = await showBlob(entry.blob, { name: entry.name, declaredType: entry.mediaType, entry });
    if (disposed || token !== loadToken) return;
    if (!currentEntry) {
      updateControls();
      return;
    }
    try {
      const list = await files.list(entry.parentId);
      if (disposed || token !== loadToken) return;
      siblings = Array.isArray(list) ? list.filter(isImageEntry) : [];
      const index = siblings.findIndex((item) => item.id === entry.id);
      position.textContent = index < 0 ? "Not in a browsable folder" : `${index + 1} of ${siblings.length}`;
    } catch (error) {
      if (!disposed && token === loadToken) position.textContent = "Nearby images unavailable";
    }
    updateControls();
  }

  /* ------------------------------------------------------------- gallery -- */

  async function renderGallery() {
    const found = [];
    for (const folderId of GALLERY_FOLDERS) {
      try {
        const list = await files.list(folderId);
        if (Array.isArray(list)) found.push(...list.filter(isImageEntry));
      } catch {
        /* a missing folder simply contributes no images */
      }
      if (disposed) return;
    }
    galleryList.replaceChildren();
    if (!found.length) {
      const item = el("li", "pv-gallery-empty", "No saved images yet. Preview a local image or save one from Paint.");
      galleryList.append(item);
      return;
    }
    for (const entry of found) {
      const item = el("li", "pv-gallery-item");
      const button = action(entry.name, "gallery-open", "pv-gallery-button");
      button.dataset.fileId = entry.id;
      button.title = entry.name;
      button.addEventListener("click", () => openStored(entry));
      item.append(button);
      galleryList.append(item);
    }
  }

  /* ------------------------------------------------------------- actions -- */

  function download() {
    if (!currentBlob) {
      setError("Open an image before downloading a copy.");
      return;
    }
    try {
      const url = URL.createObjectURL(currentBlob);
      downloadUrls.add(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeImageFilename(currentName, currentValidation?.mediaType || currentBlob.type);
      anchor.rel = "noopener";
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
        downloadUrls.delete(url);
      }, 1000);
      setStatus(`Downloaded a copy of ${currentName}.`);
    } catch (error) {
      setError(formatImageError(error));
    }
  }

  function editCopy() {
    if (!currentEntry) {
      setError("This local preview is not saved in Findows. Preview a saved image to edit a copy in Paint.");
      return;
    }
    if (typeof services.openApp !== "function") {
      setError("Findows can't open a Paint copy: no open action is available.");
      return;
    }
    try {
      services.openApp("paint", {
        fileId: currentEntry.id,
        mode: "edit-copy",
        source: "photo-viewer:edit-copy",
      });
      setStatus("Opening an unsaved copy in Paint. The original image is unchanged.");
    } catch (error) {
      setError(formatImageError(error));
    }
  }

  async function onFileChange(event) {
    const file = event.target?.files?.[0];
    event.target.value = "";
    if (!file || disposed) return;
    currentEntry = null;
    position.textContent = "Local preview · not saved";
    const token = await showBlob(file, { name: file.name, declaredType: file.type });
    if (disposed || token !== loadToken) return;
    updateControls();
    if (errorBox.hidden) setStatus("Local preview only. Nothing was uploaded, downloaded or saved.");
  }

  function onClick(event) {
    if (disposed || !(event.target instanceof Element)) return;
    const control = event.target.closest("[data-act]");
    if (!control || !root.contains(control)) return;
    switch (control.dataset.act) {
      case "fit": return fit();
      case "actual": return actualSize();
      case "zoom-out": return zoomBy(-1);
      case "zoom-in": return zoomBy(1);
      case "previous": return step(-1);
      case "next": return step(1);
      case "download": return download();
      case "edit-copy": return editCopy();
      case "choose-local":
        fileInput.value = "";
        fileInput.click();
        return;
      default: return;
    }
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented || event.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, button")) return;
    switch (event.key) {
      case "+": case "=": event.preventDefault(); zoomBy(1); break;
      case "-": case "_": event.preventDefault(); zoomBy(-1); break;
      case "0": event.preventDefault(); fit(); break;
      case "1": event.preventDefault(); actualSize(); break;
      case "ArrowRight": event.preventDefault(); step(1); break;
      case "ArrowLeft": event.preventDefault(); step(-1); break;
      default: break;
    }
  }

  const onAbort = () => dispose();
  root.addEventListener("click", onClick);
  stage.addEventListener("keydown", onKeyDown);
  fileInput.addEventListener("change", onFileChange);
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    decodeAbort?.abort();
    signal?.removeEventListener?.("abort", onAbort);
    root.removeEventListener("click", onClick);
    stage.removeEventListener("keydown", onKeyDown);
    fileInput.removeEventListener("change", onFileChange);
    releaseDecoded();
    for (const url of downloadUrls) {
      try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
    }
    downloadUrls.clear();
    root.remove();
  }

  /* --------------------------------------------------------------- startup -- */

  try {
    if (typeof files.ready === "function") {
      const storageMode = await files.ready();
      if (storageMode === "temporary" && !disposed) {
        badge.textContent = "Temporary mode · read-only";
        badge.dataset.mode = "temporary";
        setError("UNAVAILABLE: Browser storage is unavailable. Local preview and downloads still work; nothing is saved.");
      }
    }
  } catch (error) {
    if (!disposed) setError(formatImageError(error));
  }
  if (disposed) return { canClose: () => true, focus() {}, dispose };

  await renderGallery();
  if (disposed) return { canClose: () => true, focus() {}, dispose };

  if (fileId && typeof files.read === "function") {
    try {
      const entry = await files.read(fileId);
      if (!isImageEntry(entry)) {
        showEmpty("That file is not a supported still image.");
        setError("UNSUPPORTED_TYPE: only PNG, JPEG and WebP images can be previewed here.");
      } else {
        await openStored(entry);
      }
    } catch (error) {
      showEmpty();
      setError(formatImageError(error));
    }
  } else {
    showEmpty();
    if (errorBox.hidden) setStatus("Choose a saved image or preview a local image. Nothing is uploaded.");
  }
  if (disposed) return { canClose: () => true, focus() {}, dispose };
  if (mode && mode !== "view" && errorBox.hidden) {
    setStatus(`Opened in ${mode} mode; Photo Viewer remains read-only.`);
  }

  return {
    canClose: () => true,
    focus() {
      try { heading.focus({ preventScroll: true }); } catch { heading.focus(); }
    },
    dispose,
  };
}

export default { mount };
