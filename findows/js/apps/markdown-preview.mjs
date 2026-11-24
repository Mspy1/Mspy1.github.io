/* Markdown Preview: a read-only renderer built entirely from text nodes and
   native elements. Markdown is tokenized by the pure engine, then emitted with
   createElement/textContent — never injects markup strings, never evaluates code. Raw HTML in the
   source stays literal, and links are inert labels (no href is ever set), so
   no script runs and no remote URL can be activated. All listeners are scoped
   to this app's own root; no document/window listeners or dependencies. */
import { MAX_SOURCE_CHARS, parseMarkdown } from "./markdown-preview-engine.mjs";

/** Coalesce bursts of keystrokes into one parse/render pass. */
const RENDER_DELAY_MS = 150;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const button = (label, action, className) => {
  const node = el("button", className, label);
  node.type = "button";
  node.dataset.action = action;
  return node;
};

const SAMPLE = [
  "# Markdown Preview",
  "",
  "A **bold** word, an *italic* word and a [safe link](https://example.com).",
  "",
  "- First item",
  "- Second item",
  "",
  "1. Step one",
  "2. Step two",
  "",
  "Raw <script>alert(1)</script> and <img src=http://evil.test/x> stay literal text.",
].join("\n");

let instanceCount = 0;

function countLinks(nodes) {
  let count = 0;
  for (const node of nodes || []) {
    if (node.type === "link") count += 1;
    else if (node.inline) count += countLinks(node.inline);
  }
  return count;
}

/** Render one inline node into `parent` using text nodes only. */
function renderInline(parent, nodes, announce) {
  for (const node of nodes) {
    if (node.type === "text") {
      parent.append(document.createTextNode(node.value));
    } else if (node.type === "code") {
      const code = el("code", "md-code", node.value);
      parent.append(code);
    } else if (node.type === "strong" || node.type === "em") {
      const wrap = el(node.type === "strong" ? "strong" : "em", node.type === "strong" ? "md-strong" : "md-em");
      renderInline(wrap, node.inline, announce);
      parent.append(wrap);
    } else if (node.type === "link") {
      renderLink(parent, node, announce);
    }
  }
}

/** Links are inert by design: no href is assigned, so nothing can navigate. */
function renderLink(parent, node, announce) {
  if (!node.safe || !node.href) {
    const blocked = el("span", "md-link-blocked");
    renderInline(blocked, node.inline, announce);
    blocked.append(el("span", "md-link-note", " (link blocked)"));
    parent.append(blocked);
    return;
  }
  const anchor = el("a", "md-link");
  anchor.setAttribute("role", "link");
  anchor.tabIndex = 0;
  anchor.title = "Links are shown for reading only and are never opened";
  renderInline(anchor, node.inline, announce);
  anchor.append(el("span", "md-link-url", ` (${node.href})`));
  const activate = (event) => {
    event.preventDefault();
    announce(`Link target: ${node.href} — this preview never opens links`);
  };
  anchor.addEventListener("click", activate);
  anchor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") activate(event);
  });
  parent.append(anchor);
}

function renderBlocks(target, ast, announce) {
  const fragment = document.createDocumentFragment();
  for (const block of ast.blocks) {
    if (block.type === "heading") {
      const heading = el(`h${block.level}`, `md-h md-h${block.level}`);
      renderInline(heading, block.inline, announce);
      fragment.append(heading);
    } else if (block.type === "paragraph") {
      const paragraph = el("p", "md-p");
      renderInline(paragraph, block.inline, announce);
      fragment.append(paragraph);
    } else if (block.type === "list") {
      const list = el(block.ordered ? "ol" : "ul", "md-list");
      for (const item of block.items) {
        const entry = el("li", "md-item");
        renderInline(entry, item, announce);
        list.append(entry);
      }
      fragment.append(list);
    } else if (block.type === "rule") {
      fragment.append(el("hr", "md-rule"));
    }
  }
  target.replaceChildren(fragment);
}

