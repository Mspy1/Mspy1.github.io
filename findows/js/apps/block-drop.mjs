/* Block Drop UI: an accessible falling-tetromino surface over the real pure engine.
   Original visuals, no global listeners, no untrusted markup, no audio and no
   network. The engine owns every rule; this module owns the clock, focus, key
   bindings, touch buttons, announcements and rendering of frozen snapshots. */
import { BOARD_HEIGHT, BOARD_WIDTH, PIECES, createBlockDrop } from "./block-drop-engine.mjs";

const CELL_COUNT = BOARD_WIDTH * BOARD_HEIGHT;
const INTRO = "Arrow keys move and soft drop, Up or X rotates, Z rotates back, Space drops. P pauses, R restarts.";
const BASE_GRAVITY = 850;
const MIN_GRAVITY = 110;
let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function gravityFor(level) {
  return Math.max(MIN_GRAVITY, BASE_GRAVITY - (level - 1) * 70);
}

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Block Drop needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Block Drop window was closed while loading", "AbortError");
  }
  void fileId;
  void services;

  const game = createBlockDrop();
  const uid = `bd-${++instanceCount}`;
  let disposed = false;
  let timerId = null;

  const root = el("div", "bd-app");
  root.dataset.windowId = windowId || "";
  root.dataset.phase = "ready";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Block Drop");

  const topbar = el("div", "bd-topbar");
  const brand = el("div", "bd-brand");
  const title = el("h1", "bd-title", "Block Drop");
  title.id = `${uid}-title`;
  const subtitle = el("span", "bd-subtitle", "10 × 20 well · seven-bag pieces");
  brand.append(title, subtitle);
  const hud = el("div", "bd-hud");
  const scoreEl = el("span", "bd-chip bd-score", "0 pts");
  const linesEl = el("span", "bd-chip bd-lines", "0 lines");
  const levelEl = el("span", "bd-chip bd-level", "Level 1");
  hud.append(scoreEl, linesEl, levelEl);
  topbar.append(brand, hud);

  const message = el("p", "bd-message", INTRO);
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");

  const main = el("div", "bd-main");
  const well = el("div", "bd-well");
  const stage = el("div", "bd-stage");
  stage.tabIndex = 0;
  stage.setAttribute("role", "group");
  stage.setAttribute("aria-label", `Block Drop well, ${BOARD_WIDTH} columns by ${BOARD_HEIGHT} rows`);
  stage.setAttribute("aria-describedby", `${uid}-hint`);
  const overlay = el("div", "bd-overlay");
  const overlayTitle = el("strong", "bd-overlay-title", "Paused");
  const overlayText = el("span", "bd-overlay-text", "Press P or Resume to continue.");
  overlay.append(overlayTitle, overlayText);
  overlay.setAttribute("aria-hidden", "true");
  well.append(stage, overlay);

  const side = el("div", "bd-side");
  const nextLabel = el("span", "bd-next-label", "Next");
  const preview = el("div", "bd-preview");
  preview.setAttribute("role", "img");
  preview.setAttribute("aria-label", "Next piece");
  const previewCells = [];
  for (let index = 0; index < 16; index += 1) {
    const cell = el("div", "bd-preview-cell");
    preview.append(cell);
    previewCells.push(cell);
  }
  const badge = el("span", "bd-badge", "Offline · silent");
  side.append(nextLabel, preview, badge);
  main.append(well, side);

  const controls = el("div", "bd-controls");
  const pad = el("div", "bd-pad");
  pad.setAttribute("role", "group");
  pad.setAttribute("aria-label", "Touch controls");
  const PAD_BUTTONS = [
    ["left", "←", "Move left"],
    ["rotate", "↻", "Rotate"],
    ["right", "→", "Move right"],
    ["soft", "↓", "Soft drop"],
    ["drop", "⇣", "Hard drop"],
  ];
  const padButtons = new Map();
  for (const [action, glyph, label] of PAD_BUTTONS) {
    const button = el("button", "bd-pad-btn", glyph);
    button.type = "button";
    button.dataset.action = action;
    button.setAttribute("aria-label", label);
    pad.append(button);
    padButtons.set(action, button);
  }
  const pause = el("button", "bd-button bd-pause", "Pause");
  pause.type = "button";
  pause.setAttribute("aria-pressed", "false");
  pause.setAttribute("aria-keyshortcuts", "P");
  const restartBtn = el("button", "bd-button bd-restart", "New game");
  restartBtn.type = "button";
  restartBtn.setAttribute("aria-keyshortcuts", "R");
  controls.append(pad, pause, restartBtn);

  const hint = el("p", "bd-hint", INTRO);
  hint.id = `${uid}-hint`;
  root.append(topbar, message, main, controls, hint);
  container.replaceChildren(root);

  const cells = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const cell = el("div", "bd-cell");
    cell.dataset.index = String(index);
    stage.append(cell);
    cells.push(cell);
  }

  function announce(before, after, kind) {
    if (after.phase === "over") {
      message.textContent = `Game over — ${after.score} points, ${after.lines} lines. Press New game or R to try again.`;
      return;
    }
    if (after.lastClear > 0) {
      message.textContent = `Cleared ${after.lastClear} line${after.lastClear === 1 ? "" : "s"}! ` +
        `${after.score - before.score} points gained.`;
      return;
    }
    if (before.phase === "paused" && after.phase === "playing") {
      message.textContent = "Resumed. Keep the well tidy.";
      return;
    }
    if (kind === "hard") {
      message.textContent = "Dropped to the floor.";
    } else if (kind === "soft") {
      message.textContent = "Soft drop: one point per row.";
    }
  }

  function render(state) {
    root.dataset.phase = state.phase;
    root.dataset.score = String(state.score);
    root.dataset.lines = String(state.lines);
    root.dataset.level = String(state.level);
    root.dataset.piece = state.piece ? state.piece.type : "";
    root.dataset.rotation = String(state.piece ? state.piece.rotation : -1);
    root.dataset.x = String(state.piece ? state.piece.x : -1);
    root.dataset.y = String(state.piece ? state.piece.y : -1);
    scoreEl.textContent = `${state.score} pts`;
    linesEl.textContent = `${state.lines} lines`;
    levelEl.textContent = `Level ${state.level}`;

    const active = new Set();
    const ghost = new Set();
    if (state.piece) {
      for (const [dx, dy] of state.piece.cells) {
        active.add((state.piece.y + dy) * BOARD_WIDTH + state.piece.x + dx);
        ghost.add((state.ghostY + dy) * BOARD_WIDTH + state.piece.x + dx);
      }
    }
    for (let index = 0; index < CELL_COUNT; index += 1) {
      let className = "bd-cell";
      const row = Math.floor(index / BOARD_WIDTH);
      const col = index % BOARD_WIDTH;
      const locked = state.board[row][col];
      if (locked) {
        className += ` bd-cell--locked bd-piece-${locked.toLowerCase()}`;
      } else if (active.has(index)) {
        className += ` bd-cell--active bd-piece-${state.piece.type.toLowerCase()}`;
      } else if (ghost.has(index)) {
        className += " bd-cell--ghost";
      }
      cells[index].className = className;
    }

    for (const cell of previewCells) cell.className = "bd-preview-cell";
    if (state.next) {
      const shape = PIECES[state.next][0];
      const size = state.next === "I" ? 4 : state.next === "O" ? 2 : 3;
      const offset = Math.floor((4 - size) / 2);
      for (const [dx, dy] of shape) {
        const index = (dy + offset) * 4 + dx + offset;
        if (previewCells[index]) {
          previewCells[index].className = `bd-preview-cell bd-preview-cell--on bd-piece-${state.next.toLowerCase()}`;
        }
      }
      preview.setAttribute("aria-label", `Next piece: ${state.next}`);
    }

    const paused = state.phase === "paused";
    const over = state.phase === "over";
    overlayTitle.textContent = paused ? "Paused" : over ? "Game over" : "";
    overlayText.textContent = paused
      ? "Press P or Resume to continue."
      : over ? "Press New game or R to play again." : "";
    overlay.setAttribute("aria-hidden", String(!paused && !over));
    pause.textContent = paused ? "Resume" : "Pause";
    pause.setAttribute("aria-pressed", String(paused));
  }

  function stopLoop() {
    if (timerId === null) return;
    clearInterval(timerId);
    timerId = null;
  }
  function startLoop() {
    stopLoop();
    if (disposed || game.getState().phase !== "playing") return;
    timerId = setInterval(tick, gravityFor(game.getState().level));
  }
  function tick() {
    if (disposed) return;
    const before = game.getState();
    const after = game.step();
    if (after.level !== before.level) startLoop();
    render(after);
    if (after.phase === "over") {
      stopLoop();
      announce(before, after, "step");
    }
  }

  function act(action, kind) {
    if (disposed) return;
    const before = game.getState();
    const after = action();
    render(after);
    announce(before, after, kind);
    if (after.phase === "over") stopLoop();
    if (after.phase === "playing" && timerId === null) startLoop();
  }

  function togglePause() {
    if (disposed) return;
    const before = game.getState();
    if (before.phase === "playing") {
      game.pause();
      stopLoop();
    } else if (before.phase === "paused") {
      game.resume();
      startLoop();
    }
    const after = game.getState();
    render(after);
    announce(before, after, "pause");
  }

  function restart() {
    if (disposed) return;
    stopLoop();
    game.reset();
    game.start();
    render(game.getState());
    startLoop();
    message.textContent = "New game. Fill rows to clear them and score.";
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element) || !root.contains(target)) return;
    if (target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
    const button = target.closest("button");
    const key = event.key;
    if (button && (key === " " || key === "Enter")) return;
    if (key === "ArrowLeft") act(() => game.moveLeft(), "move");
    else if (key === "ArrowRight") act(() => game.moveRight(), "move");
    else if (key === "ArrowDown") act(() => game.softDrop(), "soft");
    else if (key === "ArrowUp" || key.toLowerCase() === "x") act(() => game.rotate(1), "rotate");
    else if (key.toLowerCase() === "z") act(() => game.rotate(-1), "rotate");
    else if (key === " ") act(() => game.hardDrop(), "hard");
    else if (key.toLowerCase() === "p") togglePause();
    else if (key.toLowerCase() === "r") restart();
    else return;
    event.preventDefault();
  }

  const padHandlers = new Map([
    ["left", () => act(() => game.moveLeft(), "move")],
    ["right", () => act(() => game.moveRight(), "move")],
    ["rotate", () => act(() => game.rotate(1), "rotate")],
    ["soft", () => act(() => game.softDrop(), "soft")],
    ["drop", () => act(() => game.hardDrop(), "hard")],
  ]);
  function onPadClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button.bd-pad-btn") : null;
    if (!button || !pad.contains(button)) return;
    padHandlers.get(button.dataset.action)?.();
  }

  root.addEventListener("keydown", onKeyDown);
  pad.addEventListener("click", onPadClick);
  pause.addEventListener("click", togglePause);
  restartBtn.addEventListener("click", restart);
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopLoop();
    signal?.removeEventListener?.("abort", onAbort);
    root.removeEventListener("keydown", onKeyDown);
    pad.removeEventListener("click", onPadClick);
    pause.removeEventListener("click", togglePause);
    restartBtn.removeEventListener("click", restart);
    root.remove();
  }

  game.start();
  render(game.getState());
  startLoop();

  return {
    canClose: () => true,
    focus() {
      if (disposed) return;
      try { stage.focus({ preventScroll: true }); } catch { stage.focus(); }
    },
    dispose,
  };
}

export default { mount };
