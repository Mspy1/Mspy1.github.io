/**
 * Snake grid model — pure, dependency-free, no DOM, no timers and no globals.
 *
 * The logic is a set of pure reducers over a frozen snapshot, plus a thin
 * stateful wrapper (`createSnake`) for the UI. Every reducer returns the same
 * state object when nothing changes, so callers can compare by identity. The UI
 * owns visuals, input bindings, focus, announcements and the clock; it renders
 * `getState()` and forwards `turn`/`step`/`pause`/`resume`/`setWrap`/`reset`.
 *
 * Coordinates are `{ x, y }` with x increasing right and y increasing down.
 * `snake` is head-first. Food is placed on a free cell with an injectable
 * `random: () => number` in [0,1), sampled over free cells in row-major order.
 *
 * Phases: ready → playing → (paused → playing)* → over. `over` also covers a
 * win (board filled) via `reason`. While `over`, every action except `reset`
 * is a locked no-op. A 180-degree turn is rejected, and the pending direction
 * is always validated against the committed direction so two rapid inputs in
 * one tick can never fold the snake back into itself.
 */

export const DIRECTIONS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});

const FOOD_POINTS = 10;
const DEFAULT_WIDTH = 15;
const DEFAULT_HEIGHT = 15;

function normalizeOptions(options) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("Snake options must be an object");
  }
  const width = options.width === undefined ? DEFAULT_WIDTH : options.width;
  const height = options.height === undefined ? DEFAULT_HEIGHT : options.height;
  const wrap = options.wrap === undefined ? false : options.wrap;
  const random = options.random === undefined ? Math.random : options.random;
  if (!Number.isInteger(width) || width < 3) throw new RangeError("width must be an integer of at least 3");
  if (!Number.isInteger(height) || height < 3) throw new RangeError("height must be an integer of at least 3");
  if (typeof wrap !== "boolean") throw new TypeError("wrap must be a boolean");
  if (typeof random !== "function") throw new TypeError("random must be a function returning [0,1)");
  return Object.freeze({ width, height, wrap, random });
}

function point(x, y) {
  return Object.freeze({ x, y });
}

function freezeState(state) {
  return Object.freeze({
    ...state,
    snake: Object.freeze(state.snake.map((segment) => point(segment.x, segment.y))),
    food: state.food ? point(state.food.x, state.food.y) : null,
  });
}

/** Pick a free cell (excluding the snake) using the injected uniform RNG. */
function placeFood(snake, config) {
  const occupied = new Set(snake.map((segment) => `${segment.x},${segment.y}`));
  const free = [];
  for (let y = 0; y < config.height; y += 1) {
    for (let x = 0; x < config.width; x += 1) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) return null;
  const value = config.random();
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("random must return a finite number in [0,1)");
  }
  const index = Math.min(Math.floor(value * free.length), free.length - 1);
  return free[index];
}

/** A fresh, ready game: centered body heading right, deterministic food. */
export function initialState(options = {}) {
  const config = normalizeOptions(options);
  const centerX = Math.floor(config.width / 2);
  const centerY = Math.floor(config.height / 2);
  const length = Math.min(3, centerX + 1);
  const snake = [];
  for (let offset = 0; offset < length; offset += 1) snake.push(point(centerX - offset, centerY));
  return freezeState({
    phase: "ready",
    width: config.width,
    height: config.height,
    wrap: config.wrap,
    snake,
    direction: "right",
    pendingDirection: "right",
    food: placeFood(snake, config),
    score: 0,
    length: snake.length,
    reason: null,
  });
}

export function resetState(options = {}) {
  return initialState(options);
}

export function startState(state) {
  if (state.phase !== "ready") return state;
  return freezeState({ ...state, phase: "playing" });
}

function isOpposite(a, b) {
  const left = DIRECTIONS[a];
  const right = DIRECTIONS[b];
  return Boolean(left && right && left.x === -right.x && left.y === -right.y);
}

