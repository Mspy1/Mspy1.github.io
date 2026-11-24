/* Snake UI: an accessible grid surface over the real pure engine.
   Original game visuals, no global listeners, no untrusted markup. Every move,
   turn, pause and wrap goes through snake-engine.mjs; the module only renders
   frozen snapshots, binds scoped input, owns the clock and announces results. */
import { createSnake } from "./snake-engine.mjs";

const WIDTH = 15;
const HEIGHT = 15;
const CELL_COUNT = WIDTH * HEIGHT;
const DEFAULT_TICK_MS = 150;

const READY_HINT = "Press Start or Space to play. Steer with arrow keys or WASD, or tap the direction pad.";
let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const KEY_TO_DIRECTION = Object.freeze({
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
});

export async function mount({ container, windowId, fileId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Snake needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Snake window was closed while loading", "AbortError");
  }

  const configured = Number(services?.snakeTickMs);
  const tickMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TICK_MS;
  const game = createSnake({ width: WIDTH, height: HEIGHT, random: Math.random });
  const uid = `snake-${++instanceCount}`;
  let disposed = false;
  let timerId = null;
  let ticks = 0;

  const root = el("div", "snake-app");
  root.dataset.windowId = windowId || "";
  root.dataset.phase = "ready";
  root.dataset.direction = "right";
  root.dataset.pendingDirection = "right";
  root.dataset.head = "";
  root.dataset.score = "0";
  root.dataset.tick = "0";
  root.dataset.wrap = "false";
  root.tabIndex = -1;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Snake");

  const topbar = el("div", "snake-topbar");
  const brand = el("div", "snake-brand");
  const title = el("h1", "snake-title", "Snake");
  title.id = `${uid}-title`;
  const heading = el("span", "snake-heading", `${WIDTH} × ${HEIGHT} grid`);
  brand.append(title, heading);
  const hud = el("div", "snake-hud");
  const score = el("span", "snake-score", "Score 0");
  const length = el("span", "snake-length", "Length 3");
  hud.append(score, length);
  topbar.append(brand, hud);

  const message = el("p", "snake-message", READY_HINT);
  message.dataset.phase = "ready";
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  message.setAttribute("aria-atomic", "true");

  const controls = el("div", "snake-controls");
  const start = el("button", "snake-button snake-start", "Start");
  start.type = "button";
  start.setAttribute("aria-keyshortcuts", "Space");
  const restart = el("button", "snake-button snake-restart", "Restart");
  restart.type = "button";
  restart.setAttribute("aria-keyshortcuts", "R");
  const wrap = el("button", "snake-button snake-wrap", "Wrap: off");
  wrap.type = "button";
  wrap.setAttribute("aria-pressed", "false");
  controls.append(start, restart, wrap);

  const hintId = `${uid}-hint`;
  const hint = el("p", "snake-hint",
    "Arrows or WASD steer. Space pauses and resumes. R restarts. Wrap lets the snake cross the edges.");
  hint.id = hintId;

  const playfield = el("div", "snake-playfield");
  const board = el("div", "snake-board");
  board.setAttribute("role", "img");
  board.setAttribute("aria-label", "Snake game board");
  board.setAttribute("aria-describedby", hintId);
  const cellNodes = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const cell = el("div", "snake-cell");
    cell.dataset.index = String(index);
    cell.setAttribute("aria-hidden", "true");
    board.append(cell);
    cellNodes.push(cell);
  }
  playfield.append(board);

  const pad = el("div", "snake-pad");
  pad.setAttribute("role", "group");
  pad.setAttribute("aria-label", "Direction pad");
  const padSpecs = [
    ["up", "▲", "Turn up", "snake-pad-up"],
    ["left", "◀", "Turn left", "snake-pad-left"],
    ["down", "▼", "Turn down", "snake-pad-down"],
    ["right", "▶", "Turn right", "snake-pad-right"],
  ];
  const padButtons = [];
  for (const [direction, glyph, label, className] of padSpecs) {
    const button = el("button", `snake-pad-btn ${className}`, glyph);
    button.type = "button";
    button.dataset.direction = direction;
    button.setAttribute("aria-label", label);
    pad.append(button);
    padButtons.push(button);
  }
  playfield.append(pad);

  root.append(topbar, message, controls, hint, playfield);
  container.replaceChildren(root);

  function stopTimer() {
    if (timerId === null) return;
    clearInterval(timerId);
    timerId = null;
  }
  function startTimer() {
    if (timerId !== null) return;
    timerId = setInterval(onTick, tickMs);
  }
  function resetTicks() {
    ticks = 0;
    root.dataset.tick = "0";
  }

  function render(state) {
    const headCell = state.snake[0];
    root.dataset.phase = state.phase;
    root.dataset.direction = state.direction;
    root.dataset.pendingDirection = state.pendingDirection;
    root.dataset.head = `${headCell.x},${headCell.y}`;
    root.dataset.score = String(state.score);
    root.dataset.wrap = String(state.wrap);
    message.dataset.phase = state.phase;
    score.textContent = `Score ${state.score}`;
    length.textContent = `Length ${state.length}`;
    start.textContent = state.phase === "playing" ? "Pause"
      : state.phase === "paused" ? "Resume"
        : state.phase === "over" ? "Play again" : "Start";

    const body = new Set(state.snake.map((segment) => segment.y * WIDTH + segment.x));
    const headIndex = headCell.y * WIDTH + headCell.x;
    const foodIndex = state.food ? state.food.y * WIDTH + state.food.x : -1;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      let className = "snake-cell";
      if (index === foodIndex) className += " snake-cell--food";
      if (body.has(index)) className += " snake-cell--body";
      if (index === headIndex) className += " snake-cell--head";
      if (cellNodes[index].className !== className) cellNodes[index].className = className;
    }
    board.setAttribute("aria-label",
      `Snake board. Score ${state.score}, length ${state.length}. ${state.phase}.`);
  }

  function announce(state) {
    if (state.phase === "over") {
      const reason = state.reason === "win" ? "You filled the board and won!"
        : state.reason === "self" ? "You ran into yourself."
          : "You hit the wall.";
      message.textContent = `${reason} Final score ${state.score}. Press Restart or R to play again.`;
    } else if (state.phase === "paused") {
      message.textContent = "Paused. Press Space to resume.";
    } else if (state.phase === "ready") {
      message.textContent = READY_HINT;
    } else if (state.score > 0) {
      message.textContent = `Food eaten. Score ${state.score}, length ${state.length}.`;
    } else {
      message.textContent = "Snake is moving. Keep it on the board and away from its tail.";
    }
  }

  function apply(state) {
    render(state);
    announce(state);
  }

  function onTick() {
    if (disposed) return;
    const before = game.getState();
    const state = game.step();
    if (state === before) return;
    ticks += 1;
    root.dataset.tick = String(ticks);
    if (state.phase === "over") stopTimer();
    render(state);
    if (state.phase === "over") announce(state);
  }

  function startPause() {
    if (disposed) return;
    const phase = game.getState().phase;
    if (phase === "over") {
      stopTimer();
      resetTicks();
      apply(game.reset());
      apply(game.start());
      startTimer();
      return;
    }
    if (phase === "paused") {
      apply(game.resume());
      startTimer();
      return;
    }
    if (phase === "ready") {
      resetTicks();
      apply(game.start());
      startTimer();
      return;
    }
    stopTimer();
    apply(game.pause());
  }

  function restartGame() {
    if (disposed) return;
    stopTimer();
    resetTicks();
    apply(game.reset());
    apply(game.start());
    startTimer();
  }

  function turn(direction) {
    if (disposed) return;
    const before = game.getState();
    const state = game.turn(direction);
    if (state === before) return;
    render(state);
  }

  function toggleWrap() {
    if (disposed) return;
    const state = game.setWrap(!game.getState().wrap);
    wrap.textContent = `Wrap: ${state.wrap ? "on" : "off"}`;
    wrap.setAttribute("aria-pressed", String(state.wrap));
    render(state);
    message.textContent = `Wrap mode ${state.wrap ? "on: the snake crosses the edges." : "off: the edges are walls."}`;
  }

  function onKeyDown(event) {
    if (disposed || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof Element &&
        target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
    if (KEY_TO_DIRECTION[event.key]) {
      event.preventDefault();
      turn(KEY_TO_DIRECTION[event.key]);
      return;
    }
    const lower = typeof event.key === "string" ? event.key.toLowerCase() : "";
    if (event.key === " " || lower === "spacebar") {
      event.preventDefault();
      startPause();
    } else if (lower === "r") {
      event.preventDefault();
      restartGame();
    }
  }

  function onPadClick(event) {
    const button = event.target instanceof Element ? event.target.closest("button.snake-pad-btn") : null;
    if (!button || !pad.contains(button)) return;
    turn(button.dataset.direction);
  }

  start.addEventListener("click", startPause);
  restart.addEventListener("click", restartGame);
  wrap.addEventListener("click", toggleWrap);
  pad.addEventListener("click", onPadClick);
  root.addEventListener("keydown", onKeyDown);
  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopTimer();
    signal?.removeEventListener?.("abort", onAbort);
    start.removeEventListener("click", startPause);
    restart.removeEventListener("click", restartGame);
    wrap.removeEventListener("click", toggleWrap);
    pad.removeEventListener("click", onPadClick);
    root.removeEventListener("keydown", onKeyDown);
    root.remove();
  }

  render(game.getState());

  return {
    canClose: () => true,
    focus() {
      if (disposed) return;
      try { root.focus({ preventScroll: true }); } catch { root.focus(); }
    },
    dispose,
  };
}

export default { mount };
