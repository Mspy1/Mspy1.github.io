/* Base64 & URL codec UI: an accessible surface over the pure engine.
   Scoped listeners only, no globals, no eval, no untrusted markup. */
import { transform, MODES, OPERATIONS } from "./base64-codec-engine.mjs";

const MODE_LABELS = Object.freeze({ [MODES.BASE64]: "Base64 text", [MODES.URL]: "URL component" });
let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className, text, action) {
  const node = el("button", className, text);
  node.type = "button";
  if (action) node.dataset.action = action;
  return node;
}

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Base64 codec needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Base64 codec window was closed while loading", "AbortError");
  }

  const uid = `b64-${++instanceCount}`;
  let disposed = false;
  let mode = MODES.BASE64;

  const root = el("div", "b64-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Base64 and URL codec");

  const head = el("div", "b64-head");
  const title = el("h2", "b64-title", "Base64 & URL Codec");
  title.id = `${uid}-title`;
  const subtitle = el("p", "b64-subtitle", "Encode or decode text locally. Nothing leaves this device.");
  head.append(title, subtitle);

  const modes = el("div", "b64-modes");
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", "Encoding mode");
  const modeButtons = [];
  for (const value of [MODES.BASE64, MODES.URL]) {
    const node = el("button", "b64-mode", MODE_LABELS[value]);
    node.type = "button";
    node.dataset.mode = value;
    node.setAttribute("aria-pressed", String(value === mode));
    modes.append(node);
    modeButtons.push(node);
  }

  const fields = el("div", "b64-fields");

  const inputField = el("div", "b64-field");
  const inputLabel = el("label", "b64-label", "Input");
  inputLabel.htmlFor = `${uid}-input`;
  const input = el("textarea", "b64-input");
  input.id = `${uid}-input`;
  input.rows = 5;
  input.spellcheck = false;
  input.setAttribute("aria-describedby", `${uid}-hint`);
  input.placeholder = "Type or paste text to encode, or a value to decode";
  inputField.append(inputLabel, input);

  const outputField = el("div", "b64-field");
  const outputLabel = el("label", "b64-label", "Output");
  outputLabel.htmlFor = `${uid}-output`;
  const output = document.createElement("output");
  output.className = "b64-output";
  output.id = `${uid}-output`;
  output.tabIndex = 0;
  output.setAttribute("aria-label", "Result");
  outputField.append(outputLabel, output);

  const actions = el("div", "b64-actions");
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Codec actions");
  const encodeButton = button("b64-action b64-primary", "Encode", "encode");
  const decodeButton = button("b64-action", "Decode", "decode");
  const swapButton = button("b64-action", "Swap result into input", "swap");
  const clearButton = button("b64-action", "Clear", "clear");
  const copyButton = button("b64-action b64-copy", "Copy result", "copy");
  actions.append(encodeButton, decodeButton, swapButton, clearButton, copyButton);
  encodeButton.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter");
  decodeButton.setAttribute("aria-keyshortcuts", "Control+Shift+Enter Meta+Shift+Enter");

  fields.append(inputField, outputField, actions);

  const errorBox = el("p", "b64-error");
  errorBox.setAttribute("role", "alert");
  errorBox.setAttribute("aria-live", "assertive");
  errorBox.setAttribute("aria-atomic", "true");
  errorBox.hidden = true;

  const status = el("p", "b64-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  const hint = el("p", "b64-hint", "Ctrl+Enter encodes, Ctrl+Shift+Enter decodes. Tab moves between controls.");
  hint.id = `${uid}-hint`;

  root.append(head, modes, fields, errorBox, status, hint);
  container.replaceChildren(root);

  function clearError() {
    errorBox.textContent = "";
    errorBox.hidden = true;
    input.removeAttribute("aria-invalid");
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    input.setAttribute("aria-invalid", "true");
  }

  function announce(message) {
    status.textContent = message;
  }

  function apply(operation) {
    if (disposed) return;
    const result = transform(mode, operation, input.value);
    if (result.ok) {
      output.textContent = result.output;
      clearError();
      announce(`${MODE_LABELS[mode]} ${operation}d.`);
      return;
    }
    output.textContent = "";
    showError(result.error.message);
    announce("");
  }

  function setMode(next) {
    if (disposed || mode === next) return;
    mode = next;
    for (const node of modeButtons) {
      node.setAttribute("aria-pressed", String(node.dataset.mode === mode));
    }
    clearError();
    announce(`${MODE_LABELS[mode]} mode selected.`);
  }

  async function writeClipboard(value) {
    const injected = services?.clipboard;
    if (injected && typeof injected.writeText === "function") {
      return injected.writeText(value);
    }
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      return clipboard.writeText(value);
    }
    throw new Error("No clipboard API is available");
  }

  async function copyOutput() {
    if (disposed) return;
    const value = output.textContent || "";
    if (!value) {
      announce("Nothing to copy — run Encode or Decode first.");
      return;
    }
    try {
      await writeClipboard(value);
      if (!disposed) announce("Result copied to the clipboard.");
    } catch {
      if (!disposed) announce("Copy failed — select the result and copy it manually.");
    }
  }

  function onActionClick(event) {
    const target = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
    if (!target || !actions.contains(target)) return;
    switch (target.dataset.action) {
      case "encode": apply(OPERATIONS.ENCODE); break;
      case "decode": apply(OPERATIONS.DECODE); break;
      case "swap":
        if (output.textContent) {
          input.value = output.textContent;
          output.textContent = "";
          clearError();
          announce("Result moved into the input.");
          input.focus({ preventScroll: true });
        } else {
          announce("Nothing to swap — run Encode or Decode first.");
        }
        break;
      case "clear":
        input.value = "";
        output.textContent = "";
        clearError();
        announce("Input and output cleared.");
        input.focus({ preventScroll: true });
        break;
      case "copy": void copyOutput(); break;
      default: break;
    }
  }

  function onModeClick(event) {
    const target = event.target instanceof Element ? event.target.closest("button[data-mode]") : null;
    if (!target || !modes.contains(target)) return;
    setMode(target.dataset.mode);
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
    event.preventDefault();
    apply(event.shiftKey ? OPERATIONS.DECODE : OPERATIONS.ENCODE);
  }

  const onAbort = () => dispose();
  actions.addEventListener("click", onActionClick);
  modes.addEventListener("click", onModeClick);
  root.addEventListener("keydown", onKeyDown);
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    actions.removeEventListener("click", onActionClick);
    modes.removeEventListener("click", onModeClick);
    root.removeEventListener("keydown", onKeyDown);
    root.remove();
  }

  return {
    canClose: () => true,
    focus() {
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    },
    dispose,
  };
}

export default { mount };
