/* Character Map UI: an accessible Unicode glyph atlas over the pure catalog.
   No global listeners, no eval, no untrusted markup. Every glyph and every
   search string is written with textContent, so glyphs stay inert text. */
import {
  getBlock,
  glyphsInBlock,
  labelFor,
  listBlocks,
  search as searchCatalog,
} from "./character-map-engine.mjs";

let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Character Map needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Character Map window was closed while loading", "AbortError");
  }

  const uid = `cm-${++instanceCount}`;
  let disposed = false;
  let selected = null;
  let copySequence = 0;
  let currentGlyphs = [];
  const glyphsByHex = new Map();
  const blocks = listBlocks();

  const root = el("div", "cm-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Character Map");

  const head = el("header", "cm-head");
  const heading = el("div", "cm-heading");
  const title = el("h2", "cm-title", "Character Map");
  title.id = `${uid}-title`;
  const subtitle = el("p", "cm-subtitle", "Browse Unicode glyphs by block, or find one by name or codepoint.");
  heading.append(title, subtitle);

  const controls = el("div", "cm-controls");
  const blockWrap = el("div", "cm-control");
  const blockLabel = el("label", "cm-field-label", "Unicode block");
  blockLabel.htmlFor = `${uid}-block`;
  const blockSelect = document.createElement("select");
  blockSelect.className = "cm-block";
  blockSelect.id = `${uid}-block`;
  blockSelect.setAttribute("aria-describedby", `${uid}-title`);
  for (const block of blocks) {
    const option = document.createElement("option");
    option.value = block.id;
    option.textContent = `${block.label} (${block.count})`;
    blockSelect.append(option);
  }
  blockWrap.append(blockLabel, blockSelect);

  const searchWrap = el("div", "cm-control");
  const searchLabel = el("label", "cm-field-label", "Find a glyph");
  searchLabel.htmlFor = `${uid}-search`;
  const searchRow = el("div", "cm-search-row");
  const searchInput = document.createElement("input");
  searchInput.className = "cm-search";
  searchInput.id = `${uid}-search`;
  searchInput.type = "search";
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchInput.placeholder = "Name, U+03B1, 128512 or the glyph";
  searchInput.setAttribute("aria-describedby", `${uid}-hint`);
  const clearSearch = el("button", "cm-clear-search", "Clear");
  clearSearch.type = "button";
  clearSearch.hidden = true;
  searchRow.append(searchInput, clearSearch);
  searchWrap.append(searchLabel, searchRow);
  controls.append(blockWrap, searchWrap);
  head.append(heading, controls);

  const main = el("div", "cm-main");
  const results = el("section", "cm-results");
  results.setAttribute("aria-label", "Glyph results");
  const resultsHead = el("div", "cm-results-head");
  const resultLabel = el("h3", "cm-result-label", blocks[0].label);
  resultLabel.id = `${uid}-result-label`;
  const resultCount = el("span", "cm-result-count", "");
  resultsHead.append(resultLabel, resultCount);
  const blockMeta = el("p", "cm-block-meta", blocks[0].range);
  const grid = el("div", "cm-grid");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Glyph grid");
  grid.setAttribute("aria-describedby", resultLabel.id);
  const empty = el("p", "cm-empty", "No matches. Try a glyph name, a U+ code, a decimal codepoint or the glyph itself.");
  empty.hidden = true;
  const truncated = el("p", "cm-truncated", "");
  truncated.hidden = true;
  results.append(resultsHead, blockMeta, grid, empty, truncated);

  const detail = el("aside", "cm-detail");
  detail.setAttribute("aria-label", "Selected glyph");
  const detailEmpty = el("p", "cm-detail-empty", "Select a glyph to see its code.");
  const detailBody = el("div", "cm-detail-body");
  detailBody.hidden = true;
  const detailGlyph = el("div", "cm-detail-glyph");
  detailGlyph.setAttribute("aria-hidden", "true");
  const detailName = el("p", "cm-detail-name", "");
  const facts = el("dl", "cm-detail-facts");
  const factRows = [];
  for (const [term, className] of [
    ["Code", "cm-detail-code"],
    ["Decimal", "cm-detail-decimal"],
    ["Block", "cm-detail-block"],
  ]) {
    const row = el("div", "cm-fact");
    const value = el("dd", className, "");
    row.append(el("dt", "cm-fact-term", term), value);
    facts.append(row);
    factRows.push(value);
  }
  const [detailCode, detailDecimal, detailBlock] = factRows;
  const codeLabel = el("label", "cm-field-label", "Copyable character code");
  codeLabel.htmlFor = `${uid}-code-field`;
  const codeField = document.createElement("input");
  codeField.className = "cm-code-field";
  codeField.id = `${uid}-code-field`;
  codeField.type = "text";
  codeField.readOnly = true;
  codeField.spellcheck = false;
  codeField.dir = "ltr";
  const copyCode = el("button", "cm-copy-code", "Copy code");
  copyCode.type = "button";
  detailBody.append(detailGlyph, detailName, facts, codeLabel, codeField, copyCode);
  detail.append(detailEmpty, detailBody);
  main.append(results, detail);

  const hint = el("p", "cm-hint", "Arrow keys move between glyphs; Home and End jump to the ends; Enter or Space selects. Tab moves between controls.");
  hint.id = `${uid}-hint`;
  const status = el("p", "cm-status", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  root.append(head, main, hint, status);
  container.replaceChildren(root);

  function announce(message) {
    status.textContent = message || "";
  }

  function renderGrid() {
    grid.replaceChildren();
    glyphsByHex.clear();
    const fragment = document.createDocumentFragment();
    for (const glyph of currentGlyphs) {
      const button = el("button", "cm-glyph", glyph.char);
      button.type = "button";
      button.dataset.code = glyph.hex;
      button.setAttribute("aria-label", labelFor(glyph));
      button.setAttribute("aria-pressed", String(Boolean(selected) && selected.code === glyph.code));
      glyphsByHex.set(glyph.hex, glyph);
      fragment.append(button);
    }
    grid.append(fragment);
  }

  function renderResults() {
    if (disposed) return;
    clearSearch.hidden = searchInput.value.length === 0;
    const query = searchInput.value.trim();
    if (query) {
      const report = searchCatalog(query);
      currentGlyphs = report.results;
      resultLabel.textContent = `Search: ${report.query}`;
      resultCount.textContent = `${report.totalMatches} match${report.totalMatches === 1 ? "" : "es"}`;
      blockMeta.textContent = "Searches every block by name or codepoint";
      empty.hidden = report.results.length > 0;
      truncated.hidden = !report.truncated;
      if (report.truncated) {
        truncated.textContent = `Showing the first ${report.results.length} of ${report.totalMatches} matches.`;
      }
      announce(report.results.length
        ? `${report.totalMatches} matches for ${report.query}.`
        : "No matches. Try a glyph name, a U+ code, a decimal codepoint or the glyph itself.");
    } else {
      const block = getBlock(blockSelect.value) || blocks[0];
      currentGlyphs = glyphsInBlock(block.id) || [];
      resultLabel.textContent = block.label;
      resultCount.textContent = `${block.count} glyphs`;
      blockMeta.textContent = block.range;
      empty.hidden = true;
      truncated.hidden = true;
      announce("");
    }
    renderGrid();
  }

  function selectGlyph(glyph) {
    if (disposed || !glyph) return;
    selected = glyph;
    detailGlyph.textContent = glyph.char;
    detailName.textContent = glyph.name;
    detailCode.textContent = glyph.hex;
    detailDecimal.textContent = String(glyph.code);
    detailBlock.textContent = getBlock(glyph.blockId)?.label || glyph.blockId;
    codeField.value = glyph.hex;
    detailEmpty.hidden = true;
    detailBody.hidden = false;
    for (const button of grid.querySelectorAll(".cm-glyph")) {
      button.setAttribute("aria-pressed", String(button.dataset.code === glyph.hex));
    }
    announce(`${labelFor(glyph)} selected.`);
  }

  async function copySelectedCode() {
    if (disposed || !selected) return;
    const sequence = ++copySequence;
    const text = selected.hex;
    let copied = false;
    try {
      const clipboard = navigator.clipboard;
      if (clipboard && typeof clipboard.writeText === "function") {
        await clipboard.writeText(text);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (disposed || sequence !== copySequence) return;
    if (copied) {
      announce(`Copied ${text} to clipboard.`);
      return;
    }
    // The clipboard is unavailable or refused: select the text and say so.
    // Never claim a copy that did not happen.
    codeField.value = text;
    codeField.focus({ preventScroll: true });
    codeField.select();
    announce(`Clipboard copy is unavailable here. ${text} is selected — press Ctrl+C (Command+C on Mac) to copy.`);
  }

  function onClick(event) {
    if (disposed || !(event.target instanceof Element)) return;
    const glyphButton = event.target.closest(".cm-glyph");
    if (glyphButton && grid.contains(glyphButton)) {
      selectGlyph(glyphsByHex.get(glyphButton.dataset.code));
      return;
    }
    if (event.target.closest(".cm-clear-search")) {
      searchInput.value = "";
      renderResults();
      searchInput.focus({ preventScroll: true });
      announce("Search cleared.");
      return;
    }
    if (event.target.closest(".cm-copy-code")) {
      void copySelectedCode();
    }
  }

  function onInput(event) {
    if (event.target === searchInput) renderResults();
  }

  function onChange(event) {
    if (event.target !== blockSelect) return;
    searchInput.value = "";
    renderResults();
    announce(`${getBlock(blockSelect.value)?.label || "Block"} selected.`);
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest(".cm-glyph");
    if (!button || !grid.contains(button)) return;
    const handled = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!handled.includes(event.key) || !grid.firstElementChild) return;

    const buttons = Array.from(grid.querySelectorAll(".cm-glyph"));
    let index = buttons.indexOf(button);
    if (index < 0) return;
    const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").length);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = buttons.length - 1;
    else if (event.key === "ArrowLeft") index = Math.max(0, index - 1);
    else if (event.key === "ArrowRight") index = Math.min(buttons.length - 1, index + 1);
    else if (event.key === "ArrowUp") index = Math.max(0, index - columns);
    else index = Math.min(buttons.length - 1, index + columns);
    event.preventDefault();
    buttons[index].focus({ preventScroll: false });
  }

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("keydown", onKeyDown);
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    copySequence += 1;
    signal?.removeEventListener?.("abort", onAbort);
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onInput);
    root.removeEventListener("change", onChange);
    root.removeEventListener("keydown", onKeyDown);
    root.remove();
  }

  renderResults();

  return {
    canClose: () => true,
    focus() {
      try { searchInput.focus({ preventScroll: true }); } catch { searchInput.focus(); }
    },
    dispose,
  };
}

export default { mount };
