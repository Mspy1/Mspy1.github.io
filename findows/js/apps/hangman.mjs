/* Hangman UI: an accessible word-guessing surface over the real pure engine.
   Original gallows artwork is built as SVG nodes, letters are plain text, and
   every input goes through the engine. Scoped listeners only; no untrusted
   markup, no dynamic code and no network requests. */
import { createHangman } from "./hangman-engine.mjs";

const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const PLACEHOLDER = "\u00B7";
const SVG_NS = "http://www.w3.org/2000/svg";
const TUTORIAL = "Type a letter or tap one below. Six wrong guesses complete the sketch.";
const HINT = "Type A-Z to guess, tap a key on touch, Escape for a new game. Arrow keys move between letter keys.";
let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgEl(tag, attributes, className) {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute("class", className);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function labelForGuess(letter, state) {
  if (state.guessedLetters.includes(letter)) {
    const record = state.guesses.find((guess) => guess.letter === letter);
    return record?.correct ? `${letter}, correct` : `${letter}, wrong`;
  }
  return `Guess letter ${letter}`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Hangman needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Hangman window was closed while loading", "AbortError");
  }
  void fileId;

  const options = {};
  if (typeof services?.random === "function") options.random = services.random;
  if (Array.isArray(services?.words)) options.words = services.words;
  const game = createHangman(options);

  const uid = `hm-${++instanceCount}`;
  let disposed = false;
  let tileCount = 0;
  let activeKeyIndex = 0;

  const root = el("div", "hm-app");
  root.tabIndex = -1;
  root.dataset.windowId = windowId || "";
  root.dataset.phase = "ready";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Hangman");

  const topbar = el("div", "hm-topbar");
  const brand = el("div", "hm-brand");
  const title = el("h1", "hm-title", "Hangman");
  title.id = `${uid}-title`;
  const subtitle = el("span", "hm-subtitle", "Guess the word before the sketch is finished");
  brand.append(title, subtitle);
  const hud = el("div", "hm-hud");
  const misses = el("span", "hm-stat hm-misses", `0 / 6 misses`);
  const length = el("span", "hm-stat hm-length", "6 letters");
  hud.append(misses, length);
  topbar.append(brand, hud);

  const message = el("p", "hm-message", TUTORIAL);
  message.dataset.phase = "ready";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");

  const stage = el("div", "hm-stage");
  const figure = svgEl("svg", {
    viewBox: "0 0 200 220",
    role: "img",
    "aria-label": "Hangman sketch, no parts drawn yet",
  }, "hm-figure");
  const frame = svgEl("g", {}, "hm-frame");
  frame.append(
    svgEl("path", { d: "M22 206 H178" }, "hm-ground"),
    svgEl("path", { d: "M56 206 V26 H150" }, "hm-beam"),
    svgEl("path", { d: "M150 26 V44" }, "hm-rope"),
  );
  const parts = svgEl("g", {}, "hm-parts");
  const partOrder = [
    ["head", svgEl("circle", { cx: 150, cy: 60, r: 15 }, "hm-part")],
    ["body", svgEl("path", { d: "M150 75 V132" }, "hm-part")],
    ["arm-left", svgEl("path", { d: "M150 86 L119 106" }, "hm-part")],
    ["arm-right", svgEl("path", { d: "M150 86 L181 106" }, "hm-part")],
    ["leg-left", svgEl("path", { d: "M150 132 L120 163" }, "hm-part")],
    ["leg-right", svgEl("path", { d: "M150 132 L180 163" }, "hm-part")],
  ];
  const partNodes = [];
  for (const [name, node] of partOrder) {
    node.dataset.part = name;
    parts.append(node);
    partNodes.push(node);
  }
  figure.append(frame, parts);

  const word = el("div", "hm-word");
  word.setAttribute("role", "group");
  word.setAttribute("aria-label", "Word progress");
  word.setAttribute("aria-describedby", `${uid}-hint`);
  const tiles = el("div", "hm-tiles");
  word.append(tiles);
  stage.append(figure, word);

  const keys = el("div", "hm-keys");
  keys.setAttribute("role", "group");
  keys.setAttribute("aria-label", "Letter keys");
  const keyButtons = [];
  for (const row of KEY_ROWS) {
    const keyRow = el("div", "hm-keyrow");
    for (const letter of row) {
      const button = el("button", "hm-key", letter);
      button.type = "button";
      button.dataset.letter = letter;
      button.dataset.state = "idle";
      button.tabIndex = keyButtons.length === 0 ? 0 : -1;
      button.setAttribute("aria-label", `Guess letter ${letter}`);
      keyRow.append(button);
      keyButtons.push(button);
    }
    keys.append(keyRow);
  }

  const controls = el("div", "hm-controls");
  const newGameButton = el("button", "hm-button hm-new", "New game");
  newGameButton.type = "button";
  newGameButton.setAttribute("aria-keyshortcuts", "Escape");
  controls.append(newGameButton);

  const hint = el("p", "hm-hint", HINT);
  hint.id = `${uid}-hint`;

  root.append(topbar, message, stage, keys, controls, hint);
  container.replaceChildren(root);
  try { root.focus({ preventScroll: true }); } catch { root.focus(); }

  function buildTiles(count) {
    if (count === tileCount) return;
    tileCount = count;
    const nodes = [];
    for (let index = 0; index < count; index += 1) {
      const tile = el("span", "hm-tile", PLACEHOLDER);
      tile.dataset.index = String(index);
      nodes.push(tile);
    }
    tiles.replaceChildren(...nodes);
  }

  function setTabIndices() {
    for (let index = 0; index < keyButtons.length; index += 1) {
      keyButtons[index].tabIndex = index === activeKeyIndex && !keyButtons[index].disabled ? 0 : -1;
    }
  }

  function setActiveKey(index, moveFocus = true) {
    if (index < 0 || index >= keyButtons.length || keyButtons[index].disabled) return;
    activeKeyIndex = index;
    setTabIndices();
    if (moveFocus) {
      try { keyButtons[index].focus({ preventScroll: true }); } catch { keyButtons[index].focus(); }
    }
  }

  function ensureActiveKey() {
    if (!keyButtons[activeKeyIndex]?.disabled) {
      setTabIndices();
      return;
    }
    const forward = keyButtons.findIndex((button, index) => index >= activeKeyIndex && !button.disabled);
    const next = forward >= 0 ? forward : keyButtons.findIndex((button) => !button.disabled);
    activeKeyIndex = next >= 0 ? next : activeKeyIndex;
    setTabIndices();
  }

  function render(state) {
    const terminal = state.phase === "won" || state.phase === "lost";
    root.dataset.phase = state.phase;
    message.dataset.phase = state.phase;
    misses.textContent = `${state.misses} / ${state.maxMisses} misses`;
    length.textContent = plural(state.wordLength, "letter");
    buildTiles(state.wordLength);

    const tileNodes = [...tiles.children];
    for (let index = 0; index < tileNodes.length; index += 1) {
      const letter = state.letters[index];
      const tile = tileNodes[index];
      tile.textContent = letter == null ? PLACEHOLDER : letter;
      tile.classList.toggle("hm-tile--revealed", letter != null);
      tile.setAttribute("aria-label", `Letter ${index + 1}: ${letter == null ? "hidden" : letter}`);
    }

    for (let index = 0; index < partNodes.length; index += 1) {
      partNodes[index].classList.toggle("hm-part--visible", index < state.misses);
    }
    figure.classList.toggle("hm-figure--lost", state.phase === "lost");
    figure.classList.toggle("hm-figure--won", state.phase === "won");
    figure.setAttribute("aria-label",
      `Hangman sketch with ${plural(state.misses, "part")} drawn of six`);

    const active = document.activeElement;
    const focusedKey = active instanceof Element && keys.contains(active) &&
      active.classList.contains("hm-key") ? active : null;
    const records = new Map(state.guesses.map((guess) => [guess.letter, guess.correct]));
    for (const button of keyButtons) {
      const letter = button.dataset.letter;
      const record = records.get(letter);
      const stateName = record === undefined ? "idle" : record ? "correct" : "wrong";
      button.dataset.state = stateName;
      button.disabled = terminal || record !== undefined;
      button.setAttribute("aria-label", labelForGuess(letter, state));
    }
    if (focusedKey?.disabled) {
      const target = terminal ? newGameButton : root;
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    }
    ensureActiveKey();
  }

  function resultText(state) {
    if (state.phase === "won") {
      return `You got it — ${state.word}! Press New game or Escape to play again.`;
    }
    if (state.phase === "lost") {
      return `The word was ${state.word}. Press New game or Escape to try again.`;
    }
    return TUTORIAL;
  }

  function submitGuess(letter) {
    if (disposed) return;
    const before = game.getState();
    let after;
    try {
      after = game.guess(letter);
    } catch {
      message.textContent = "Choose one letter from A to Z.";
      return;
    }
    if (after === before) {
      if (after.phase === "won" || after.phase === "lost") message.textContent = resultText(after);
      else if (after.guessedLetters.includes(letter)) message.textContent = `You already tried ${letter}.`;
      return;
    }
    render(after);
    if (after.phase === "won" || after.phase === "lost") {
      message.textContent = resultText(after);
      return;
    }
    const record = after.guesses[after.guesses.length - 1];
    const tail = `${plural(after.remaining, "miss")} left.`;
    message.textContent = record?.correct
      ? `Yes — ${letter} is in the word. ${tail}`
      : `No — ${letter} is not in the word. ${tail}`;
  }

  function newGame() {
    if (disposed) return;
    let fresh;
    try {
      fresh = game.reset();
    } catch {
      message.textContent = "A new word could not be chosen.";
      return;
    }
    render(fresh);
    message.textContent = `New word — ${plural(fresh.wordLength, "letter")}. Six wrong guesses complete the sketch.`;
  }

  function onKeysClick(event) {
    if (disposed) return;
    const button = event.target instanceof Element ? event.target.closest("button.hm-key") : null;
    if (!button || !keys.contains(button) || button.disabled) return;
    const index = keyButtons.indexOf(button);
    if (index >= 0) setActiveKey(index, false);
    submitGuess(button.dataset.letter);
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;

    const key = event.key;
    if (key === "Escape") {
      event.preventDefault();
      newGame();
      return;
    }
    const keyButton = target instanceof Element ? target.closest("button.hm-key") : null;
    if (key.startsWith("Arrow") || key === "Home" || key === "End") {
      if (!keyButton) {
        event.preventDefault();
        setActiveKey(activeKeyIndex);
        return;
      }
      const current = keyButtons.indexOf(keyButton);
      const rowSize = KEY_ROWS[0].length;
      let next = current;
      if (key === "ArrowLeft") next = Math.max(0, current - 1);
      else if (key === "ArrowRight") next = Math.min(keyButtons.length - 1, current + 1);
      else if (key === "ArrowUp") next = Math.max(0, current - rowSize);
      else if (key === "ArrowDown") next = Math.min(keyButtons.length - 1, current + rowSize);
      else if (key === "Home") next = Math.floor(current / rowSize) * rowSize;
      else next = Math.min(keyButtons.length - 1, Math.floor(current / rowSize) * rowSize + rowSize - 1);
      event.preventDefault();
      setActiveKey(next);
      return;
    }
    if (/^[a-zA-Z]$/.test(key)) {
      event.preventDefault();
      submitGuess(key.toUpperCase());
    }
  }

  function onAbort() { dispose(); }

  keys.addEventListener("click", onKeysClick);
  root.addEventListener("keydown", onKeyDown);
  newGameButton.addEventListener("click", newGame);
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    keys.removeEventListener("click", onKeysClick);
    root.removeEventListener("keydown", onKeyDown);
    newGameButton.removeEventListener("click", newGame);
    root.remove();
  }

  render(game.getState());

  return {
    canClose: () => true,
    focus() {
      if (disposed) return;
      const button = keyButtons[activeKeyIndex];
      if (button && !button.disabled) setActiveKey(activeKeyIndex);
      else {
        try { root.focus({ preventScroll: true }); } catch { root.focus(); }
      }
    },
    dispose,
  };
}

export default { mount };
