/* Fifteen Puzzle UI: an accessible 4x4 sliding-board surface over the real pure
   engine. Original visuals, no global listeners, no untrusted markup. Every
   slide goes through the engine; the UI only renders its frozen snapshot. */
import {
  GRID_SIZE,
  TILE_COUNT,
  createFifteenPuzzle,
  indexToPosition,
} from "./fifteen-puzzle-engine.mjs";

const TUTORIAL = "Slide a tile beside the gap. Arrow keys move the gap, R starts a new game.";
const ARROWS = Object.freeze({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" });
let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export async function mount({ container, windowId, fileId, services, signal, tiles, shuffleMoves } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Fifteen Puzzle needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Fifteen Puzzle window was closed while loading", "AbortError");
  }

  const game = createFifteenPuzzle({ tiles, shuffleMoves });
  const uid = `fp-${++instanceCount}`;
  let disposed = false;
  let focusIndex = 0;
  let elapsed = 0;
  let startedAt = 0;
  let timerId = null;
  let touchStart = null;
  let suppressClickUntil = 0;

  const root = el("div", "fp-app");
  root.dataset.windowId = windowId || "";
  root.dataset.phase = "playing";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Fifteen Puzzle");

  const topbar = el("div", "fp-topbar");
  const brand = el("div", "fp-brand");
  const title = el("h1", "fp-title", "Fifteen Puzzle");
  title.id = `${uid}-title`;
  const subtitle = el("span", "fp-subtitle", `${GRID_SIZE} × ${GRID_SIZE} · order 1–15`);
  brand.append(title, subtitle);
  const hud = el("div", "fp-hud");
  const moves = el("span", "fp-moves", "0 moves");
  const timer = el("span", "fp-timer", "0:00");
  hud.append(moves, timer);
  topbar.append(brand, hud);

  const status = el("p", "fp-status", TUTORIAL);
  status.dataset.phase = "playing";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  const controls = el("div", "fp-controls");
  const reset = el("button", "fp-new", "New game");
  reset.type = "button";
  reset.setAttribute("aria-keyshortcuts", "R");
  controls.append(reset);

  const hintId = `${uid}-hint`;
  const hint = el("p", "fp-hint", "Tap a numbered tile next to the empty square, or swipe toward the gap. Arrow keys slide the gap. Enter or Space activates a focused tile.");
  hint.id = hintId;

  const boardWrap = el("div", "fp-board-wrap");
  const board = el("div", "fp-board");
  board.setAttribute("role", "group");
  board.setAttribute("aria-label", `Fifteen Puzzle board, ${GRID_SIZE} rows by ${GRID_SIZE} columns`);
  board.setAttribute("aria-describedby", hintId);

  const tileButtons = [];
  for (let index = 0; index < TILE_COUNT; index += 1) {
    const button = el("button", "fp-tile");
    button.type = "button";
    button.dataset.index = String(index);
    button.tabIndex = index === 0 ? 0 : -1;
    button.setAttribute("aria-keyshortcuts", "Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight");
    board.append(button);
    tileButtons.push(button);
  }
  boardWrap.append(board);

  root.append(topbar, status, controls, hint, boardWrap);
  container.replaceChildren(root);

  function syncTabStops() {
    for (const button of tileButtons) {
      button.tabIndex = Number(button.dataset.index) === focusIndex ? 0 : -1;
    }
  }

  function setActiveIndex(index, moveFocus = true) {
    focusIndex = index;
    syncTabStops();
    if (moveFocus) {
      try { tileButtons[index].focus({ preventScroll: true }); } catch { tileButtons[index].focus(); }
    }
  }

  function tick() {
    elapsed = Math.floor((Date.now() - startedAt) / 1000);
    timer.textContent = formatTime(elapsed);
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

  function render(state) {
    root.dataset.phase = state.phase;
    status.dataset.phase = state.phase;
    moves.textContent = `${state.moves} move${state.moves === 1 ? "" : "s"}`;
    for (const button of tileButtons) {
      const index = Number(button.dataset.index);
      const value = state.tiles[index];
      const { row, col } = indexToPosition(index);
      button.className = "fp-tile";
      if (value === 0) {
        button.classList.add("fp-tile--blank");
        button.textContent = "";
        button.setAttribute("aria-label", `Empty square, row ${row + 1}, column ${col + 1}`);
      } else {
        button.textContent = String(value);
        if (value % 5 === 0) button.classList.add("fp-tile--accent");
        button.setAttribute("aria-label", `Tile ${value}, row ${row + 1}, column ${col + 1}`);
      }
    }
    syncTabStops();
  }

  function announce(kind, state) {
    if (state.phase === "won") {
      status.textContent = `Solved in ${state.moves} move${state.moves === 1 ? "" : "s"} and ${formatTime(elapsed)}. Press New game or R to play again.`;
      return;
    }
    if (kind === "blocked") {
      status.textContent = "That tile cannot slide — choose one beside the empty square.";
      return;
    }
    if (kind === "restart") {
      status.textContent = "New game. Slide a tile next to the empty square to begin.";
      return;
    }
    status.textContent = `${state.moves} move${state.moves === 1 ? "" : "s"} made. Keep sliding toward the ordered board.`;
  }

  function runSlide(action, kind) {
    if (disposed) return;
    const before = game.getState();
    let state;
    try {
      state = action();
    } catch {
      status.textContent = "That move is not allowed.";
      return;
    }
    if (state === before) {
      if (before.phase !== "won") announce("blocked", before);
      return;
    }
    if (before.moves === 0 && state.moves === 1) startTimer();
    focusIndex = before.blankIndex;
    if (state.phase === "won") stopTimer();
    render(state);
    announce(kind, state);
  }

  function resetGame() {
    if (disposed) return;
    stopTimer();
    elapsed = 0;
    timer.textContent = "0:00";
    const state = game.restart();
    focusIndex = state.blankIndex;
    render(state);
    announce("restart", state);
  }

  function onBoardClick(event) {
    if (disposed || Date.now() < suppressClickUntil) return;
    const button = event.target instanceof Element ? event.target.closest("button.fp-tile") : null;
    if (!button || !board.contains(button)) return;
    const index = Number(button.dataset.index);
    focusIndex = index;
    runSlide(() => game.moveTile(index), "tile");
  }

  function onTouchStart(event) {
    if (disposed || event.touches.length !== 1) return;
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event) {
    if (disposed || !touchStart) return;
    const touch = event.changedTouches[0];
    const start = touchStart;
    touchStart = null;
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
    suppressClickUntil = Date.now() + 400;
    const direction = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? "right" : "left")
      : (dy > 0 ? "down" : "up");
    runSlide(() => game.moveBlank(direction), "swipe");
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
    const tileButton = target instanceof Element ? target.closest("button.fp-tile") : null;
    const direction = ARROWS[event.key];
    if (direction) {
      if (!tileButton || !board.contains(tileButton)) return;
      event.preventDefault();
      runSlide(() => game.moveBlank(direction), "gap");
      return;
    }
    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      resetGame();
    }
  }

  board.addEventListener("click", onBoardClick);
  board.addEventListener("touchstart", onTouchStart, { passive: true });
  board.addEventListener("touchend", onTouchEnd, { passive: true });
  root.addEventListener("keydown", onKeyDown);
  reset.addEventListener("click", resetGame);
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopTimer();
    signal?.removeEventListener?.("abort", onAbort);
    board.removeEventListener("click", onBoardClick);
    board.removeEventListener("touchstart", onTouchStart);
    board.removeEventListener("touchend", onTouchEnd);
    root.removeEventListener("keydown", onKeyDown);
    reset.removeEventListener("click", resetGame);
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
