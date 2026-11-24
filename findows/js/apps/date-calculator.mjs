/* Date Calculator UI: an accessible surface over the pure calendar engine.
   Dates are typed as local calendar dates; no network, no eval, no global
   listeners and no untrusted markup. Keyboard events use native controls. */
import {
  addDays,
  daysBetween,
  parseLocalDate,
  shiftDate,
  todayLocalDate,
} from "./date-calculator-engine.mjs";

const MODES = new Set(["between", "shift"]);
const UNITS = new Set(["days", "months"]);
const DIRECTIONS = new Set(["add", "subtract"]);

let instanceCount = 0;

const shortDate = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", year: "numeric",
});
const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long", month: "long", day: "numeric", year: "numeric",
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className, label, dataset = {}) {
  const node = el("button", className, label);
  node.type = "button";
  for (const [key, value] of Object.entries(dataset)) node.dataset[key] = value;
  return node;
}

function asCalendarDate(iso) {
  const parsed = parseLocalDate(iso);
  return new Date(parsed.year, parsed.month - 1, parsed.day);
}

function readable(formatter, iso) {
  try {
    return formatter.format(asCalendarDate(iso));
  } catch {
    return iso;
  }
}

function attempt(work) {
  try {
    return { ok: true, value: work() };
  } catch (error) {
    return { ok: false, message: error?.message || "That date cannot be used." };
  }
}

