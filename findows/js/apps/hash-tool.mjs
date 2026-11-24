/* Hash Tool: local SHA-256 of typed text or a picked file. Bytes go straight
   from the input to Web Crypto; there is no upload, fetch or remote dependency.
   Capability is detected at mount, and a missing/insecure crypto context shows
   an explicit Unavailable surface instead of a fake or remote fallback.
   All listeners are attached to this app's own root. */
import {
  MAX_FILE_BYTES,
  cryptoSupport,
  formatBytes,
  sha256Hex,
  utf8Bytes,
  validateFileSize,
} from "./hash-tool-engine.mjs";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const button = (label, className) => {
  const node = el("button", `ht-button ${className}`, label);
  node.type = "button";
  return node;
};

let instanceCount = 0;

export async function mount({ container, windowId, fileId, mode, draftId, services = {}, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Hash Tool needs a DOM container");
  }
  if (signal?.aborted) throw new DOMException("Hash Tool window was closed while loading", "AbortError");

  const uid = `ht-${++instanceCount}`;
  const support = cryptoSupport({
    subtle: globalThis.crypto?.subtle,
    secureContext: globalThis.isSecureContext,
  });
  const available = support.available;
  const subtle = available ? globalThis.crypto.subtle : null;

  let disposed = false;
  let sequence = 0;
  let currentDigest = "";

  const root = el("section", "ht-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Hash Tool");

  /* ---------- Chrome ---------- */
  const header = el("header", "ht-header");
  const title = el("h1", "ht-title", "Hash Tool");
  title.id = `${uid}-title`;
  header.setAttribute("aria-labelledby", title.id);
  header.append(title, el("p", "ht-privacy", "SHA-256 runs on this device. Text and files are never uploaded."));

  const unavailable = el("section", "ht-unavailable");
  unavailable.hidden = true;
  unavailable.tabIndex = -1;
  unavailable.setAttribute("role", "alert");
  unavailable.setAttribute("aria-label", "Hash Tool unavailable");
  const unavailableTitle = el("h2", "ht-unavailable-title", "Unavailable");
  const unavailableReason = el("p", "ht-unavailable-reason", support.reason);
  unavailable.append(unavailableTitle, unavailableReason,
    el("p", "ht-unavailable-note", "No text or file is read while hashing is unavailable."));

  /* ---------- Workspace ---------- */
  const workspace = el("div", "ht-workspace");
  workspace.hidden = !available;

  const controls = el("div", "ht-controls");
  const field = el("label", "ht-field");
  field.append(el("span", "ht-field-label", "Text to hash"));
  const textarea = document.createElement("textarea");
  textarea.className = "ht-text";
  textarea.setAttribute("aria-label", "Text to hash");
  textarea.placeholder = "Type or paste text — it stays on this device";
  textarea.rows = 5;
  textarea.spellcheck = false;
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("aria-describedby", `${uid}-hint`);
  textarea.disabled = !available;
  const hint = el("span", "ht-field-hint", "Ctrl+Enter hashes · Enter adds a new line");
  hint.id = `${uid}-hint`;
  field.append(textarea, hint);

  const fileRow = el("div", "ht-file-row");
  const fileButton = button("Choose file", "ht-file-button");
  fileButton.disabled = !available;
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.className = "ht-file-input";
  fileInput.hidden = true;
  fileInput.setAttribute("aria-label", "Choose a local file to hash");
  const fileLabel = el("span", "ht-file-name", "No file chosen");
  fileRow.append(fileButton, fileInput, fileLabel);

  const actions = el("div", "ht-actions");
  const hashButton = button("Hash text", "ht-primary ht-hash-text");
  const clearButton = button("Clear", "ht-clear");
  hashButton.disabled = !available;
  clearButton.disabled = !available;
  actions.append(hashButton, clearButton);
  controls.append(field, fileRow, actions);

  const errorBox = el("div", "ht-error");
  errorBox.setAttribute("role", "alert");
  errorBox.hidden = true;

  const result = el("section", "ht-result");
  result.hidden = true;
  result.setAttribute("aria-label", "SHA-256 result");
  const resultHead = el("div", "ht-result-head");
  const resultLabel = el("span", "ht-result-label", "SHA-256 digest");
  const source = el("span", "ht-source", "");
  resultHead.append(resultLabel, source);
  const digestNode = el("code", "ht-digest", "");
  digestNode.tabIndex = 0;
  digestNode.setAttribute("aria-label", "SHA-256 digest in lowercase hexadecimal");
  const copyButton = button("Copy digest", "ht-copy");
  copyButton.disabled = !available;
  result.append(resultHead, digestNode, copyButton);

  const status = el("p", "ht-status", available
    ? "Ready — text and files stay on this device."
    : "Hashing unavailable — nothing is read or uploaded.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  workspace.append(controls, errorBox, result, status);
  root.append(header, unavailable, workspace);
  container.replaceChildren(root);

  /* ---------- Painting ---------- */
  const announce = (message) => {
    if (!disposed) status.textContent = message;
  };
  const clearError = () => {
    errorBox.textContent = "";
    errorBox.hidden = true;
  };
  const showError = (message) => {
    if (disposed) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
  };

  /** Stale results never overwrite a newer action or a removed surface. */
  async function runHash(bytes, label, statusText) {
    if (!available || disposed) return;
    const token = ++sequence;
    clearError();
    let hex;
    try {
      hex = await sha256Hex(bytes, subtle, { secureContext: globalThis.isSecureContext });
    } catch (error) {
      if (disposed || token !== sequence) return;
      showError(error?.message || "This device could not compute the digest.");
      announce("Hashing failed. Nothing was uploaded.");
      return;
    }
    if (disposed || token !== sequence) return;
    currentDigest = hex;
    digestNode.textContent = hex;
    source.textContent = label;
    result.hidden = false;
    announce(`${statusText} Digest ready.`);
  }

  function hashText() {
    if (!available || disposed) return;
    const bytes = utf8Bytes(textarea.value);
    runHash(bytes, "Typed text",
      `SHA-256 of ${bytes.length} byte${bytes.length === 1 ? "" : "s"} of typed text.`);
  }

  function clearAll() {
    if (disposed) return;
    sequence += 1;
    currentDigest = "";
    textarea.value = "";
    fileLabel.textContent = "No file chosen";
    digestNode.textContent = "";
    source.textContent = "";
    result.hidden = true;
    clearError();
    announce("Cleared. Text and files stay on this device.");
  }

  async function copyDigest() {
    if (!currentDigest || disposed) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(currentDigest);
      announce("Digest copied to clipboard.");
    } catch {
      showError("Clipboard access was denied. Select the digest above and copy it manually.");
      announce("Copy failed. Select the digest and copy it manually.");
    }
  }

  /* ---------- Wiring (all listeners scoped to this app) ---------- */
  hashButton.addEventListener("click", hashText);
  clearButton.addEventListener("click", clearAll);
  copyButton.addEventListener("click", copyDigest);
  fileButton.addEventListener("click", () => {
    if (!disposed && available) fileInput.click();
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file || disposed || !available) return;
    const problem = validateFileSize(file.size);
    if (problem) {
      sequence += 1;
      showError(problem);
      announce("File rejected. Nothing was hashed or uploaded.");
      return;
    }
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      if (!disposed) showError("That file could not be read on this device.");
      return;
    }
    if (disposed) return;
    const bytes = new Uint8Array(buffer);
    fileLabel.textContent = file.name;
    runHash(bytes, `${file.name} · ${formatBytes(bytes.length)}`,
      `SHA-256 of ${file.name} (${formatBytes(bytes.length)}).`);
  });

  const onKeyDown = (event) => {
    if (event.defaultPrevented || disposed || event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.key === "Enter") {
        event.preventDefault();
        hashText();
        return;
      }
      return; // browser navigation and other shortcuts are left alone
    }
    if (event.altKey) return;
    // Enter in the field stays a newline; Tab and plain keys are never intercepted.
  };
  root.addEventListener("keydown", onKeyDown);

  if (!available) {
    unavailable.hidden = false;
    unavailableReason.textContent = support.reason;
  }

  /* ---------- Lifetime ---------- */
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    sequence += 1;
    signal?.removeEventListener?.("abort", onAbort);
    root.remove();
  }

  return {
    canClose: () => true,
    focus: () => {
      if (disposed) return;
      const target = available ? textarea : unavailable;
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    },
    dispose,
  };
}

export default { mount, MAX_FILE_BYTES };
