/* Calculator UI: an accessible standard-mode surface over the pure engine.
   No global listeners, no eval, no untrusted markup. Keyboard events are handled
   only while focus is inside this app; native buttons keep Tab/Enter/Space. */
import { createCalculator } from "./calculator-engine.mjs";

const KEY_TOKENS = Object.freeze({
  "+": "+",
  "-": "-",
  "*": "*",
  "/": "/",
  "=": "=",
  ".": ".",
  Enter: "=",
  Backspace: "backspace",
  Delete: "CE",
  Escape: "C",
  F9: "sign",
});

const OPERATORS = new Set(["+", "-", "*", "/"]);

const KEYS = Object.freeze([
  { token: "C", glyph: "C", name: "Clear all", kind: "action", shortcut: "Escape" },
  { token: "CE", glyph: "CE", name: "Clear entry", kind: "action", shortcut: "Delete" },
  { token: "backspace", glyph: "⌫", name: "Backspace", kind: "action", shortcut: "Backspace" },
  { token: "/", glyph: "÷", name: "Divide", kind: "operator", shortcut: "/" },
  { token: "7", glyph: "7", name: "Seven" },
  { token: "8", glyph: "8", name: "Eight" },
  { token: "9", glyph: "9", name: "Nine" },
  { token: "*", glyph: "×", name: "Multiply", kind: "operator", shortcut: "*" },
  { token: "4", glyph: "4", name: "Four" },
  { token: "5", glyph: "5", name: "Five" },
  { token: "6", glyph: "6", name: "Six" },
  { token: "-", glyph: "−", name: "Subtract", kind: "operator", shortcut: "-" },
  { token: "1", glyph: "1", name: "One" },
  { token: "2", glyph: "2", name: "Two" },
  { token: "3", glyph: "3", name: "Three" },
  { token: "+", glyph: "+", name: "Add", kind: "operator", shortcut: "+" },
  { token: "sign", glyph: "±", name: "Change sign", kind: "action", shortcut: "F9" },
  { token: "0", glyph: "0", name: "Zero" },
  { token: ".", glyph: ".", name: "Decimal point", kind: "action", shortcut: "." },
  { token: "=", glyph: "=", name: "Equals", kind: "equals", shortcut: "Enter =" },
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
    throw new TypeError("Calculator needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Calculator window was closed while loading", "AbortError");
  }

  const calc = createCalculator();
  const uid = `calc-${++instanceCount}`;
  let disposed = false;

  const root = el("div", "calc-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Calculator");

  const screen = el("div", "calc-screen");
  const expression = el("div", "calc-expression");
  expression.setAttribute("aria-hidden", "true");

  const display = document.createElement("output");
  display.className = "calc-display";
  display.tabIndex = 0;
  display.setAttribute("aria-label", "Calculator display");
  display.setAttribute("aria-describedby", `${uid}-hint`);
  display.setAttribute("dir", "ltr");

  const errorBox = el("div", "calc-error");
  errorBox.setAttribute("role", "alert");
  errorBox.setAttribute("aria-live", "assertive");
  errorBox.setAttribute("aria-atomic", "true");
  errorBox.hidden = true;
  screen.append(expression, display, errorBox);

  const body = el("div", "calc-body");
  const keypad = el("div", "calc-keypad");
  keypad.setAttribute("role", "group");
  keypad.setAttribute("aria-label", "Calculator keypad");

  const keyButtons = [];
  for (const key of KEYS) {
    const button = el("button", "calc-key", key.glyph);
    button.type = "button";
    button.dataset.token = key.token;
    button.dataset.kind = key.kind || "digit";
    button.setAttribute("aria-label", key.name);
    if (key.shortcut) button.setAttribute("aria-keyshortcuts", key.shortcut);
    if (OPERATORS.has(key.token)) button.setAttribute("aria-pressed", "false");
    keypad.append(button);
    keyButtons.push(button);
  }

  const history = el("section", "calc-history");
  const head = el("div", "calc-history-head");
  const title = el("h2", "calc-history-title", "History");
  title.id = `${uid}-history-title`;
  const clearHistory = el("button", "calc-clear-history", "Clear history");
  clearHistory.type = "button";
  head.append(title, clearHistory);

  const historyList = el("ol", "calc-history-list");
  historyList.setAttribute("aria-label", "Calculation history, newest first");
  const emptyItem = el("li", "calc-history-empty", "No calculations yet.");
  historyList.append(emptyItem);

  const hint = el("p", "calc-hint", "Type digits and + − × ÷, Enter or = for equals, Backspace to edit, Delete for CE, Escape to clear, F9 for sign. Tab moves between controls.");
  hint.id = `${uid}-hint`;
  history.append(head, historyList, hint);

  body.append(keypad, history);

  const status = el("p", "calc-sr-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  root.append(screen, body, status);
  container.replaceChildren(root);

  function renderHistory(entries) {
    historyList.replaceChildren();
    if (!entries.length) {
      historyList.append(emptyItem);
      return;
    }
    for (const entry of entries) {
      const item = el("li", "calc-history-item");
      item.append(el("span", "calc-history-expression", `${entry.expression} =`));
      const result = document.createElement("output");
      result.className = "calc-history-result";
      result.textContent = entry.result;
      item.append(result);
      historyList.append(item);
    }
  }

  function render(state, announcement) {
    display.textContent = state.display;
    display.dataset.length = state.display.length > 12 ? "very-long" : state.display.length > 9 ? "long" : "normal";
    expression.textContent = state.expression ||
      (state.error ? "Clear to start again" : "Standard calculator");

    if (state.error) {
      errorBox.textContent = state.error.message;
      errorBox.hidden = false;
    } else {
      errorBox.textContent = "";
      errorBox.hidden = true;
    }
    if (announcement) status.textContent = announcement;

    for (const button of keyButtons) {
      const token = button.dataset.token;
      if (!OPERATORS.has(token)) continue;
      const active = state.pendingOperator === token;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
    }
    renderHistory(state.history);
  }

  function pressToken(token) {
    const before = calc.getState();
    const state = calc.press(token);
    let announcement = "";
    if (token === "=" && !state.error && state.history.length > before.history.length) {
      announcement = `${state.expression} equals ${state.display}.`;
    }
    render(state, announcement);
  }

  function onKeypadClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button[data-token]") : null;
    if (!button || !keypad.contains(button)) return;
    pressToken(button.dataset.token);
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const target = event.target;
    if (target instanceof Element) {
      if (target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
      // Enter/Space belong to the focused native button, not to the calculator.
      if ((event.key === "Enter" || event.key === " ") && target.closest("button")) return;
    }

    const token = /^[0-9]$/.test(event.key) ? event.key : KEY_TOKENS[event.key];
    if (!token) return;
    event.preventDefault();
    pressToken(token);
  }

  function onClearHistory() {
    calc.clearHistory();
    render(calc.getState(), "History cleared.");
  }

  keypad.addEventListener("click", onKeypadClick);
  root.addEventListener("keydown", onKeyDown);
  clearHistory.addEventListener("click", onClearHistory);
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    keypad.removeEventListener("click", onKeypadClick);
    root.removeEventListener("keydown", onKeyDown);
    clearHistory.removeEventListener("click", onClearHistory);
    root.remove();
  }

  render(calc.getState());

  return {
    canClose: () => true,
    focus() {
      try { display.focus({ preventScroll: true }); } catch { display.focus(); }
    },
    dispose,
  };
}

export default { mount };
