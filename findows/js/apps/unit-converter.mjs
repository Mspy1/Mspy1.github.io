/* Unit Converter UI: an accessible surface over the pure conversion engine.
   No global listeners, no eval, no untrusted markup. Every listener is attached
   to this app's root and removed on dispose. */
import { createUnitConverter, MAX_PRECISION } from "./unit-converter-engine.mjs";

let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export async function mount({ container, windowId, mode, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Unit Converter needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Unit Converter window was closed while loading", "AbortError");
  }

  const converter = createUnitConverter();
  const uid = `uc-${++instanceCount}`;
  let disposed = false;

  const root = el("div", "uc-app");
  root.dataset.windowId = windowId || "";
  root.tabIndex = -1;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Unit Converter");

  const header = el("div", "uc-header");
  const title = el("h1", "uc-title", "Unit Converter");
  title.id = `${uid}-title`;
  const subtitle = el("p", "uc-subtitle", "Convert real values across seven categories");
  header.append(title, subtitle);

  const tabs = el("div", "uc-categories");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Conversion category");
  const categoryButtons = [];
  for (const entry of converter.getState().categories) {
    const label = entry.charAt(0).toUpperCase() + entry.slice(1);
    const button = el("button", "uc-category", label);
    button.type = "button";
    button.dataset.category = entry;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    categoryButtons.push(button);
    tabs.append(button);
  }

  const card = el("section", "uc-card");
  card.setAttribute("aria-label", "Conversion controls");

  const fields = el("div", "uc-fields");

  const valueField = el("div", "uc-field uc-value-field");
  const valueLabel = el("label", "uc-label", "Value");
  valueLabel.htmlFor = `${uid}-input`;
  const input = document.createElement("input");
  input.className = "uc-input";
  input.id = `${uid}-input`;
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("dir", "ltr");
  input.setAttribute("aria-describedby", `${uid}-hint`);
  valueField.append(valueLabel, input);

  const fromField = el("div", "uc-field");
  const fromLabel = el("label", "uc-label", "From");
  fromLabel.htmlFor = `${uid}-from`;
  const fromSelect = document.createElement("select");
  fromSelect.className = "uc-from";
  fromSelect.id = `${uid}-from`;
  fromField.append(fromLabel, fromSelect);

  const swap = el("button", "uc-swap", "⇄");
  swap.type = "button";
  swap.setAttribute("aria-label", "Swap units");
  swap.setAttribute("aria-keyshortcuts", "Alt+S");

  const toField = el("div", "uc-field");
  const toLabel = el("label", "uc-label", "To");
  toLabel.htmlFor = `${uid}-to`;
  const toSelect = document.createElement("select");
  toSelect.className = "uc-to";
  toSelect.id = `${uid}-to`;
  toField.append(toLabel, toSelect);

  fields.append(valueField, fromField, swap, toField);

  const outputRow = el("div", "uc-output");
  const resultLabel = el("span", "uc-result-label", "Result");
  const result = document.createElement("output");
  result.className = "uc-result";
  result.htmlFor = `${uid}-input`;
  result.setAttribute("aria-live", "polite");
  result.setAttribute("aria-atomic", "true");
  result.setAttribute("dir", "ltr");
  const resultUnit = el("span", "uc-result-unit");
  outputRow.append(resultLabel, result, resultUnit);

  const errorBox = el("div", "uc-error");
  errorBox.setAttribute("role", "alert");
  errorBox.setAttribute("aria-live", "assertive");
  errorBox.setAttribute("aria-atomic", "true");
  errorBox.hidden = true;

  const precisionRow = el("div", "uc-precision-row");
  const precisionLabel = el("label", "uc-label", "Decimal places");
  precisionLabel.htmlFor = `${uid}-precision`;
  const precision = document.createElement("input");
  precision.className = "uc-precision";
  precision.id = `${uid}-precision`;
  precision.type = "range";
  precision.min = "0";
  precision.max = String(MAX_PRECISION);
  precision.step = "1";
  precision.value = "6";
  const precisionValue = document.createElement("output");
  precisionValue.className = "uc-precision-value";
  precisionValue.htmlFor = `${uid}-precision`;
  precisionRow.append(precisionLabel, precision, precisionValue);

  card.append(fields, outputRow, errorBox, precisionRow);

  const hint = el("p", "uc-hint", "Type a value to convert instantly. Alt+S swaps the units. Tab moves between controls.");
  hint.id = `${uid}-hint`;

  const status = el("p", "uc-sr-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  root.append(header, tabs, card, hint, status);
  container.replaceChildren(root);

  let renderedCategory = null;

  function populateUnits(state) {
    if (renderedCategory === state.category) return;
    renderedCategory = state.category;
    const build = (target, selected) => {
      const options = state.units.map((unit) => {
        const option = document.createElement("option");
        option.value = unit.id;
        option.textContent = `${unit.label} (${unit.symbol})`;
        return option;
      });
      target.replaceChildren(...options);
      target.value = selected;
    };
    build(fromSelect, state.from);
    build(toSelect, state.to);
  }

  function render(state) {
    populateUnits(state);
    if (input.value !== state.input) input.value = state.input;
    fromSelect.value = state.from;
    toSelect.value = state.to;
    if (precision.value !== String(state.precision)) precision.value = String(state.precision);
    precisionValue.textContent = String(state.precision);

    for (const button of categoryButtons) {
      const active = button.dataset.category === state.category;
      button.setAttribute("aria-selected", String(active));
      button.classList.toggle("is-active", active);
    }

    result.textContent = state.result;
    const target = state.units.find((unit) => unit.id === state.to);
    resultUnit.textContent = target ? target.symbol : "";

    if (state.error) {
      errorBox.textContent = state.error.message;
      errorBox.hidden = false;
    } else {
      errorBox.textContent = "";
      errorBox.hidden = true;
    }
  }

  function announce(message) {
    if (!disposed) status.textContent = message;
  }

  function onClick(event) {
    if (disposed) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !root.contains(target)) return;
    const category = target.closest(".uc-category");
    if (category && root.contains(category)) {
      const state = converter.setCategory(category.dataset.category);
      render(state);
      announce(`${category.textContent} selected.`);
      return;
    }
    const swapButton = target.closest(".uc-swap");
    if (swapButton && root.contains(swapButton)) {
      const state = converter.swap();
      render(state);
      announce(`Units swapped. ${state.from} to ${state.to}.`);
    }
  }

  function onInput(event) {
    if (disposed) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target === input) {
      render(converter.setInput(input.value));
    } else if (target === precision) {
      render(converter.setPrecision(Number(precision.value)));
    }
  }

  function onChange(event) {
    if (disposed) return;
    const target = event.target;
    if (target === fromSelect) {
      render(converter.setFrom(fromSelect.value));
    } else if (target === toSelect) {
      render(converter.setTo(toSelect.value));
    }
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented || !event.altKey || event.key.toLowerCase() !== "s") return;
    if (event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
    event.preventDefault();
    const state = converter.swap();
    render(state);
    announce(`Units swapped. ${state.from} to ${state.to}.`);
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
    signal?.removeEventListener?.("abort", onAbort);
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onInput);
    root.removeEventListener("change", onChange);
    root.removeEventListener("keydown", onKeyDown);
    root.remove();
  }

  render(converter.getState());

  return {
    canClose: () => true,
    focus() {
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    },
    dispose,
  };
}

export default { mount };
