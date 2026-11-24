/* Minesweeper UI: an accessible beginner-board surface over the real pure engine.
   Original game visuals, no global listeners, no untrusted markup. All actions go
   through the engine; only ready/playing snapshots are read for hidden cells, and
   mines are shown only when the engine reports a terminal phase. */
import {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  CELL_COUNT,
  MINE_COUNT,
  createMinesweeper,
  indexToPosition,
} from "./minesweeper-engine.mjs";

const TUTORIAL = "Tap a cell to reveal. Switch on Flag mode or right-click to flag.";
const FLAG_HINT = "Flag mode on: tapping a cell places or removes a flag — no long press needed.";
let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const isTerminal = (phase) => phase === "won" || phase === "lost";

function describeCell(cell, phase) {
  const at = `Row ${cell.row + 1}, column ${cell.col + 1}`;
  if (isTerminal(phase)) {
    if (cell.wrongFlag) return `${at}, wrong flag.`;
    if (cell.flagged && cell.mine) return `${at}, flagged mine.`;
    if (cell.mine) return `${at}, mine.`;
  }
  if (cell.flagged) return `${at}, flagged. Activate to remove flag.`;
  if (!cell.revealed) return `${at}, hidden. Activate to reveal.`;
  if (cell.adjacent > 0) {
    return `${at}, ${cell.adjacent} adjacent mine${cell.adjacent === 1 ? "" : "s"}.`;
  }
  return `${at}, empty.`;
}

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Minesweeper needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Minesweeper window was closed while loading", "AbortError");
  }

  const game = createMinesweeper();
  const uid = `ms-${++instanceCount}`;
  let disposed = false;
  let flagMode = false;
  let focusIndex = 0;
  let elapsed = 0;
  let startedAt = 0;
  let timerId = null;

  const root = el("div", "ms-app");
  root.dataset.windowId = windowId || "";
  root.dataset.phase = "ready";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Minesweeper");

  const topbar = el("div", "ms-topbar");
  const brand = el("div", "ms-brand");
  const title = el("h1", "ms-title", "Minesweeper");
  title.id = `${uid}-title`;
  const subtitle = el("span", "ms-subtitle", `Beginner · ${BOARD_WIDTH} × ${BOARD_HEIGHT} · ${MINE_COUNT} mines`);
  brand.append(title, subtitle);
  const hud = el("div", "ms-hud");
  const counter = el("span", "ms-counter", `${MINE_COUNT} mines left`);
  const timer = el("span", "ms-timer", "0s");
  hud.append(counter, timer);
  topbar.append(brand, hud);

  const message = el("p", "ms-message", TUTORIAL);
  message.dataset.phase = "ready";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");

  const controls = el("div", "ms-controls");
  const reset = el("button", "ms-button ms-reset", "New game");
  reset.type = "button";
  reset.setAttribute("aria-keyshortcuts", "R");
  const mode = el("button", "ms-button ms-mode", "Flag mode: off");
  mode.type = "button";
  mode.setAttribute("aria-pressed", "false");
  controls.append(reset, mode);

  const hintId = `${uid}-hint`;
  const hint = el("p", "ms-hint",
    "Arrow keys move between cells. Enter or Space activates the focused cell. F flags, C opens neighbours when the numbers match, R starts a new game.");
  hint.id = hintId;

  const boardWrap = el("div", "ms-board-wrap");
  const board = el("div", "ms-board");
  board.setAttribute("role", "group");
  board.setAttribute("aria-label", `Minesweeper board, ${BOARD_HEIGHT} rows by ${BOARD_WIDTH} columns`);
  board.setAttribute("aria-describedby", hintId);

  const cellButtons = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const button = el("button", "ms-cell");
    button.type = "button";
    button.dataset.index = String(index);
    button.tabIndex = index === 0 ? 0 : -1;
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-keyshortcuts", "Enter Space F C");
    board.append(button);
    cellButtons.push(button);
  }
  boardWrap.append(board);

  root.append(topbar, message, controls, hint, boardWrap);
  container.replaceChildren(root);

  function tick() {
    elapsed = Math.floor((Date.now() - startedAt) / 1000);
    timer.textContent = `${elapsed}s`;
  }
  function startTimer() {
    if (timerId !== null) return;
    startedAt = Date.now() - elapsed * 1000;
    timerId = setInterval(tick, 250);
    tick();
  }
  function stopTimer() {
    if (timerId === null) return;
    clearInterval(timerId);
    timerId = null;
    tick();
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

  function render(state) {
    root.dataset.phase = state.phase;
    message.dataset.phase = state.phase;
    counter.textContent = `${state.mines - state.flaggedCount} mines left`;
    const terminal = isTerminal(state.phase);
    for (const button of cellButtons) {
      const cell = state.cells[Number(button.dataset.index)];
      button.className = "ms-cell";
      button.textContent = "";
      if (cell.flagged) {
        button.classList.add("ms-cell--flag");
        button.textContent = "⚑";
        if (cell.wrongFlag) button.classList.add("ms-cell--wrong");
      } else if (cell.revealed || (terminal && cell.mine)) {
        if (cell.mine) {
          button.classList.add("ms-cell--mine");
          button.textContent = "✷";
        } else {
          button.classList.add("ms-cell--open");
          if (cell.adjacent > 0) {
            button.textContent = String(cell.adjacent);
            button.classList.add(`ms-n${cell.adjacent}`);
          }
        }
      } else {
        button.classList.add("ms-cell--hidden");
      }
      button.setAttribute("aria-label", describeCell(cell, state.phase));
      button.setAttribute("aria-pressed", String(cell.flagged));
      button.tabIndex = Number(button.dataset.index) === focusIndex ? 0 : -1;
    }
  }

  function announce(kind, index, before, state) {
    if (state.phase === "won") {
      message.textContent = "You won! Every safe cell is open. Press New game or R to play again.";
      return;
    }
    if (state.phase === "lost") {
      message.textContent = "Boom! You hit a mine. Press New game or R to try again.";
      return;
    }
    if (kind === "fault") {
      message.textContent = before.phase === "ready" ? TUTORIAL : "That cell cannot be changed.";
      return;
    }
    const position = indexToPosition(index);
    const at = `Row ${position.row + 1}, column ${position.col + 1}`;
    const left = state.mines - state.flaggedCount;
    if (kind === "flag") {
      message.textContent = state.cells[index].flagged
        ? `${at} flagged. ${left} mines left.`
        : `Flag removed from ${at}. ${left} mines left.`;
    } else if (kind === "chord") {
      message.textContent = `${at} neighbours opened.`;
    } else if (before.phase === "ready") {
      message.textContent = "Board is live. Reveal every safe cell to win.";
    } else {
      message.textContent = `${at} revealed.`;
    }
  }

  function run(action, index, kind) {
    if (disposed || !Number.isInteger(index) || index < 0 || index >= CELL_COUNT) return;
    const before = game.getState();
    let state;
    try {
      state = action(index);
    } catch {
      message.textContent = "That move is not allowed.";
      return;
    }
    if (state === before) {
      if (!isTerminal(before.phase)) announce("fault", index, before, state);
      return;
    }
    if (before.phase === "ready" && state.phase === "playing") startTimer();
    if (isTerminal(state.phase)) stopTimer();
    render(state);
    announce(kind, index, before, state);
  }

  const reveal = (index) => game.reveal(index);
  const toggleFlag = (index) => game.toggleFlag(index);
  const chord = (index) => game.revealNeighbors(index);

  function resetGame() {
    if (disposed) return;
    stopTimer();
    elapsed = 0;
    timer.textContent = "0s";
    const state = game.reset();
    render(state);
    message.textContent = "New game. Your first reveal is always safe.";
  }

  function onBoardClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button.ms-cell") : null;
    if (!button || !board.contains(button)) return;
    const index = Number(button.dataset.index);
    setActiveIndex(index, false);
    run(flagMode ? toggleFlag : reveal, index, flagMode ? "flag" : "reveal");
  }

  function onContextMenu(event) {
    const button = event.target instanceof Element ? event.target.closest("button.ms-cell") : null;
    if (!button || !board.contains(button)) return;
    event.preventDefault();
    const index = Number(button.dataset.index);
    setActiveIndex(index, false);
    run(toggleFlag, index, "flag");
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
    const cellButton = target instanceof Element ? target.closest("button.ms-cell") : null;
    const key = event.key;
    if (key.startsWith("Arrow") || key === "Home" || key === "End") {
      if (!cellButton || !board.contains(cellButton)) return;
      const current = Number(cellButton.dataset.index);
      const position = indexToPosition(current);
      let { row, col } = position;
      if (key === "ArrowLeft") col = Math.max(0, col - 1);
      else if (key === "ArrowRight") col = Math.min(BOARD_WIDTH - 1, col + 1);
      else if (key === "ArrowUp") row = Math.max(0, row - 1);
      else if (key === "ArrowDown") row = Math.min(BOARD_HEIGHT - 1, row + 1);
      else if (key === "Home") col = 0;
      else col = BOARD_WIDTH - 1;
      event.preventDefault();
      setActiveIndex(row * BOARD_WIDTH + col);
      return;
    }
    const lower = key.toLowerCase();
    if (lower === "f") {
      event.preventDefault();
      const index = cellButton ? Number(cellButton.dataset.index) : focusIndex;
      setActiveIndex(index, false);
      run(toggleFlag, index, "flag");
    } else if (lower === "c") {
      event.preventDefault();
      const index = cellButton ? Number(cellButton.dataset.index) : focusIndex;
      run(chord, index, "chord");
    } else if (lower === "r") {
      event.preventDefault();
      resetGame();
    }
  }

  function onModeClick() {
    if (disposed) return;
    flagMode = !flagMode;
    mode.textContent = `Flag mode: ${flagMode ? "on" : "off"}`;
    mode.setAttribute("aria-pressed", String(flagMode));
    root.classList.toggle("ms-app--flag-mode", flagMode);
    message.textContent = flagMode ? FLAG_HINT : "Reveal mode on: tapping a cell reveals it.";
  }

  board.addEventListener("click", onBoardClick);
  board.addEventListener("contextmenu", onContextMenu);
  root.addEventListener("keydown", onKeyDown);
  reset.addEventListener("click", resetGame);
  mode.addEventListener("click", onModeClick);
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopTimer();
    signal?.removeEventListener?.("abort", onAbort);
    board.removeEventListener("click", onBoardClick);
    board.removeEventListener("contextmenu", onContextMenu);
    root.removeEventListener("keydown", onKeyDown);
    reset.removeEventListener("click", resetGame);
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