export async function mount({ container, windowId, source, services = {}, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Markdown Preview needs a DOM container");
  }
  if (signal?.aborted) throw new DOMException("Markdown Preview window was closed while loading", "AbortError");

  const uid = `md-${++instanceCount}`;
  const root = el("section", "md-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Markdown Preview");

  const header = el("header", "md-header");
  header.append(
    el("span", "md-eyebrow", "Preview tool"),
    el("h1", "md-title", "Markdown Preview"),
    el("p", "md-lead", "Type Markdown on the left; the preview updates on the right. Text is never run as markup or code, and links are never opened."),
  );

  const toolbar = el("div", "md-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Markdown Preview actions");
  const sampleButton = button("Insert sample", "sample", "md-button md-primary");
  const clearButton = button("Clear", "clear", "md-button");
  toolbar.append(sampleButton, clearButton);

  const workspace = el("div", "md-workspace");
  const inputPane = el("div", "md-pane md-input-pane");
  const sourceLabel = el("label", "md-pane-title", "Markdown source");
  sourceLabel.htmlFor = `${uid}-source`;
  const editor = document.createElement("textarea");
  editor.id = `${uid}-source`;
  editor.className = "md-input";
  editor.setAttribute("aria-label", "Markdown source");
  editor.setAttribute("dir", "auto");
  editor.spellcheck = false;
  inputPane.append(sourceLabel, editor);

  const previewPane = el("section", "md-pane md-preview-pane");
  const previewTitle = el("h2", "md-pane-title", "Rendered preview");
  previewTitle.id = `${uid}-preview-title`;
  const render = el("div", "md-render");
  render.setAttribute("role", "region");
  render.setAttribute("aria-label", "Rendered preview");
  render.setAttribute("aria-labelledby", previewTitle.id);
  previewPane.append(previewTitle, render);
  workspace.append(inputPane, previewPane);

  const status = el("footer", "md-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const note = el("span", "md-note");

  root.append(header, toolbar, workspace, status, note);
  container.replaceChildren(root);

  const state = { disposed: false };
  let renderTimer = null;
  const setStatus = (text) => { if (!state.disposed) status.textContent = text; };
  const announce = (text) => {
    if (!state.disposed) note.textContent = text;
    setStatus(text);
  };
  const cancelRender = () => {
    if (renderTimer === null) return;
    clearTimeout(renderTimer);
    renderTimer = null;
  };
  const tooLongStatus = (length) =>
    `Input too long — ${length.toLocaleString("en-US")} characters; limit ${MAX_SOURCE_CHARS.toLocaleString("en-US")}. Preview paused (showing previous content).`;

  function update() {
    if (state.disposed) return;
    let ast;
    try {
      ast = parseMarkdown(editor.value);
    } catch (error) {
      if (error?.code === "INPUT_TOO_LONG") {
        // No parse was started and no DOM was touched: keep the last safe
        // preview but say plainly that it no longer matches the source.
        setStatus(tooLongStatus(error.actual));
      } else {
        render.replaceChildren();
        setStatus("Preview unavailable");
      }
      return;
    }
    const links = countLinks(ast.blocks.flatMap((block) => block.inline || block.items?.flat() || []));
    renderBlocks(render, ast, announce);
    render.dataset.renderCount = String(Number(render.dataset.renderCount || 0) + 1);
    const blockCount = ast.blocks.length;
    setStatus(`${blockCount} block${blockCount === 1 ? "" : "s"} · ${links} link${links === 1 ? "" : "s"} · links stay inert`);
  }

  /** One timer per burst; oversized input is rejected before any parse work. */
  function scheduleRender() {
    if (state.disposed) return;
    cancelRender();
    note.textContent = "";
    const length = editor.value.length;
    if (length > MAX_SOURCE_CHARS) {
      setStatus(tooLongStatus(length));
      return;
    }
    setStatus("Updating preview…");
    renderTimer = setTimeout(() => {
      renderTimer = null;
      update();
    }, RENDER_DELAY_MS);
  }

  const onInput = scheduleRender;
  const applySource = (text) => {
    if (state.disposed) return;
    cancelRender();
    note.textContent = "";
    editor.value = text;
    update();
    editor.focus({ preventScroll: true });
  };
  const onSample = () => applySource(SAMPLE);
  const onClear = () => applySource("");
  editor.addEventListener("input", onInput);
  sampleButton.addEventListener("click", onSample);
  clearButton.addEventListener("click", onClear);

  editor.value = typeof source === "string" ? source : SAMPLE;
  editor.setSelectionRange(0, 0);
  update();

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    cancelRender();
    signal?.removeEventListener?.("abort", onAbort);
    editor.removeEventListener("input", onInput);
    sampleButton.removeEventListener("click", onSample);
    clearButton.removeEventListener("click", onClear);
    render.replaceChildren();
    root.remove();
  }
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  return {
    canClose: async () => true,
    focus: () => editor.focus({ preventScroll: true }),
    dispose,
  };
}

export default { mount };
