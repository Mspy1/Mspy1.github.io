/* Game of Life UI: an accessible Conway grid over the real pure engine.
   Original visuals, no global listeners, no untrusted markup and no network.
   Every cell change, generation, preset and wrap setting goes through the
   engine; this module owns only the timer, visuals, focus and announcements. */
import {
  CELL_COUNT,
  GRID_HEIGHT,
  GRID_WIDTH,
  PRESETS,
  createGameOfLife,
  indexToPosition,
} from "./game-of-life-engine.mjs";

const PRESET_TITLES = Object.freeze({
  glider: "Glider",
  blinker: "Blinker",
  toad: "Toad",
  beacon: "Beacon",
  block: "Block",
  beehive: "Beehive",
  "lightweight-spaceship": "Lightweight spaceship",
  pulsar: "Pulsar",
});
const SPEEDS = Object.freeze({ "600": "Slow", "250": "Normal", "90": "Fast" });
const INTRO = "Pick a pattern or tap cells to draw a world. Play watches it evolve.";
let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function describeCell(index, alive) {
  const { row, col } = indexToPosition(index);
  const at = `Row ${row + 1}, column ${col + 1}`;
  return alive ? `${at}, alive. Activate to kill.` : `${at}, dead. Activate to bring to life.`;
}

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Game of Life needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Game of Life window was closed while loading", "AbortError");
  }

  const game = createGameOfLife();
  const uid = `gol-${++instanceCount}`;
  let disposed = false;
  let focusIndex = 0;
  let speed = 250;
  let timerId = null;

  const root = el("div", "gol-app");
  root.dataset.windowId = windowId || "";
  root.dataset.generation = "0";
  root.dataset.wrap = "false";
  root.dataset.running = "false";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Game of Life");
  const hintId = `${uid}-hint`;
  root.setAttribute("aria-describedby", hintId);

  const topbar = el("div", "gol-topbar");
  const brand = el("div", "gol-brand");
  const title = el("h1", "gol-title", "Game of Life");
  title.id = `${uid}-title`;
  const subtitle = el("span", "gol-subtitle", `${GRID_WIDTH} × ${GRID_HEIGHT} · Conway's Game of Life`);
  brand.append(title, subtitle);
  const hud = el("div", "gol-hud");
  const generationItem = el("span", "gol-hud-item");
  generationItem.append(el("span", "gol-hud-label", "Generation"), el("span", "gol-generation", "0"));
  const populationItem = el("span", "gol-hud-item");
  populationItem.append(el("span", "gol-hud-label", "Population"), el("span", "gol-population", "0"));
  const stateValue = el("span", "gol-state", "Paused");
  hud.append(generationItem, populationItem, stateValue);
  topbar.append(brand, hud);

  const message = el("p", "gol-message", INTRO);
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");

  const controls = el("div", "gol-controls");
  const play = el("button", "gol-button gol-play", "Play");
  play.type = "button";
  play.setAttribute("aria-pressed", "false");
  play.setAttribute("aria-keyshortcuts", "P");
  const step = el("button", "gol-button gol-step", "Step");
  step.type = "button";
  step.setAttribute("aria-keyshortcuts", ".");
  const speedLabel = el("label", "gol-field");
  speedLabel.append(el("span", "gol-field-label", "Speed"));
  const speedSelect = el("select", "gol-select gol-speed");
  for (const [value, label] of Object.entries(SPEEDS)) {
    const option = el("option", "", label);
    option.value = value;
    speedSelect.append(option);
  }
  speedSelect.value = "250";
  speedLabel.htmlFor = `${uid}-speed`;
  speedSelect.id = speedLabel.htmlFor;
  speedLabel.append(speedSelect);
  const presetLabel = el("label", "gol-field");
  presetLabel.append(el("span", "gol-field-label", "Pattern"));
  const presetSelect = el("select", "gol-select gol-preset");
  const placeholder = el("option", "", "Choose a pattern…");
  placeholder.value = "";
  presetSelect.append(placeholder);
  for (const name of PRESETS) {
    const option = el("option", "", PRESET_TITLES[name]);
    option.value = name;
    presetSelect.append(option);
  }
  presetSelect.value = "";
  presetLabel.htmlFor = `${uid}-preset`;
  presetSelect.id = presetLabel.htmlFor;
  presetLabel.append(presetSelect);
  const wrap = el("button", "gol-button gol-wrap", "Wrap: off");
  wrap.type = "button";
  wrap.setAttribute("aria-pressed", "false");
  wrap.setAttribute("aria-keyshortcuts", "W");
  const clear = el("button", "gol-button gol-clear", "Clear");
  clear.type = "button";
  clear.setAttribute("aria-keyshortcuts", "C");
  const random = el("button", "gol-button gol-random", "Randomize");
  random.type = "button";
  random.setAttribute("aria-keyshortcuts", "R");
  controls.append(play, step, speedLabel, presetLabel, wrap, clear, random);

  const hint = el("p", "gol-hint",
    "Arrow keys move, Enter or Space toggles a cell. P play/pause, . step, G glider, W wrap, C clear, R randomize.");
  hint.id = hintId;

  const boardWrap = el("div", "gol-board-wrap");
  const board = el("div", "gol-board");
  board.setAttribute("role", "group");
  board.setAttribute("aria-label", `Game of Life board, ${GRID_HEIGHT} rows by ${GRID_WIDTH} columns`);
  board.setAttribute("aria-describedby", hintId);
  const cellButtons = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const button = el("button", "gol-cell");
    button.type = "button";
    button.dataset.index = String(index);
    button.tabIndex = index === 0 ? 0 : -1;
    button.setAttribute("aria-pressed", "false");
    board.append(button);
    cellButtons.push(button);
  }
  boardWrap.append(board);
  root.append(topbar, message, controls, hint, boardWrap);
  container.replaceChildren(root);

  const isRunning = () => timerId !== null;

  function render(state) {
    root.dataset.generation = String(state.generation);
    root.dataset.wrap = String(state.wrap);
    root.dataset.running = String(isRunning());
    generationEl.textContent = String(state.generation);
    populationEl.textContent = String(state.population);
    stateValue.textContent = isRunning() ? "Running" : "Paused";
    play.textContent = isRunning() ? "Pause" : "Play";
    play.setAttribute("aria-pressed", String(isRunning()));
    wrap.textContent = `Wrap: ${state.wrap ? "on" : "off"}`;
    wrap.setAttribute("aria-pressed", String(state.wrap));
    presetSelect.value = state.preset || "";
    for (const button of cellButtons) {
      const index = Number(button.dataset.index);
      const alive = state.cells[index];
      button.className = alive ? "gol-cell gol-cell--alive" : "gol-cell";
      button.setAttribute("aria-pressed", String(alive));
      button.setAttribute("aria-label", describeCell(index, alive));
      button.tabIndex = index === focusIndex ? 0 : -1;
    }
  }

  const generationEl = generationItem.querySelector(".gol-generation");
  const populationEl = populationItem.querySelector(".gol-population");

  function announce(text) {
    message.textContent = text;
  }

  function setActiveIndex(index, moveFocus = true) {
    focusIndex = index;
    for (const button of cellButtons) {
      button.tabIndex = Number(button.dataset.index) === index ? 0 : -1;
    }
    if (moveFocus) {
      try { cellButtons[index].focus({ preventScroll: true }); } catch { cellButtons[index].focus(); }
    }
  }

  function startTimer() {
    if (disposed || timerId !== null) return;
    timerId = setInterval(() => {
      if (disposed) return;
      const state = game.step();
      render(state);
      announce(`Generation ${state.generation}: ${state.population} live cells.`);
    }, speed);
  }

  function stopTimer() {
    if (timerId === null) return;
    clearInterval(timerId);
    timerId = null;
  }

  function togglePlay() {
    if (disposed) return;
    if (isRunning()) {
      stopTimer();
      announce(`Paused at generation ${game.getState().generation}.`);
    } else {
      startTimer();
      announce(`Running. Generation ${game.getState().generation} and counting.`);
    }
    render(game.getState());
  }

  function doStep() {
    if (disposed) return;
    const state = game.step();
    render(state);
    announce(`Generation ${state.generation}: ${state.population} live cells.`);
  }

  function editCell(index) {
    if (disposed || !Number.isInteger(index) || index < 0 || index >= CELL_COUNT) return;
    const state = game.toggleCell(index);
    render(state);
    announce(state.cells[index] ? `${describeCell(index, true)} Generation ${state.generation}.`
      : `${describeCell(index, false)} Generation ${state.generation}.`);
  }

  function doClear() {
    if (disposed) return;
    stopTimer();
    const state = game.clear();
    render(state);
    announce("World cleared. Draw a pattern or choose a preset.");
  }

  function doPreset(name) {
    if (disposed) return;
    stopTimer();
    const state = game.loadPreset(name);
    render(state);
    announce(`${PRESET_TITLES[name] || name} pattern loaded with ${state.population} live cells.`);
  }

  function doRandom() {
    if (disposed) return;
    stopTimer();
    const state = game.randomize();
    render(state);
    announce(`Random world with ${state.population} live cells.`);
  }

  function doWrap() {
    if (disposed) return;
    const state = game.setWrap(!game.getState().wrap);
    render(state);
    announce(state.wrap ? "Wrap is on: opposite edges are neighbors." : "Wrap is off: the world has dead edges.");
  }

  function doSpeed(value) {
    if (disposed || !Object.hasOwn(SPEEDS, value)) return;
    speed = Number(value);
    if (isRunning()) {
      clearInterval(timerId);
      timerId = null;
      startTimer();
    }
    render(game.getState());
    announce(`Speed set to ${SPEEDS[value]}.`);
  }

  function onBoardClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button.gol-cell") : null;
    if (!button || !board.contains(button)) return;
    const index = Number(button.dataset.index);
    setActiveIndex(index, false);
    editCell(index);
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
    const cellButton = target instanceof Element ? target.closest("button.gol-cell") : null;
    const key = event.key;
    if (key.startsWith("Arrow") || key === "Home" || key === "End") {
      if (!cellButton || !board.contains(cellButton)) return;
      const current = Number(cellButton.dataset.index);
      const origin = indexToPosition(current);
      let row = origin.row; // indexToPosition is frozen; copy before changing
      let col = origin.col;
      if (key === "ArrowLeft") col = Math.max(0, col - 1);
      else if (key === "ArrowRight") col = Math.min(GRID_WIDTH - 1, col + 1);
      else if (key === "ArrowUp") row = Math.max(0, row - 1);
      else if (key === "ArrowDown") row = Math.min(GRID_HEIGHT - 1, row + 1);
      else if (key === "Home") col = 0;
      else col = GRID_WIDTH - 1;
      event.preventDefault();
      setActiveIndex(row * GRID_WIDTH + col);
      return;
    }
    // Enter and Space use native button activation; no synthetic second toggle.
    if (key === "Enter" || key === " ") return;
    const lower = key.toLowerCase();
    if (lower === "p") { event.preventDefault(); togglePlay(); }
    else if (key === ".") { event.preventDefault(); doStep(); }
    else if (lower === "w") { event.preventDefault(); doWrap(); }
    else if (lower === "c") { event.preventDefault(); doClear(); }
    else if (lower === "r") { event.preventDefault(); doRandom(); }
    else if (lower === "g") { event.preventDefault(); doPreset("glider"); }
  }

  function onPresetChange(event) {
    const value = event.target.value;
    if (value) doPreset(value);
    else announce("Choose a pattern from the list, or draw your own cells.");
  }

  function onSpeedChange(event) {
    doSpeed(event.target.value);
  }

  board.addEventListener("click", onBoardClick);
  root.addEventListener("keydown", onKeyDown);
  play.addEventListener("click", togglePlay);
  step.addEventListener("click", doStep);
  wrap.addEventListener("click", doWrap);
  clear.addEventListener("click", doClear);
  random.addEventListener("click", doRandom);
  presetSelect.addEventListener("change", onPresetChange);
  speedSelect.addEventListener("change", onSpeedChange);
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopTimer();
    signal?.removeEventListener?.("abort", onAbort);
    board.removeEventListener("click", onBoardClick);
    root.removeEventListener("keydown", onKeyDown);
    play.removeEventListener("click", togglePlay);
    step.removeEventListener("click", doStep);
    wrap.removeEventListener("click", doWrap);
    clear.removeEventListener("click", doClear);
    random.removeEventListener("click", doRandom);
    presetSelect.removeEventListener("change", onPresetChange);
    speedSelect.removeEventListener("change", onSpeedChange);
    root.remove();
  }

  render(game.getState());

  return {
    canClose: () => true,
    focus() {
      if (disposed) return;
      setActiveIndex(focusIndex);
    },
    dispose,
  };
}

export default { mount };
