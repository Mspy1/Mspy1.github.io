/* Color Tools UI: an accessible colour converter, harmony picker and WCAG
   contrast checker over the pure engine. No global listeners, no eval, no
   untrusted markup, no network. Keyboard handling stays inside this surface. */
import {
  ColorError,
  describeColor,
  formatHex,
  formatRgb,
  formatHsl,
  contrastRatio,
  wcagLevels,
  harmonies,
  HARMONY_KINDS,
} from "./color-tools-engine.mjs";

const DEFAULT_COLOR = "#336699";
const DEFAULT_KIND = "complementary";
const DEFAULT_FG = "#000000";
const DEFAULT_BG = "#ffffff";

const BADGES = Object.freeze([
  { key: "normalAA", level: "aa", label: "AA text" },
  { key: "normalAAA", level: "aaa", label: "AAA text" },
  { key: "largeAA", level: "aa-large", label: "AA large" },
  { key: "largeAAA", level: "aaa-large", label: "AAA large" },
]);

let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Color Tools needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Color Tools window was closed while loading", "AbortError");
  }

  const uid = `ct-${++instanceCount}`;
  let disposed = false;
  let base = describeColor(DEFAULT_COLOR).hex;
  let kind = DEFAULT_KIND;
  let fg = describeColor(DEFAULT_FG).hex;
  let bg = describeColor(DEFAULT_BG).hex;
  let ratioText = "0.00";
  let levelText = "Fail";

  const root = el("div", "ct-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Color Tools");

  const head = el("header", "ct-head");
  const heading = el("div", "ct-heading");
  const title = el("h1", "ct-title", "Color Tools");
  title.id = `${uid}-title`;
  const subtitle = el("p", "ct-subtitle", "Convert, harmonise and check contrast. Everything happens on this device.");
  heading.append(title, subtitle);
  head.append(heading, el("span", "ct-local", "Local only"));

  const stage = el("div", "ct-stage");

  /* ---- Colour editor ---------------------------------------------------- */
  const editor = el("section", "ct-panel ct-editor");
  editor.setAttribute("aria-labelledby", `${uid}-editor-title`);
  const editorTitle = el("h2", "ct-panel-title", "Colour");
  editorTitle.id = `${uid}-editor-title`;

  const field = el("div", "ct-field");
  const inputLabel = el("label", "ct-label", "Hex, rgb() or hsl()");
  inputLabel.htmlFor = `${uid}-color`;
  const colorInput = el("input", "ct-color-input");
  colorInput.id = `${uid}-color`;
  colorInput.type = "text";
  colorInput.value = base;
  colorInput.spellcheck = false;
  colorInput.autocomplete = "off";
  colorInput.setAttribute("dir", "ltr");
  colorInput.setAttribute("aria-describedby", `${uid}-error ${uid}-hint`);
  const apply = el("button", "ct-apply", "Apply");
  apply.type = "button";
  field.append(inputLabel, colorInput, apply);

  const errorBox = el("p", "ct-error");
  errorBox.id = `${uid}-error`;
  errorBox.setAttribute("role", "alert");
  errorBox.setAttribute("aria-live", "assertive");
  errorBox.setAttribute("aria-atomic", "true");
  errorBox.hidden = true;

  const preview = el("div", "ct-preview");
  const previewHex = el("span", "ct-preview-hex", base);
  const previewNote = el("span", "ct-preview-note", "Live preview");
  const previewInner = el("div", "ct-preview-inner");
  previewInner.append(previewHex, previewNote);
  preview.append(previewInner);

  const formats = el("div", "ct-formats");
  const formatNodes = {};
  for (const format of ["hex", "rgb", "hsl"]) {
    const card = el("section", "ct-format");
    card.dataset.format = format;
    const name = el("h3", "ct-format-name", format.toUpperCase());
    const value = document.createElement("output");
    value.className = "ct-format-value";
    value.textContent = "";
    value.id = `${uid}-${format}`;
    const copy = el("button", "ct-copy", "Copy");
    copy.type = "button";
    copy.dataset.format = format;
    copy.setAttribute("aria-label", `Copy ${format.toUpperCase()} value`);
    card.append(name, value, copy);
    formats.append(card);
    formatNodes[format] = { card, value, copy };
  }
  editor.append(editorTitle, field, errorBox, preview, formats);

  /* ---- Harmonies -------------------------------------------------------- */
  const harmonyPanel = el("section", "ct-panel ct-harmony-panel");
  harmonyPanel.setAttribute("aria-labelledby", `${uid}-harmony-title`);
  const harmonyTitle = el("h2", "ct-panel-title", "Harmonies");
  harmonyTitle.id = `${uid}-harmony-title`;
  const schemeLabel = el("label", "ct-label", "Scheme");
  schemeLabel.htmlFor = `${uid}-harmony`;
  const harmonySelect = el("select", "ct-harmony-select");
  harmonySelect.id = `${uid}-harmony`;
  for (const definition of HARMONY_KINDS) {
    const option = el("option", null, definition.label);
    option.value = definition.id;
    harmonySelect.append(option);
  }
  harmonySelect.value = kind;
  const harmonyDesc = el("p", "ct-harmony-desc");
  const swatches = el("div", "ct-swatches");
  swatches.setAttribute("role", "group");
  swatches.setAttribute("aria-label", "Harmony colours");
  harmonyPanel.append(harmonyTitle, schemeLabel, harmonySelect, harmonyDesc, swatches);

  /* ---- WCAG contrast ---------------------------------------------------- */
  const contrast = el("section", "ct-panel ct-contrast");
  contrast.setAttribute("aria-labelledby", `${uid}-contrast-title`);
  const contrastTitle = el("h2", "ct-panel-title", "WCAG contrast");
  contrastTitle.id = `${uid}-contrast-title`;

  const contrastRow = el("div", "ct-contrast-row");
  const fgLabel = el("label", "ct-label", "Foreground");
  fgLabel.htmlFor = `${uid}-fg`;
  const fgInput = el("input", "ct-fg-input");
  fgInput.id = `${uid}-fg`;
  fgInput.type = "text";
  fgInput.value = DEFAULT_FG;
  fgInput.spellcheck = false;
  fgInput.autocomplete = "off";
  fgInput.setAttribute("dir", "ltr");
  const swap = el("button", "ct-swap", "⇄");
  swap.type = "button";
  swap.setAttribute("aria-label", "Swap foreground and background colours");
  swap.title = "Swap colours";
  const bgLabel = el("label", "ct-label", "Background");
  bgLabel.htmlFor = `${uid}-bg`;
  const bgInput = el("input", "ct-bg-input");
  bgInput.id = `${uid}-bg`;
  bgInput.type = "text";
  bgInput.value = DEFAULT_BG;
  bgInput.spellcheck = false;
  bgInput.autocomplete = "off";
  bgInput.setAttribute("dir", "ltr");
  const fgField = el("div", "ct-contrast-field");
  fgField.append(fgLabel, fgInput);
  const bgField = el("div", "ct-contrast-field");
  bgField.append(bgLabel, bgInput);
  contrastRow.append(fgField, swap, bgField);

  const contrastError = el("p", "ct-contrast-error");
  contrastError.setAttribute("role", "alert");
  contrastError.setAttribute("aria-live", "assertive");
  contrastError.hidden = true;

  const result = el("div", "ct-result");
  const ratio = document.createElement("output");
  ratio.className = "ct-ratio";
  ratio.textContent = ratioText;
  ratio.setAttribute("aria-label", "Contrast ratio");
  const ratioUnit = el("span", "ct-ratio-unit", ":1");
  const level = el("span", "ct-level", levelText);
  result.append(ratio, ratioUnit, level);

  const badges = el("div", "ct-badges");
  const badgeNodes = [];
  for (const badge of BADGES) {
    const chip = el("span", "ct-badge", badge.label);
    chip.dataset.level = badge.level;
    chip.dataset.pass = "false";
    badges.append(chip);
    badgeNodes.push({ key: badge.key, node: chip });
  }
  const contrastNote = el("p", "ct-contrast-note",
    "Normal text needs 4.5:1 for AA and 7:1 for AAA. Large text needs 3:1 and 4.5:1.");

  contrast.append(contrastTitle, contrastRow, contrastError, result, badges, contrastNote);
  stage.append(editor, harmonyPanel, contrast);

  const hint = el("p", "ct-hint",
    "Tab moves between controls. Enter applies an edited colour, Escape restores the last good value.");
  hint.id = `${uid}-hint`;
  const status = el("p", "ct-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  root.append(head, stage, hint, status);
  container.replaceChildren(root);

  function setStatus(message) {
    status.textContent = message || "";
  }

  function setError(message) {
    errorBox.textContent = message || "";
    errorBox.hidden = !message;
    colorInput.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function setContrastError(message) {
    contrastError.textContent = message || "";
    contrastError.hidden = !message;
  }

  function renderFormats() {
    const described = describeColor(base);
    const values = {
      hex: described.hex,
      rgb: formatRgb(described),
      hsl: formatHsl(described.hsl),
    };
    for (const format of ["hex", "rgb", "hsl"]) {
      formatNodes[format].value.textContent = values[format];
      formatNodes[format].value.setAttribute("aria-label", `${format.toUpperCase()} value ${values[format]}`);
    }
    preview.style.backgroundColor = described.hex;
    previewHex.textContent = described.hex;
    renderHarmony(described);
  }

  function renderHarmony(described = describeColor(base)) {
    const definition = HARMONY_KINDS.find((item) => item.id === kind) || HARMONY_KINDS[0];
    harmonyDesc.textContent = definition.description;
    const colours = harmonies(described.hex, kind);
    const existing = Array.from(swatches.children);
    // Update nodes in place: a touch that blurs the colour input must not have
    // its target removed between touchstart and touchend.
    for (let index = 0; index < colours.length; index += 1) {
      const colour = colours[index];
      let button = existing[index];
      if (!button) {
        button = el("button", "ct-swatch");
        button.type = "button";
        button.append(
          el("span", "ct-swatch-chip"),
          el("span", "ct-swatch-hex"),
          el("span", "ct-swatch-label"),
        );
        swatches.append(button);
      }
      button.dataset.hex = colour.hex;
      button.setAttribute("aria-label", `${colour.label}: ${colour.hex}. Set as base colour.`);
      button.children[0].style.backgroundColor = colour.hex;
      button.children[1].textContent = colour.hex;
      button.children[2].textContent = colour.label;
    }
    while (swatches.children.length > colours.length) {
      swatches.lastElementChild.remove();
    }
  }

  function renderContrast() {
    let nextFg;
    let nextBg;
    try {
      nextFg = describeColor(fgInput.value).hex;
      nextBg = describeColor(bgInput.value).hex;
    } catch {
      return; // keep the last readable pair while the visitor types
    }
    fg = nextFg;
    bg = nextBg;
    const value = contrastRatio(fg, bg);
    const levels = wcagLevels(value);
    ratioText = value.toFixed(2);
    levelText = levels.level;
    ratio.textContent = ratioText;
    ratio.setAttribute("aria-label", `Contrast ratio ${ratioText} to 1`);
    level.textContent = levelText;
    level.dataset.level = levelText;
    for (const { key, node } of badgeNodes) {
      node.dataset.pass = String(levels[key]);
      node.setAttribute("aria-label", `${node.textContent}: ${levels[key] ? "pass" : "fail"}`);
    }
  }

  async function copyValue(format) {
    const described = describeColor(base);
    const values = {
      hex: described.hex,
      rgb: formatRgb(described),
      hsl: formatHsl(described.hsl),
    };
    const text = values[format];
    const clipboard = services && typeof services === "object" ? services.clipboard : null;
    try {
      if (clipboard && typeof clipboard.writeText === "function") {
        await clipboard.writeText(text);
      } else if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
      } else {
        setStatus("Copy is unavailable in this browser. Select the value and copy it manually.");
        return;
      }
      setStatus(`Copied ${format.toUpperCase()}: ${text}`);
    } catch {
      setStatus("The browser blocked copying. Select the value and copy it manually.");
    }
  }

  function commitBase() {
    const value = colorInput.value.trim();
    let described;
    try {
      described = describeColor(value);
    } catch (error) {
      setError(error instanceof ColorError ? error.message : "That colour could not be read.");
      setStatus("Base colour was not changed.");
      return;
    }
    base = described.hex;
    colorInput.value = base;
    setError(null);
    renderFormats();
    setStatus(`Base colour set to ${base}.`);
  }

  function onBaseInput() {
    let described;
    try {
      described = describeColor(colorInput.value.trim());
    } catch {
      return; // errors appear only on commit so intermediate typing is calm
    }
    base = described.hex;
    setError(null);
    renderFormats();
  }

  function onBaseChange() {
    try {
      describeColor(colorInput.value.trim());
      commitBase();
    } catch (error) {
      setError(error instanceof ColorError ? error.message : "That colour could not be read.");
      setStatus("Base colour was not changed.");
    }
  }

  function onHarmonyChange() {
    kind = harmonySelect.value;
    renderHarmony();
    const label = HARMONY_KINDS.find((item) => item.id === kind)?.label || kind;
    setStatus(`${label} harmony selected.`);
  }

  function onSwatchClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button.ct-swatch") : null;
    if (!button || !swatches.contains(button)) return;
    base = describeColor(button.dataset.hex).hex;
    colorInput.value = base;
    setError(null);
    renderFormats();
    setStatus(`Base colour set to ${base}.`);
  }

  function onCopyClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button.ct-copy") : null;
    if (!button || !formats.contains(button)) return;
    void copyValue(button.dataset.format);
  }

  function onContrastInput(event) {
    const input = event.target;
    try {
      describeColor(input.value.trim());
      input.removeAttribute("aria-invalid");
      setContrastError(null);
    } catch (error) {
      input.setAttribute("aria-invalid", "true");
      setContrastError(error instanceof ColorError ? error.message : "That colour could not be read.");
    }
    renderContrast();
  }

  function onSwap() {
    const previousFg = fgInput.value;
    fgInput.value = bgInput.value;
    bgInput.value = previousFg;
    fgInput.removeAttribute("aria-invalid");
    bgInput.removeAttribute("aria-invalid");
    setContrastError(null);
    renderContrast();
    setStatus("Foreground and background swapped.");
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (event.key === "Enter" && target === colorInput) {
      event.preventDefault();
      commitBase();
      return;
    }
    if (event.key === "Enter" && (target === fgInput || target === bgInput)) {
      event.preventDefault();
      setContrastError(null);
      renderContrast();
      return;
    }
    if (event.key === "Escape" && (target === colorInput || target === fgInput || target === bgInput)) {
      event.preventDefault();
      if (target === colorInput) {
        colorInput.value = base;
        setError(null);
      } else if (target === fgInput) {
        fgInput.value = fg;
        fgInput.removeAttribute("aria-invalid");
      } else {
        bgInput.value = bg;
        bgInput.removeAttribute("aria-invalid");
      }
      setContrastError(null);
      renderContrast();
    }
  }

  colorInput.addEventListener("input", onBaseInput);
  colorInput.addEventListener("change", onBaseChange);
  apply.addEventListener("click", commitBase);
  harmonySelect.addEventListener("change", onHarmonyChange);
  swatches.addEventListener("click", onSwatchClick);
  formats.addEventListener("click", onCopyClick);
  fgInput.addEventListener("input", onContrastInput);
  bgInput.addEventListener("input", onContrastInput);
  swap.addEventListener("click", onSwap);
  root.addEventListener("keydown", onKeyDown);

  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    colorInput.removeEventListener("input", onBaseInput);
    colorInput.removeEventListener("change", onBaseChange);
    apply.removeEventListener("click", commitBase);
    harmonySelect.removeEventListener("change", onHarmonyChange);
    swatches.removeEventListener("click", onSwatchClick);
    formats.removeEventListener("click", onCopyClick);
    fgInput.removeEventListener("input", onContrastInput);
    bgInput.removeEventListener("input", onContrastInput);
    swap.removeEventListener("click", onSwap);
    root.removeEventListener("keydown", onKeyDown);
    root.remove();
  }

  renderFormats();
  renderContrast();

  return Object.freeze({
    canClose: () => true,
    focus() {
      try { colorInput.focus({ preventScroll: true }); } catch { colorInput.focus(); }
    },
    dispose,
  });
}

export default { mount };
