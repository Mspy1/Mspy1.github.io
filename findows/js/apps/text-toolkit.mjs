/* Text Toolkit UI: an accessible, text-only surface over the pure engine.
   No global listeners, no eval, no untrusted markup. Every value is written with
   textContent / textarea.value; keyboard handling is scoped to this app. */
import {
  MAX_INPUT_CHARS,
  OPERATIONS,
  OPERATION_GROUPS,
  runToolkit,
} from "./text-toolkit-engine.mjs";

let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function statText(counts) {
  return `${counts.words} words · ${counts.chars} characters · ${counts.lines} lines`;
}

function safeCounts(value) {
  try {
    return runToolkit(value, "count").counts;
  } catch {
    return { words: 0, chars: [...value].length, lines: 0 };
  }
}

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Text Toolkit needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Text Toolkit window was closed while loading", "AbortError");
  }

  const uid = `ttk-${++instanceCount}`;
  let disposed = false;
  const timers = new Set();
  const objectUrls = new Set();

  const root = el("div", "ttk-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Text Toolkit");

  const head = el("div", "ttk-head");
  const title = el("h2", "ttk-title", "Text Toolkit");
  title.id = `${uid}-title`;
  const subtitle = el("p", "ttk-subtitle", "Convert, clean and count text locally.");
  head.append(title, subtitle);

  const grid = el("div", "ttk-grid");

  const inputCol = el("div", "ttk-col");
  const inputLabel = el("label", "ttk-label", "Input");
  inputLabel.id = `${uid}-input-label`;
  const input = document.createElement("textarea");
  input.className = "ttk-input";
  input.spellcheck = false;
  input.setAttribute("aria-labelledby", inputLabel.id);
  input.setAttribute("placeholder", "Paste or type text here…");
  const inputCount = el("p", "ttk-counter ttk-input-count", "0 words · 0 characters · 0 lines · 0/20,000");
  inputCol.append(inputLabel, input, inputCount);

  const outputCol = el("div", "ttk-col");
  const outputLabel = el("label", "ttk-label", "Result");
  outputLabel.id = `${uid}-output-label`;
  const output = document.createElement("textarea");
  output.className = "ttk-output";
  output.readOnly = true;
  output.setAttribute("aria-labelledby", outputLabel.id);
  output.setAttribute("placeholder", "The transformed text appears here.");
  const outputCount = el("p", "ttk-counter ttk-output-count", statText({ words: 0, chars: 0, lines: 0 }));
  outputCol.append(outputLabel, output, outputCount);

  grid.append(inputCol, outputCol);

  const controls = el("div", "ttk-controls");

  const opField = el("div", "ttk-field ttk-field-operation");
  const opLabel = el("label", "ttk-label", "Transform");
  opLabel.id = `${uid}-op-label`;
  const operationSelect = document.createElement("select");
  operationSelect.className = "ttk-operation";
  operationSelect.setAttribute("aria-labelledby", opLabel.id);
  for (const group of OPERATION_GROUPS) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const operation of OPERATIONS) {
      if (operation.group !== group.id) continue;
      const option = document.createElement("option");
      option.value = operation.id;
      option.textContent = operation.label;
      option.title = operation.hint;
      optgroup.append(option);
    }
    operationSelect.append(optgroup);
  }
  opField.append(opLabel, operationSelect);

  const tabField = el("div", "ttk-field ttk-field-tab");
  const tabLabel = el("label", "ttk-label", "Tab size");
  tabLabel.id = `${uid}-tab-label`;
  const tabSizeSelect = document.createElement("select");
  tabSizeSelect.className = "ttk-tab-size";
  tabSizeSelect.setAttribute("aria-labelledby", tabLabel.id);
  for (let size = 1; size <= 8; size += 1) {
    const option = document.createElement("option");
    option.value = String(size);
    option.textContent = String(size);
    tabSizeSelect.append(option);
  }
  tabSizeSelect.value = "2";
  tabField.append(tabLabel, tabSizeSelect);

  const actions = el("div", "ttk-actions");
  const apply = el("button", "ttk-apply ttk-button-primary", "Apply");
  apply.type = "button";
  const clear = el("button", "ttk-clear", "Clear");
  clear.type = "button";
  const copy = el("button", "ttk-copy", "Copy result");
  copy.type = "button";
  const download = el("button", "ttk-download", "Download result");
  download.type = "button";
  actions.append(apply, clear, copy, download);

  controls.append(opField, tabField, actions);

  const errorBox = el("p", "ttk-error");
  errorBox.setAttribute("role", "alert");
  errorBox.setAttribute("aria-live", "assertive");
  errorBox.setAttribute("aria-atomic", "true");
  errorBox.hidden = true;

  const status = el("p", "ttk-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  const hint = el("p", "ttk-hint", "Tab moves between controls. Ctrl/⌘+Enter applies the transform. Text never leaves this window.");

  root.append(head, grid, controls, errorBox, status, hint);
  container.replaceChildren(root);

  function setStatus(message) {
    status.textContent = message;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.textContent = "";
    errorBox.hidden = true;
  }

  function syncCounts() {
    const counts = safeCounts(input.value);
    const limit = counts.chars.toLocaleString("en-US");
    inputCount.textContent = `${statText(counts)} · ${limit}/${MAX_INPUT_CHARS.toLocaleString("en-US")}`;
  }

  function syncTabField() {
    tabSizeSelect.disabled = operationSelect.value !== "tabs-to-spaces";
  }

  function currentResult() {
    const result = runToolkit(input.value, operationSelect.value, {
      tabSize: Number(tabSizeSelect.value),
    });
    return result;
  }

  function applyTransform() {
    if (disposed) return;
    try {
      const result = currentResult();
      output.value = result.output;
      outputCount.textContent = statText(result.outputCounts);
      clearError();
      const operation = OPERATIONS.find((item) => item.id === result.operation);
      setStatus(`${operation ? operation.label : result.operation} applied.`);
    } catch (error) {
      showError(error && error.message ? error.message : "The transform could not be applied.");
      setStatus("Nothing changed. Fix the input and apply again.");
    }
  }

  function clearAll() {
    if (disposed) return;
    input.value = "";
    output.value = "";
    outputCount.textContent = statText({ words: 0, chars: 0, lines: 0 });
    clearError();
    syncCounts();
    setStatus("Input and result cleared.");
  }

  async function copyResult() {
    if (disposed) return;
    const text = output.value;
    if (!text) {
      setStatus("Apply a transform first; there is nothing to copy.");
      return;
    }
    const fallback = typeof navigator === "undefined" ? null : navigator.clipboard;
    const clipboard = (services && services.clipboard) || fallback;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      setStatus("Copy is blocked here. Use Download result instead.");
      return;
    }
    try {
      await clipboard.writeText(text);
      if (!disposed) setStatus("Result copied to the clipboard.");
    } catch {
      if (!disposed) setStatus("Copy was blocked. Use Download result instead.");
    }
  }

  function releaseUrl(url) {
    try { URL.revokeObjectURL(url); } catch { /* already released */ }
    objectUrls.delete(url);
  }

  function downloadResult() {
    if (disposed) return;
    const text = output.value;
    if (!text) {
      setStatus("Apply a transform first; there is nothing to download.");
      return;
    }
    let url = null;
    try {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      url = URL.createObjectURL(blob);
      objectUrls.add(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "findows-text-result.txt";
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      const timer = setTimeout(() => {
        timers.delete(timer);
        releaseUrl(url);
      }, 1000);
      timers.add(timer);
      setStatus("Download started: text result saved as findows-text-result.txt");
    } catch {
      if (url) releaseUrl(url);
      setStatus("Download is blocked here. Use Copy result instead.");
    }
  }

  function onInput() {
    syncCounts();
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyTransform();
  }

  function onOperationChange() {
    syncTabField();
  }

  function onApplyClick() { applyTransform(); }
  function onClearClick() { clearAll(); }
  function onCopyClick() { void copyResult(); }
  function onDownloadClick() { downloadResult(); }
  function onAbort() { dispose(); }

  input.addEventListener("input", onInput);
  operationSelect.addEventListener("change", onOperationChange);
  apply.addEventListener("click", onApplyClick);
  clear.addEventListener("click", onClearClick);
  copy.addEventListener("click", onCopyClick);
  download.addEventListener("click", onDownloadClick);
  root.addEventListener("keydown", onKeyDown);
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    input.removeEventListener("input", onInput);
    operationSelect.removeEventListener("change", onOperationChange);
    apply.removeEventListener("click", onApplyClick);
    clear.removeEventListener("click", onClearClick);
    copy.removeEventListener("click", onCopyClick);
    download.removeEventListener("click", onDownloadClick);
    root.removeEventListener("keydown", onKeyDown);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const url of objectUrls) releaseUrl(url);
    root.remove();
  }

  syncCounts();
  syncTabField();

  return {
    canClose: () => true,
    focus() {
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    },
    dispose,
  };
}

export default { mount };
