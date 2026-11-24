/* Nonogram UI: an accessible clue-driven grid over the real pure engine.
   Original game visuals, no global listeners, no untrusted markup. Every cell
   action goes through the engine; the renderer only reads frozen snapshots and
   never sees the solution grid. */
import { createNonogram, indexToPosition } from "./nonogram-engine.mjs";

const TUTORIAL = "Fill the squares that match the row and column clues. A wrong fill counts as a mistake; an X never counts as a fill.";
const MARK_HINT = "Mark mode on: tapping a square places or removes an X — no long press needed.";
const FILL_HINT = "Fill mode on: tapping a square fills it; tapping again clears it.";
let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function describeCell(cell) {
  const at = `Row ${cell.row + 1}, column ${cell.col + 1}`;
  if (cell.state === "filled") return `${at}, filled. Activate to clear.`;
  if (cell.state === "marked") return `${at}, marked. Activate to fill.`;
  return `${at}, empty. Activate to fill.`;
}

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Nonogram needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Nonogram window was closed while loading", "AbortError");
  }
  void fileId;
  void services;

  const game = createNonogram();
  const snapshot = game.getState();
  const size = snapshot.size;
  const cellCount = size * size;
  const uid = `ng-${++instanceCount}`;
  let disposed = false;
  let markMode = false;
  let focusIndex = 0;

  const root = el("div", "ng-app");
  root.dataset.windowId = windowId || "";
  root.dataset.phase = snapshot.phase;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Nonogram");

  const topbar = el("div", "ng-topbar");
  const brand = el("div", "ng-brand");
  const title = el("h1", "ng-title", "Nonogram");
  title.id = `${uid}-title`;
  const subtitle = el("span", "ng-subtitle", `${snapshot.title} · ${size} × ${size}`);
  brand.append(title, subtitle);
  const hud = el("div", "ng-hud");
  const progress = el("span", "ng-progress", `${snapshot.filledCount} / ${snapshot.total} filled`);
  const mistakes = el("span", "ng-mistakes", `${snapshot.mistakes} mistakes`);
  hud.append(progress, mistakes);
  topbar.append(brand, hud);

  const message = el("p", "ng-message", TUTORIAL);
  message.dataset.phase = snapshot.phase;
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");

  const controls = el("div", "ng-controls");
  const reset = el("button", "ng-button ng-reset", "Restart");
  reset.type = "button";
  reset.setAttribute("aria-keyshortcuts", "R");
  const mode = el("button", "ng-button ng-mode", "Mode: Fill");
  mode.type = "button";
  mode.setAttribute("aria-pressed", "false");
  controls.append(reset, mode);

  const hintId = `${uid}-hint`;
  const hint = el("p", "ng-hint",
    "Arrow keys move between squares. Enter or Space fills, F fills, M marks, R restarts. Right-click marks with a mouse.");
  hint.id = hintId;

  function clueNode(clues, kind, label) {
    const node = el("div", `ng-${kind}-clue`);
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", `${label} clue: ${clues.join(", ")}`);
    for (const value of clues) {
      node.append(el("span", "ng-clue-n", String(value)), document.createTextNode(" "));
    }
    return node;
  }

  const boardWrap = el("div", "ng-board-wrap");
  const board = el("div", "ng-grid");
  board.setAttribute("role", "group");
  board.setAttribute("aria-label", `Nonogram grid, ${size} rows by ${size} columns`);
  board.setAttribute("aria-describedby", hintId);

  const corner = el("div", "ng-corner");
  corner.setAttribute("aria-hidden", "true");
  board.append(corner);
  const columnClues = el("div", "ng-col-clues");
  for (let col = 0; col < size; col += 1) {
    columnClues.append(clueNode(snapshot.columns[col], "col", `Column ${col + 1}`));
  }
  board.append(columnClues);

  const cellButtons = [];
  for (let row = 0; row < size; row += 1) {
    board.append(clueNode(snapshot.rows[row], "row", `Row ${row + 1}`));
    const rowCells = el("div", "ng-row-cells");
    for (let col = 0; col < size; col += 1) {
      const index = row * size + col;
      const button = el("button", "ng-cell ng-cell--empty");
      button.type = "button";
      button.dataset.index = String(index);
      button.tabIndex = index === 0 ? 0 : -1;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-keyshortcuts", "Enter Space F M");
      button.setAttribute("aria-label", describeCell({ row, col, state: "empty" }));
      rowCells.append(button);
      cellButtons.push(button);
    }
    board.append(rowCells);
  }
  boardWrap.append(board);

  root.append(topbar, message, controls, hint, boardWrap);
  container.replaceChildren(root);

  function setActiveIndex(index, moveFocus = true) {
    focusIndex = index;
    for (const button of cellButtons) {
      button.tabIndex = Number(button.dataset.index) === index ? 0 : -1;
    }
    if (moveFocus) {
      try { cellButtons[index].focus({ preventScroll: true }); } catch { cellButtons[index].focus(); }
    }
  }

  function render(state) {
    root.dataset.phase = state.phase;
    message.dataset.phase = state.phase;
    root.classList.toggle("ng-app--won", state.phase === "won");
    progress.textContent = `${state.filledCount} / ${state.total} filled`;
    mistakes.textContent = `${state.mistakes} mistake${state.mistakes === 1 ? "" : "s"}`;
    for (const button of cellButtons) {
      const index = Number(button.dataset.index);
      const cell = state.cells[index];
      button.className = `ng-cell ng-cell--${cell.state}`;
      button.textContent = cell.state === "marked" ? "×" : "";
      button.setAttribute("aria-label", describeCell(cell));
      button.setAttribute("aria-pressed", String(cell.state === "filled"));
      button.tabIndex = index === focusIndex ? 0 : -1;
    }
  }

  function announce(kind, index, before, state) {
    if (state.phase === "won") {
      message.textContent = "Puzzle complete! The picture is revealed. Press Restart or R to play again.";
      return;
    }
    const position = indexToPosition(index, size);
    const at = `Row ${position.row + 1}, column ${position.col + 1}`;
    const cell = state.cells[index];
    let text;
    if (kind === "mark") {
      text = cell.state === "marked" ? `${at} marked.` : `${at} mark removed.`;
    } else if (kind === "fill") {
      text = cell.state === "filled" ? `${at} filled.` : `${at} cleared.`;
    } else {
      text = `${at} updated.`;
    }
    if (state.mistakes > before.mistakes) {
      text += ` ${state.mistakes} mistake${state.mistakes === 1 ? "" : "s"} so far.`;
    }
    message.textContent = text;
  }

  function run(action, index, kind) {
    if (disposed || !Number.isInteger(index) || index < 0 || index >= cellCount) return;
    const before = game.getState();
    let state;
    try {
      state = action(index);
    } catch {
      message.textContent = "That square cannot be changed.";
      return;
    }
    if (state === before) return;
    render(state);
    announce(kind, index, before, state);
  }

  const fillAt = (index) => game.toggleFill(index);
  const markAt = (index) => game.toggleMark(index);

  function restart() {
    if (disposed) return;
    const state = game.reset();
    render(state);
    message.textContent = "Puzzle restarted. Fill the squares that match the clues.";
  }

  function onBoardClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button.ng-cell") : null;
    if (!button || !board.contains(button)) return;
    const index = Number(button.dataset.index);
    setActiveIndex(index, false);
    run(markMode ? markAt : fillAt, index, markMode ? "mark" : "fill");
  }

  function onContextMenu(event) {
    const button = event.target instanceof Element ? event.target.closest("button.ng-cell") : null;
    if (!button || !board.contains(button)) return;
    event.preventDefault();
    const index = Number(button.dataset.index);
    setActiveIndex(index, false);
    run(markAt, index, "mark");
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
    const cellButton = target instanceof Element ? target.closest("button.ng-cell") : null;
    const key = event.key;
    if (key.startsWith("Arrow") || key === "Home" || key === "End") {
      if (!cellButton || !board.contains(cellButton)) return;
      const index = Number(cellButton.dataset.index);
      const { row, col } = indexToPosition(index, size);
      let nextRow = row;
      let nextCol = col;
      if (key === "ArrowLeft") nextCol = Math.max(0, col - 1);
      else if (key === "ArrowRight") nextCol = Math.min(size - 1, col + 1);
      else if (key === "ArrowUp") nextRow = Math.max(0, row - 1);
      else if (key === "ArrowDown") nextRow = Math.min(size - 1, row + 1);
      else if (key === "Home") nextCol = 0;
      else nextCol = size - 1;
      event.preventDefault();
      setActiveIndex(nextRow * size + nextCol);
      return;
    }
    const lower = key.toLowerCase();
    if (lower === "f" || lower === "m" || lower === "r") {
      event.preventDefault();
      const index = cellButton ? Number(cellButton.dataset.index) : focusIndex;
      if (lower === "f") run(fillAt, index, "fill");
      else if (lower === "m") run(markAt, index, "mark");
      else restart();
    }
  }

  function onModeClick() {
    if (disposed) return;
    markMode = !markMode;
    mode.textContent = `Mode: ${markMode ? "Mark" : "Fill"}`;
    mode.setAttribute("aria-pressed", String(markMode));
    root.classList.toggle("ng-app--mark-mode", markMode);
    message.textContent = markMode ? MARK_HINT : FILL_HINT;
  }

  board.addEventListener("click", onBoardClick);
  board.addEventListener("contextmenu", onContextMenu);
  root.addEventListener("keydown", onKeyDown);
  reset.addEventListener("click", restart);
  mode.addEventListener("click", onModeClick);
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    board.removeEventListener("click", onBoardClick);
    board.removeEventListener("contextmenu", onContextMenu);
    root.removeEventListener("keydown", onKeyDown);
    reset.removeEventListener("click", restart);
    mode.removeEventListener("click", onModeClick);
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