export async function mount({ container, windowId, fileId, mode, draftId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Date calculator needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Date calculator window was closed while loading", "AbortError");
  }

  const uid = `datecalc-${++instanceCount}`;
  let activeMode = MODES.has(mode) ? mode : "between";
  let disposed = false;

  const root = el("div", "datecalc-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Date calculator");

  const switcher = el("div", "datecalc-switch");
  switcher.setAttribute("role", "group");
  switcher.setAttribute("aria-label", "Date calculator modes");
  const tabs = new Map();
  for (const [value, label] of [["between", "Days between"], ["shift", "Add or subtract"]]) {
    const tab = button("datecalc-tab", label, { mode: value });
    tab.setAttribute("aria-pressed", "false");
    tabs.set(value, tab);
    switcher.append(tab);
  }

  const panels = new Map();
  function panel(name, title) {
    const section = el("section", `datecalc-panel datecalc-panel-${name}`);
    section.dataset.panel = name;
    section.setAttribute("aria-label", `${title} panel`);
    const heading = el("h1", "datecalc-panel-title", title);
    heading.tabIndex = -1;
    heading.id = `${uid}-${name}-title`;
    section.append(heading);
    panels.set(name, section);
    return section;
  }

  const betweenPanel = panel("between", "Days between dates");
  const betweenGrid = el("div", "datecalc-fieldgrid datecalc-fieldgrid-between");
  betweenGrid.setAttribute("role", "group");
  betweenGrid.setAttribute("aria-label", "Start and end dates");

  function dateField(label, field) {
    const wrapper = el("label", "datecalc-field");
    wrapper.append(el("span", "datecalc-field-label", label));
    const input = el("input", "datecalc-input datecalc-date");
    input.type = "date";
    input.dataset.field = field;
    input.setAttribute("aria-describedby", `${uid}-hint`);
    wrapper.append(input);
    return { wrapper, input };
  }

  const fromField = dateField("From", "from");
  const toField = dateField("To", "to");
  const swap = button("datecalc-swap", "⇅", { action: "swap" });
  swap.setAttribute("aria-label", "Swap the two dates");
  swap.setAttribute("aria-keyshortcuts", "Enter Space");
  betweenGrid.append(fromField.wrapper, swap, toField.wrapper);

  const presets = el("div", "datecalc-presets");
  presets.setAttribute("role", "group");
  presets.setAttribute("aria-label", "Quick date ranges");
  for (const [preset, label] of [
    ["next30", "Next 30 days"],
    ["last30", "Last 30 days"],
    ["year", "This year"],
  ]) {
    presets.append(button("datecalc-preset", label, { preset }));
  }

  const betweenValidation = el("p", "datecalc-validation");
  betweenValidation.setAttribute("role", "alert");
  betweenValidation.setAttribute("aria-live", "assertive");
  betweenValidation.hidden = true;

  const spanResult = el("div", "datecalc-result datecalc-result-span");
  const spanFigure = el("div", "datecalc-figure");
  const spanValue = el("output", "datecalc-span-value", "—");
  spanValue.setAttribute("aria-label", "Number of days between the dates");
  const spanUnit = el("span", "datecalc-span-unit", "days");
  spanFigure.append(spanValue, spanUnit);
  const spanDetail = el("p", "datecalc-span-detail", "Enter two dates to see the gap.");
  spanResult.append(spanFigure, spanDetail);
  betweenPanel.append(betweenGrid, presets, betweenValidation, spanResult);

  const shiftPanel = panel("shift", "Add or subtract dates");
  const shiftGrid = el("div", "datecalc-fieldgrid datecalc-fieldgrid-shift");
  shiftGrid.setAttribute("role", "group");
  shiftGrid.setAttribute("aria-label", "Starting date, amount and unit");
  const startField = dateField("Starting date", "date");
  const amountField = el("label", "datecalc-field");
  amountField.append(el("span", "datecalc-field-label", "Amount"));
  const amountInput = el("input", "datecalc-input datecalc-amount");
  amountInput.type = "number";
  amountInput.inputMode = "numeric";
  amountInput.min = "0";
  amountInput.step = "1";
  amountInput.value = "30";
  amountInput.dataset.field = "amount";
  amountInput.setAttribute("aria-describedby", `${uid}-hint`);
  amountField.append(amountInput);
  const unitField = el("label", "datecalc-field");
  unitField.append(el("span", "datecalc-field-label", "Unit"));
  const unitInput = el("select", "datecalc-input datecalc-unit");
  unitInput.dataset.field = "unit";
  for (const [value, label] of [["days", "Days"], ["months", "Months"]]) {
    const option = el("option", "", label);
    option.value = value;
    unitInput.append(option);
  }
  unitField.append(unitInput);
  shiftGrid.append(startField.wrapper, amountField, unitField);

  const directions = el("div", "datecalc-directions");
  directions.setAttribute("role", "group");
  directions.setAttribute("aria-label", "Direction");
  for (const [value, label] of [["add", "Add"], ["subtract", "Subtract"]]) {
    const direction = button("datecalc-direction", label, { direction: value });
    direction.setAttribute("aria-pressed", "false");
    directions.append(direction);
  }
  const todayButton = button("datecalc-today", "Use today", { action: "today" });

  const shiftValidation = el("p", "datecalc-validation");
  shiftValidation.setAttribute("role", "alert");
  shiftValidation.setAttribute("aria-live", "assertive");
  shiftValidation.hidden = true;

  const dateResult = el("div", "datecalc-result datecalc-result-date");
  const dateValue = el("output", "datecalc-date-value", "—");
  dateValue.setAttribute("aria-label", "Resulting date");
  const dateCaption = el("span", "datecalc-date-caption", "Resulting date");
  const dateDetail = el("p", "datecalc-date-detail", "Enter a date and an amount.");
  dateResult.append(dateCaption, dateValue, dateDetail);
  shiftPanel.append(shiftGrid, directions, todayButton, shiftValidation, dateResult);

  const hint = el("p", "datecalc-hint", "Dates follow your device calendar. Month shifts keep the last valid day of the month. Nothing is sent anywhere.");
  hint.id = `${uid}-hint`;
  const status = el("p", "datecalc-sr-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  root.append(switcher, betweenPanel, shiftPanel, hint, status);
  container.replaceChildren(root);

  const today = todayLocalDate();
  fromField.input.value = today;
  toField.input.value = addDays(today, 30);
  startField.input.value = today;

  function announce(message) {
    status.textContent = message;
  }

  function setMode(next) {
    if (!MODES.has(next) || disposed) return;
    activeMode = next;
    for (const [value, tab] of tabs) {
      const active = value === next;
      tab.setAttribute("aria-pressed", String(active));
      tab.classList.toggle("is-active", active);
    }
    for (const [value, section] of panels) section.hidden = value !== next;
  }

  function showError(validation, field, message) {
    validation.hidden = false;
    validation.textContent = message;
    if (field) field.setAttribute("aria-invalid", "true");
  }

  function renderBetween() {
    betweenValidation.hidden = true;
    betweenValidation.textContent = "";
    fromField.input.removeAttribute("aria-invalid");
    toField.input.removeAttribute("aria-invalid");

    const from = fromField.input.value;
    const to = toField.input.value;
    const fromParsed = parseLocalDate(from);
    const toParsed = parseLocalDate(to);
    if (!fromParsed.ok || !toParsed.ok) {
      spanValue.textContent = "—";
      spanDetail.textContent = "Enter two valid dates to see the gap.";
      showError(betweenValidation,
        fromParsed.ok ? toField.input : fromField.input,
        (fromParsed.ok ? toParsed : fromParsed).message);
      return;
    }

    const outcome = attempt(() => daysBetween(from, to));
    if (!outcome.ok) {
      spanValue.textContent = "—";
      spanDetail.textContent = "Enter two valid dates to see the gap.";
      showError(betweenValidation, null, outcome.message);
      return;
    }
    const days = outcome.value;
    spanValue.textContent = String(days);
    spanUnit.textContent = days === 1 || days === -1 ? "day" : "days";
    spanDetail.textContent = `${readable(shortDate, from)} → ${readable(shortDate, to)}`;
  }

  function readAmount() {
    const raw = amountInput.value.trim();
    if (raw === "") return NaN;
    return Number(raw);
  }

  function renderShift() {
    shiftValidation.hidden = true;
    shiftValidation.textContent = "";
    startField.input.removeAttribute("aria-invalid");
    amountInput.removeAttribute("aria-invalid");

    const start = startField.input.value;
    const parsed = parseLocalDate(start);
    const amount = readAmount();
    if (!parsed.ok) {
      dateValue.textContent = "—";
      dateDetail.textContent = "Enter a valid starting date.";
      showError(shiftValidation, startField.input, parsed.message);
      return;
    }
    if (!Number.isInteger(amount) || amount < 0) {
      dateValue.textContent = "—";
      dateDetail.textContent = "Enter a whole amount of zero or more.";
      showError(shiftValidation, amountInput, "Amount must be a whole number from 0 or more.");
      return;
    }
    const unit = UNITS.has(unitInput.value) ? unitInput.value : "days";
    const activeDirection = directions.querySelector(".datecalc-direction[aria-pressed='true']");
    const direction = DIRECTIONS.has(activeDirection?.dataset.direction)
      ? activeDirection.dataset.direction
      : "add";
    const signed = direction === "subtract" ? -amount : amount;
    const outcome = attempt(() => shiftDate(start, signed, unit));
    if (!outcome.ok) {
      dateValue.textContent = "—";
      dateDetail.textContent = "That date is outside the supported range.";
      showError(shiftValidation, null, outcome.message);
      return;
    }
    dateValue.textContent = outcome.value;
    dateDetail.textContent = readable(longDate, outcome.value);
  }

  function render() {
    renderBetween();
    renderShift();
  }

  function onClick(event) {
    if (disposed || !(event.target instanceof Element)) return;
    const target = event.target;
    const tab = target.closest(".datecalc-tab[data-mode]");
    if (tab && root.contains(tab)) {
      setMode(tab.dataset.mode);
      return;
    }
    const preset = target.closest(".datecalc-preset[data-preset]");
    if (preset && root.contains(preset)) {
      const now = todayLocalDate();
      const year = now.slice(0, 4);
      const ranges = {
        next30: [now, addDays(now, 30)],
        last30: [addDays(now, -30), now],
        year: [`${year}-01-01`, `${year}-12-31`],
      };
      const range = ranges[preset.dataset.preset];
      if (range) {
        fromField.input.value = range[0];
        toField.input.value = range[1];
        setMode("between");
        renderBetween();
        announce("Date range updated.");
      }
      return;
    }
    if (target.closest(".datecalc-swap") && root.contains(swap)) {
      const previous = fromField.input.value;
      fromField.input.value = toField.input.value;
      toField.input.value = previous;
      renderBetween();
      announce("Dates swapped.");
      return;
    }
    const direction = target.closest(".datecalc-direction[data-direction]");
    if (direction && root.contains(direction)) {
      for (const node of directions.querySelectorAll(".datecalc-direction")) {
        const active = node === direction;
        node.setAttribute("aria-pressed", String(active));
        node.classList.toggle("is-active", active);
      }
      renderShift();
      announce(`Direction set to ${direction.dataset.direction}.`);
      return;
    }
    if (target.closest(".datecalc-today") && root.contains(todayButton)) {
      startField.input.value = todayLocalDate();
      renderShift();
      announce("Starting date set to today.");
    }
  }

  function onFieldChange(event) {
    if (disposed || !(event.target instanceof Element)) return;
    const panel = event.target.closest("[data-panel]");
    if (!panel || !root.contains(panel)) return;
    if (panel.dataset.panel === "between") renderBetween();
    else renderShift();
  }

  root.addEventListener("click", onClick);
  root.addEventListener("input", onFieldChange);
  root.addEventListener("change", onFieldChange);
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    root.removeEventListener("click", onClick);
    root.removeEventListener("input", onFieldChange);
    root.removeEventListener("change", onFieldChange);
    root.remove();
  }

  setMode(activeMode);
  render();

  return {
    canClose: () => true,
    focus() {
      const heading = panels.get(activeMode)?.querySelector(".datecalc-panel-title");
      try { heading?.focus({ preventScroll: true }); } catch { heading?.focus(); }
    },
    dispose,
  };
}

export default { mount };
