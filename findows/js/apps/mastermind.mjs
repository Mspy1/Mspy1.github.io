/* Mastermind UI: an accessible code-breaking surface over the real pure engine.
   Original visuals, no global listeners, no untrusted markup. Every guess goes
   through the engine; the UI only owns the in-progress row, visuals, focus and
   announcements. Keyboard and touch share the same place/clear/submit actions. */
import {
  CODE_LENGTH,
  COLOR_COUNT,
  MAX_GUESSES,
  COLOR_NAMES,
  createMastermind,
} from "./mastermind-engine.mjs";

/* A letter accompanies each colour so the code is never colour-only. */
const GLYPHS = ["R", "B", "G", "Y", "P", "O"];
const TUTORIAL = "Crack the four-peg code. Pick colours, submit a guess, then use the exact and partial counts to narrow it down.";
let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function peg(className, value) {
  const node = el("span", `mm-peg mm-peg--${value}${className ? ` ${className}` : ""}`, GLYPHS[value]);
  node.setAttribute("aria-label", COLOR_NAMES[value]);
  return node;
}

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Mastermind needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Mastermind window was closed while loading", "AbortError");
  }

  const game = createMastermind();
  const uid = `mm-${++instanceCount}`;
  let disposed = false;
  let activeIndex = 0;
  let current = new Array(CODE_LENGTH).fill(null);

  const root = el("div", "mm-app");
  root.dataset.windowId = windowId || "";
  root.dataset.phase = "playing";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Mastermind");

  const topbar = el("div", "mm-topbar");
  const brand = el("div", "mm-brand");
  const title = el("h1", "mm-title", "Mastermind");
  title.id = `${uid}-title`;
  const subtitle = el("span", "mm-subtitle", `${CODE_LENGTH} pegs · ${COLOR_COUNT} colours · ${MAX_GUESSES} guesses`);
  brand.append(title, subtitle);
  const hud = el("div", "mm-hud");
  const counter = el("span", "mm-counter", `${MAX_GUESSES} guesses left`);
  hud.append(counter);
  topbar.append(brand, hud);

  const message = el("p", "mm-message", TUTORIAL);
  message.dataset.phase = "playing";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");

  const controls = el("div", "mm-controls");
  const reset = el("button", "mm-button mm-reset", "New game");
  reset.type = "button";
  reset.setAttribute("aria-keyshortcuts", "R");
  controls.append(reset);

  const secretSlot = el("div", "mm-secret-slot");

  const hintId = `${uid}-hint`;
  const hint = el("p", "mm-hint",
    "Keys 1-6 place a peg, arrow keys move between slots, Backspace clears a slot and Enter submits. R starts a new game. Tapping a peg or a slot works too.");
  hint.id = hintId;
  root.setAttribute("aria-describedby", hintId);

  const play = el("div", "mm-play");
  const entry = el("div", "mm-entry");
  const entryLabel = el("div", "mm-entry-label", "Your guess");
  const slots = el("div", "mm-slots");
  slots.setAttribute("role", "group");
  slots.setAttribute("aria-label", "Current guess slots");
  slots.setAttribute("aria-describedby", hintId);
  const slotButtons = [];
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    const button = el("button", "mm-slot");
    button.type = "button";
    button.dataset.index = String(index);
    button.tabIndex = index === 0 ? 0 : -1;
    button.setAttribute("aria-keyshortcuts", "1 2 3 4 5 6 Backspace Enter");
    slots.append(button);
    slotButtons.push(button);
  }
  const palette = el("div", "mm-palette");
  palette.setAttribute("role", "group");
  palette.setAttribute("aria-label", "Peg colours");
  const colorButtons = [];
  for (let value = 0; value < COLOR_COUNT; value += 1) {
    const button = el("button", `mm-color mm-peg--${value}`, GLYPHS[value]);
    button.type = "button";
    button.dataset.value = String(value);
    button.setAttribute("aria-label", `Place ${COLOR_NAMES[value]} peg (key ${value + 1})`);
    button.setAttribute("aria-keyshortcuts", String(value + 1));
    palette.append(button);
    colorButtons.push(button);
  }
  const submit = el("button", "mm-button mm-submit", "Submit guess");
  submit.type = "button";
  submit.disabled = true;
  entry.append(entryLabel, slots, palette, submit);

  const history = el("div", "mm-history");
  const historyHead = el("div", "mm-history-head", "Previous guesses");
  const historyList = el("div", "mm-history-list");
  historyList.setAttribute("role", "list");
  history.append(historyHead, historyList);

  play.append(entry, history);
  root.append(topbar, message, controls, secretSlot, play, hint);
  container.replaceChildren(root);

  function describeSlot(index, value) {
    const prefix = `Slot ${index + 1}, ${value === null ? "empty" : COLOR_NAMES[value]}.`;
    if (value === null) return `${prefix} Press 1-6 or choose a peg to fill it.`;
    return `${prefix} Tap to clear, or choose another peg to replace it.`;
  }

  function renderHistory(state) {
    const rows = state.guesses.map((entry) => {
      const row = el("div", "mm-history-row");
      row.setAttribute("role", "listitem");
      const code = el("div", "mm-row-code");
      for (const value of entry.code) code.append(peg("", value));
      const feedback = el("div", "mm-row-feedback", `${entry.exact} exact, ${entry.partial} partial`);
      feedback.setAttribute("aria-label", `${entry.exact} exact and ${entry.partial} partial hits`);
      row.append(code, feedback);
      return row;
    });
    historyList.replaceChildren(...rows);
  }

  function renderSecret(state) {
    if (state.phase === "playing" || !state.secret) {
      secretSlot.replaceChildren();
      return;
    }
    const panel = el("div", "mm-secret");
    panel.setAttribute("role", "status");
    const label = el("span", "mm-secret-label", "Secret code");
    const names = el("span", "mm-secret-names", state.secret.map((value) => COLOR_NAMES[value]).join(" · "));
    const pegs = el("div", "mm-secret-pegs");
    for (const value of state.secret) pegs.append(peg("", value));
    panel.append(label, names, pegs);
    secretSlot.replaceChildren(panel);
  }

  function render(state) {
    const terminal = state.phase !== "playing";
    root.dataset.phase = state.phase;
    message.dataset.phase = state.phase;
    counter.textContent = `${state.remaining} guess${state.remaining === 1 ? "" : "es"} left`;

    for (let index = 0; index < CODE_LENGTH; index += 1) {
      const value = current[index];
      const button = slotButtons[index];
      button.className = `mm-slot${value === null ? " mm-slot--empty" : ` mm-slot--filled mm-peg--${value}`}${index === activeIndex ? " mm-slot--active" : ""}`;
      button.textContent = value === null ? "" : GLYPHS[value];
      button.setAttribute("aria-label", describeSlot(index, value));
      button.setAttribute("aria-pressed", String(index === activeIndex));
      button.tabIndex = index === activeIndex ? 0 : -1;
    }
    submit.disabled = terminal || current.some((value) => value === null);
    for (const button of colorButtons) button.disabled = terminal;

    renderHistory(state);
    renderSecret(state);
  }

  function setActiveIndex(index, moveFocus = true) {
    activeIndex = index;
    render(game.getState());
    if (moveFocus) {
      try { slotButtons[index].focus({ preventScroll: true }); } catch { slotButtons[index].focus(); }
    }
  }

  function placeColor(value) {
    if (disposed) return;
    const state = game.getState();
    if (state.phase !== "playing" || !Number.isInteger(value) || value < 0 || value >= COLOR_COUNT) return;
    current[activeIndex] = value;
    for (let step = 1; step <= CODE_LENGTH; step += 1) {
      const candidate = (activeIndex + step) % CODE_LENGTH;
      if (current[candidate] === null) {
        activeIndex = candidate;
        break;
      }
    }
    render(state);
  }

  function selectSlot(index) {
    if (disposed) return;
    const state = game.getState();
    if (state.phase !== "playing" || !Number.isInteger(index) || index < 0 || index >= CODE_LENGTH) return;
    activeIndex = index;
    if (current[index] !== null) current[index] = null;
    render(state);
  }

  function clearSlot(index) {
    if (disposed) return;
    const state = game.getState();
    if (state.phase !== "playing" || !Number.isInteger(index) || index < 0 || index >= CODE_LENGTH) return;
    current[index] = null;
    activeIndex = index;
    render(state);
  }

  function submitGuess() {
    if (disposed || game.getState().phase !== "playing") return;
    if (current.some((value) => value === null)) {
      message.textContent = "Fill all four slots before submitting your guess.";
      return;
    }
    const state = game.guess([...current]);
    current = new Array(CODE_LENGTH).fill(null);
    activeIndex = 0;
    render(state);
    if (state.phase === "won") {
      message.textContent = `You won! You cracked the code in ${state.guessCount} guess${state.guessCount === 1 ? "" : "es"}. Press New game or R to play again.`;
      try { reset.focus({ preventScroll: true }); } catch { reset.focus(); }
    } else if (state.phase === "lost") {
      message.textContent = "You lost — all ten guesses are spent. Press New game or R to try again.";
      try { reset.focus({ preventScroll: true }); } catch { reset.focus(); }
    } else {
      message.textContent = `Guess ${state.guessCount}: ${state.lastFeedback.exact} exact, ${state.lastFeedback.partial} partial.`;
    }
  }

  function resetGame() {
    if (disposed) return;
    current = new Array(CODE_LENGTH).fill(null);
    activeIndex = 0;
    const state = game.reset();
    render(state);
    message.textContent = "New game. Choose four pegs and submit your first guess.";
  }

  function onSlotsClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button.mm-slot") : null;
    if (!button || !slots.contains(button)) return;
    selectSlot(Number(button.dataset.index));
  }

  function onPaletteClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button.mm-color") : null;
    if (!button || !palette.contains(button)) return;
    placeColor(Number(button.dataset.value));
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;

    const key = event.key;
    if (key.length === 1 && key >= "1" && key <= String(COLOR_COUNT)) {
      event.preventDefault();
      placeColor(Number(key) - 1);
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      setActiveIndex((activeIndex + (key === "ArrowRight" ? 1 : CODE_LENGTH - 1)) % CODE_LENGTH);
      return;
    }
    if (key === "Backspace" || key === "Delete") {
      event.preventDefault();
      clearSlot(activeIndex);
      return;
    }
    if (key.toLowerCase() === "r") {
      event.preventDefault();
      resetGame();
      return;
    }
    if (key === "Enter") {
      const targetIsSlot = target instanceof Element && target.closest("button.mm-slot") && root.contains(target);
      const targetIsButton = target instanceof Element && target.closest("button");
      if (targetIsSlot || (target instanceof Element && root.contains(target) && !targetIsButton)) {
        event.preventDefault();
        submitGuess();
      }
    }
  }

  slots.addEventListener("click", onSlotsClick);
  palette.addEventListener("click", onPaletteClick);
  reset.addEventListener("click", resetGame);
  submit.addEventListener("click", submitGuess);
  root.addEventListener("keydown", onKeyDown);
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    slots.removeEventListener("click", onSlotsClick);
    palette.removeEventListener("click", onPaletteClick);
    reset.removeEventListener("click", resetGame);
    submit.removeEventListener("click", submitGuess);
    root.removeEventListener("keydown", onKeyDown);
    root.remove();
  }

  render(game.getState());

  return {
    canClose: () => true,
    focus() {
      if (disposed) return;
      try { slotButtons[activeIndex].focus({ preventScroll: true }); } catch { slotButtons[activeIndex].focus(); }
    },
    dispose,
  };
}

export default { mount };