/** Queue a 90-degree turn. Ready sets the heading directly; playing queues it. */
export function turnState(state, direction) {
  if (!DIRECTIONS[direction]) throw new RangeError(`unknown direction: ${String(direction)}`);
  if (state.phase === "over" || state.phase === "paused") return state;
  if (direction === state.direction || isOpposite(direction, state.direction)) return state;
  if (state.phase === "ready") {
    return freezeState({ ...state, direction, pendingDirection: direction });
  }
  if (direction === state.pendingDirection) return state;
  return freezeState({ ...state, pendingDirection: direction });
}

export function pauseState(state) {
  if (state.phase !== "playing") return state;
  return freezeState({ ...state, phase: "paused" });
}

export function resumeState(state) {
  if (state.phase !== "paused") return state;
  return freezeState({ ...state, phase: "playing" });
}

export function togglePauseState(state) {
  if (state.phase === "playing") return pauseState(state);
  if (state.phase === "paused") return resumeState(state);
  return state;
}

export function setWrapState(state, enabled) {
  if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean");
  if (state.phase === "over" || state.wrap === enabled) return state;
  return freezeState({ ...state, wrap: enabled });
}

function endState(state, reason) {
  return freezeState({ ...state, phase: "over", reason });
}

/** Advance a playing game by exactly one cell. */
export function advanceState(state, options = {}) {
  if (state.phase !== "playing") return state;
  const config = normalizeOptions(options);
  const direction = state.pendingDirection;
  const vector = DIRECTIONS[direction];
  let nextX = state.snake[0].x + vector.x;
  let nextY = state.snake[0].y + vector.y;

  if (state.wrap) {
    if (nextX < 0) nextX = state.width - 1;
    else if (nextX >= state.width) nextX = 0;
    if (nextY < 0) nextY = state.height - 1;
    else if (nextY >= state.height) nextY = 0;
  } else if (nextX < 0 || nextY < 0 || nextX >= state.width || nextY >= state.height) {
    return endState(state, "wall");
  }

  const eating = Boolean(state.food && state.food.x === nextX && state.food.y === nextY);
  // When not eating the tail vacates this tick, so entering its cell is legal.
  const body = eating ? state.snake : state.snake.slice(0, -1);
  if (body.some((segment) => segment.x === nextX && segment.y === nextY)) {
    return endState(state, "self");
  }

  const snake = [{ x: nextX, y: nextY }, ...state.snake];
  if (!eating) snake.pop();
  const score = state.score + (eating ? FOOD_POINTS : 0);

  if (snake.length === state.width * state.height) {
    return freezeState({
      ...state, phase: "over", reason: "win", snake, direction, pendingDirection: direction,
      food: null, score, length: snake.length,
    });
  }
  const food = eating ? placeFood(snake, config) : state.food;
  return freezeState({
    ...state, snake, food, score, length: snake.length, direction, pendingDirection: direction,
  });
}

/** Thin mutable facade over the pure reducers for the app module. */
export function createSnake(options = {}) {
  const config = normalizeOptions(options);
  const stepConfig = Object.freeze({
    width: config.width,
    height: config.height,
    wrap: config.wrap,
    random: config.random,
  });
  let state = initialState(config);
  const commit = (next) => {
    state = next;
    return state;
  };
  return Object.freeze({
    getState: () => state,
    start: () => commit(startState(state)),
    turn: (direction) => commit(turnState(state, direction)),
    step: () => commit(advanceState(state, stepConfig)),
    pause: () => commit(pauseState(state)),
    resume: () => commit(resumeState(state)),
    togglePause: () => commit(togglePauseState(state)),
    setWrap: (enabled) => {
      const next = setWrapState(state, enabled);
      state = next;
      return state;
    },
    reset: () => commit(initialState({ ...config, wrap: state.wrap })),
    restart: () => commit(initialState({ ...config, wrap: state.wrap })),
  });
}

export default {
  DIRECTIONS,
  initialState,
  resetState,
  startState,
  turnState,
  pauseState,
  resumeState,
  togglePauseState,
  setWrapState,
  advanceState,
  createSnake,
};
