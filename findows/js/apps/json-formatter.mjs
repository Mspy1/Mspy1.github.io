/* JSON Formatter UI: an accessible local surface over the pure engine.
   All output is created with createElement/textContent. There are no global
   listeners, no markup strings, no dynamic code and no remote requests. */
import {
  formatJson,
  minifyJson,
  toDownloadName,
} from "./json-formatter-engine.mjs";

const SAMPLE = JSON.stringify({
  app: "Findows",
  version: 2,
  settings: { theme: "dark", tabs: ["files", "notes"] },
  note: '<img src=x onerror="window.__jsonfmtXss=1">',
  flags: { active: true, empty: null },
}, null, 2);

let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Display-safe scalar: JSON.stringify plus escaped angle brackets. */
function displayScalar(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("JSON Formatter needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("JSON Formatter window was closed while loading", "AbortError");
  }

  const uid = `jsonfmt-${++instanceCount}`;
  let disposed = false;
  let currentText = null;
  let formatTimer = null;
  const pendingTimers = new Set();
  const objectUrls = new Set();

  /** Revoke once: set membership is the guard against a double revoke. */
  function revokeUrl(url) {
    if (!objectUrls.delete(url)) return;
    URL.revokeObjectURL(url);
  }

  function later(fn, delay) {
    const id = setTimeout(() => {
      pendingTimers.delete(id);
      if (!disposed) fn();
    }, delay);
    pendingTimers.add(id);
    return id;
  }

  const root = el("div", "jsonfmt-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "JSON Formatter");

  const head = el("div", "jsonfmt-head");
  const title = el("h2", "jsonfmt-title", "JSON Formatter");
  title.id = `${uid}-title`;
  const subtitle = el("p", "jsonfmt-subtitle", "Paste, format and inspect JSON locally.");
  head.append(title, subtitle);

  const main = el("div", "jsonfmt-main");

  /* ---------- editor column ---------- */
  const editor = el("section", "jsonfmt-editor");
  editor.setAttribute("aria-labelledby", `${uid}-editor-title`);
  const editorTitle = el("h3", "jsonfmt-section-title", "Input");
  editorTitle.id = `${uid}-editor-title`;

  const inputRow = el("div", "jsonfmt-input-row");
  const inputLabel = el("label", "jsonfmt-label", "JSON input");
  inputLabel.htmlFor = `${uid}-input`;
  const inputActions = el("div", "jsonfmt-input-actions");

  function action(token, label, className = "") {
    const button = el("button", `jsonfmt-btn ${className}`.trim(), label);
    button.type = "button";
    button.dataset.action = token;
    return button;
  }

  const pasteButton = action("paste", "Paste");
  const sampleButton = action("sample", "Sample");
  const clearButton = action("clear", "Clear");
  inputActions.append(pasteButton, sampleButton, clearButton);
  inputRow.append(inputLabel, inputActions);

  const input = el("textarea", "jsonfmt-input");
  input.id = `${uid}-input`;
  input.spellcheck = false;
  input.setAttribute("aria-describedby", `${uid}-hint`);
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("autocorrect", "off");
  input.placeholder = "Paste or type JSON here…";

  const hint = el("p", "jsonfmt-hint", "Nothing leaves this window. Ctrl+Enter formats immediately.");
  hint.id = `${uid}-hint`;

  const controls = el("div", "jsonfmt-controls");
  const indentLabel = el("label", "jsonfmt-control-label", "Indent");
  indentLabel.htmlFor = `${uid}-indent`;
  const indent = el("select", "jsonfmt-indent");
  indent.id = `${uid}-indent`;
  for (const option of [
    { value: "2", label: "2 spaces" },
    { value: "4", label: "4 spaces" },
    { value: "\t", label: "Tab" },
    { value: "0", label: "Compact" },
  ]) {
    const item = el("option", "", option.label);
    item.value = option.value;
    indent.append(item);
  }
  indent.value = "2";

  const sortLabel = el("label", "jsonfmt-check");
  const sortCheckbox = el("input", "jsonfmt-sort");
  sortCheckbox.type = "checkbox";
  sortLabel.append(sortCheckbox, document.createTextNode(" Sort keys"));

  const liveLabel = el("label", "jsonfmt-check");
  const liveCheckbox = el("input", "jsonfmt-live");
  liveCheckbox.type = "checkbox";
  liveCheckbox.checked = true;
  liveLabel.append(liveCheckbox, document.createTextNode(" Live"));

  const formatButton = action("format", "Format", "jsonfmt-primary");
  const minifyButton = action("minify", "Minify");
  controls.append(indentLabel, indent, sortLabel, liveLabel, formatButton, minifyButton);

  editor.append(editorTitle, inputRow, input, hint, controls);

  /* ---------- results column ---------- */
  const results = el("section", "jsonfmt-results");
  results.setAttribute("aria-labelledby", `${uid}-results-title`);
  const resultsHead = el("div", "jsonfmt-results-head");
  const resultsTitle = el("h3", "jsonfmt-section-title", "Tree");
  resultsTitle.id = `${uid}-results-title`;
  const stats = el("span", "jsonfmt-stats", "");
  const treeActions = el("div", "jsonfmt-tree-actions");
  const expandButton = action("expand", "Expand all");
  const collapseButton = action("collapse", "Collapse all");
  treeActions.append(expandButton, collapseButton);
  resultsHead.append(resultsTitle, stats, treeActions);

  const errorBox = el("div", "jsonfmt-error");
  errorBox.setAttribute("role", "alert");
  errorBox.setAttribute("aria-live", "assertive");
  errorBox.setAttribute("aria-atomic", "true");
  errorBox.hidden = true;
  const errorMessage = el("p", "jsonfmt-error-message", "");
  const errorLocation = el("p", "jsonfmt-error-location", "");
  const errorSnippet = el("code", "jsonfmt-error-snippet", "");
  const errorCaret = el("pre", "jsonfmt-error-caret", "");
  errorBox.append(errorMessage, errorLocation, errorSnippet, errorCaret);

  const tree = el("div", "jsonfmt-tree");
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-label", "Formatted JSON tree");
  const empty = el("p", "jsonfmt-empty", "Formatted JSON will appear here.");

  results.append(resultsHead, errorBox, tree, empty);
  main.append(editor, results);

  /* ---------- footer ---------- */
  const footer = el("div", "jsonfmt-footer");
  const outputInfo = el("span", "jsonfmt-output-info", "0 characters");
  const copyButton = action("copy", "Copy JSON", "jsonfmt-primary");
  const downloadButton = action("download", "Download");
  footer.append(outputInfo, copyButton, downloadButton);

  const status = el("p", "jsonfmt-sr-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  root.append(head, main, footer, status);
  container.replaceChildren(root);

  function announce(message) {
    status.textContent = message;
  }

  function showError(error) {
    errorBox.hidden = false;
    errorMessage.textContent = error.message || "Invalid JSON";
    errorLocation.textContent = `Line ${error.line}, column ${error.column} (position ${error.position})`;
    errorSnippet.textContent = error.near || "(end of input)";
    errorCaret.textContent = `${" ".repeat(Math.max(0, Math.min(error.column - 1, 60)))}^`;
    tree.replaceChildren();
    stats.textContent = "";
    empty.hidden = true;
    outputInfo.textContent = "0 characters";
  }

  function buildNode(node) {
    const isContainer = node.type === "object" || node.type === "array";
    const wrapper = el("div", `jsonfmt-node jsonfmt-node--${node.type}`);
    wrapper.setAttribute("role", "treeitem");
    wrapper.dataset.path = node.path;
    const row = el("div", "jsonfmt-node-row");

    if (isContainer) {
      wrapper.setAttribute("aria-expanded", "true");
      const toggle = el("button", "jsonfmt-toggle", "▾");
      toggle.type = "button";
      toggle.dataset.path = node.path;
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", `Collapse ${node.path}`);
      row.append(toggle);
    } else {
      row.append(el("span", "jsonfmt-toggle-spacer", ""));
    }

    if (node.key != null || node.index != null) {
      row.append(el("span", "jsonfmt-key", node.key != null ? node.key : String(node.index)));
      row.append(el("span", "jsonfmt-punct", ": "));
    }

    if (isContainer) {
      row.append(el("span", "jsonfmt-punct", node.type === "object" ? "{" : "["));
      const count = node.children.length;
      row.append(el("span", "jsonfmt-meta", `${count} ${count === 1 ? "item" : "items"}`));
    } else {
      row.append(el("span", `jsonfmt-value jsonfmt-value--${node.type}`, displayScalar(node.value)));
    }
    wrapper.append(row);

    if (isContainer) {
      const group = el("div", "jsonfmt-children");
      group.setAttribute("role", "group");
      for (const child of node.children) group.append(buildNode(child));
      wrapper.append(group);
    }
    return wrapper;
  }

  function renderSuccess(result) {
    currentText = result.text;
    errorBox.hidden = true;
    empty.hidden = true;
    stats.textContent = `${result.stats.nodes} nodes · depth ${result.stats.maxDepth}`;
    const fragment = document.createDocumentFragment();
    fragment.append(buildNode(result.root));
    tree.replaceChildren(fragment);
    outputInfo.textContent = `${result.text.length} characters`;
  }

  function indentValue() {
    const value = indent.value;
    return value === "\t" ? "\t" : Number(value);
  }

  function applyFormat() {
    if (formatTimer !== null) {
      clearTimeout(formatTimer);
      pendingTimers.delete(formatTimer);
      formatTimer = null;
    }
    const result = formatJson(input.value, { indent: indentValue(), sortKeys: sortCheckbox.checked });
    if (!result.ok) {
      currentText = null;
      showError(result.error);
      return false;
    }
    renderSuccess(result);
    return true;
  }

  function applyMinify() {
    const result = minifyJson(input.value);
    if (!result.ok) {
      currentText = null;
      showError(result.error);
      announce("Invalid JSON; cannot minify.");
      return;
    }
    input.value = result.text;
    renderSuccess(result);
    announce(`Minified to ${result.text.length} characters.`);
  }

  function setCollapsed(wrapper, collapsed) {
    const toggle = wrapper.querySelector(":scope > .jsonfmt-node-row > .jsonfmt-toggle");
    if (!toggle) return;
    const group = wrapper.querySelector(":scope > .jsonfmt-children");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${wrapper.dataset.path || "node"}`);
    toggle.textContent = collapsed ? "▸" : "▾";
    if (group) group.hidden = collapsed;
    wrapper.setAttribute("aria-expanded", String(!collapsed));
    wrapper.classList.toggle("is-collapsed", collapsed);
  }

  async function pasteFromClipboard() {
    try {
      let text;
      if (services?.clipboard?.readText) text = await services.clipboard.readText();
      else if (navigator?.clipboard?.readText) text = await navigator.clipboard.readText();
      else {
        announce("Clipboard access is unavailable; paste into the input instead.");
        return;
      }
      if (disposed) return;
      input.value = typeof text === "string" ? text : String(text ?? "");
      if (applyFormat()) announce(`Pasted and formatted ${input.value.length} characters.`);
      else announce("Pasted text is not valid JSON.");
    } catch {
      announce("Clipboard read failed; paste into the input instead.");
    }
  }

  async function copyOutput() {
    if (!currentText) {
      announce("Nothing to copy yet.");
      return;
    }
    try {
      if (services?.clipboard?.writeText) await services.clipboard.writeText(currentText);
      else if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(currentText);
      else {
        const scratch = el("textarea", "jsonfmt-scratch");
        scratch.value = currentText;
        root.append(scratch);
        try {
          scratch.select();
          if (document.execCommand("copy") !== true) {
            throw new Error("legacy copy command was refused");
          }
        } finally {
          scratch.remove();
        }
      }
      if (!disposed) announce("Copied formatted JSON.");
    } catch {
      if (!disposed) announce("Copy failed; select the tree text instead.");
    }
  }

  function downloadOutput() {
    if (!currentText) {
      announce("Nothing to download yet.");
      return;
    }
    const filename = toDownloadName(windowId);
    const detail = { filename, content: currentText, mimeType: "application/json" };
    if (services?.download) {
      services.download(detail);
      announce(`Downloaded ${filename}.`);
      return;
    }
    const url = URL.createObjectURL(new Blob([currentText], { type: "application/json" }));
    objectUrls.add(url);
    const link = el("a", "jsonfmt-download-link");
    link.href = url;
    link.download = filename;
    root.append(link);
    link.click();
    link.remove();
    // The delayed revoke is a cleanup, not UI work: dispose() revokes any
    // still-live URL itself, so closing early cannot leak the Blob payload.
    later(() => revokeUrl(url), 1000);
    announce(`Downloaded ${filename}.`);
  }

  function onInput() {
    if (formatTimer !== null) {
      clearTimeout(formatTimer);
      pendingTimers.delete(formatTimer);
      formatTimer = null;
    }
    if (liveCheckbox.checked) {
      formatTimer = later(() => {
        formatTimer = null;
        applyFormat();
      }, 150);
    }
  }

  function onOptionChange() {
    if (liveCheckbox.checked && input.value.trim()) applyFormat();
  }

  function onToggleClick(event) {
    const toggle = event.target instanceof Element ? event.target.closest(".jsonfmt-toggle") : null;
    if (!toggle || !tree.contains(toggle)) return;
    const wrapper = toggle.closest(".jsonfmt-node");
    if (wrapper) setCollapsed(wrapper, toggle.getAttribute("aria-expanded") === "true");
  }

  function onButtonClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
    if (!button || !root.contains(button)) return;
    switch (button.dataset.action) {
      case "paste": pasteFromClipboard(); break;
      case "sample":
        input.value = SAMPLE;
        if (applyFormat()) announce("Loaded sample JSON.");
        break;
      case "clear":
        input.value = "";
        currentText = null;
        tree.replaceChildren();
        errorBox.hidden = true;
        empty.hidden = false;
        stats.textContent = "";
        outputInfo.textContent = "0 characters";
        announce("Input cleared.");
        break;
      case "format":
        announce(applyFormat() ? `Formatted ${stats.textContent}.` : "Invalid JSON; see the error below.");
        break;
      case "minify": applyMinify(); break;
      case "expand":
        for (const node of tree.querySelectorAll(".jsonfmt-node--object, .jsonfmt-node--array")) setCollapsed(node, false);
        announce("All nodes expanded.");
        break;
      case "collapse":
        for (const node of tree.querySelectorAll(".jsonfmt-node--object, .jsonfmt-node--array")) setCollapsed(node, true);
        announce("All nodes collapsed.");
        break;
      case "copy": copyOutput(); break;
      case "download": downloadOutput(); break;
      default: break;
    }
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      announce(applyFormat() ? "Formatted JSON." : "Invalid JSON; see the error below.");
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".jsonfmt-toggle")) return;
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const wrapper = target.closest(".jsonfmt-node");
    if (wrapper) {
      setCollapsed(wrapper, event.key === "ArrowLeft");
      event.preventDefault();
    }
  }

  root.addEventListener("click", onButtonClick);
  tree.addEventListener("click", onToggleClick);
  input.addEventListener("input", onInput);
  indent.addEventListener("change", onOptionChange);
  sortCheckbox.addEventListener("change", onOptionChange);
  root.addEventListener("keydown", onKeyDown);
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const id of pendingTimers) clearTimeout(id);
    pendingTimers.clear();
    formatTimer = null;
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
    signal?.removeEventListener?.("abort", onAbort);
    root.removeEventListener("click", onButtonClick);
    tree.removeEventListener("click", onToggleClick);
    input.removeEventListener("input", onInput);
    indent.removeEventListener("change", onOptionChange);
    sortCheckbox.removeEventListener("change", onOptionChange);
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
