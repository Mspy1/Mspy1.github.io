/**
 * Fifteen Puzzle model — pure, dependency-free, no DOM and no timers.
 *
 * A 4x4 board holds tiles 1..15 plus one empty square (value 0), ordered as
 * [1..15, 0] when solved. The UI renders the frozen snapshot from `getState()`
 * and forwards a tile position or a blank direction into the actions below.
 *
 * Shuffling never chooses a random permutation: it starts solved and performs
 * a bounded number of random *legal* slides, declining to undo the previous
 * slide. Every resulting board is therefore solvable by construction. An
 * optional fixed `tiles` layout is validated for deterministic tests and is
 * rejected with a RangeError when its parity makes it unwinnable: solvability
 * is enforced on every construction path, never merely reported in `solvable`.
 *
 * Win is detected whenever the tiles return to ordered form, including a board
 * created already solved. Terminal boards ignore play actions until `restart()`.
 *
 * Inject `random: () => number` (uniform [0,1)) for deterministic boards. Both
 * the RNG type and each sampled value are validated; a malformed value throws
 * before any mutation instead of looping forever.
 */

export const GRID_SIZE = 4;
export const TILE_COUNT = GRID_SIZE * GRID_SIZE;
export const DEFAULT_SHUFFLE_MOVES = 80;
export const SOLVED_TILES = Object.freeze(
  Array.from({ length: TILE_COUNT }, (_, index) => (index === TILE_COUNT - 1 ? 0 : index + 1)),
);

const DIRECTIONS = Object.freeze({ up: "up", down: "down", left: "left", right: "right" });
const MAX_SHUFFLE_MOVES = 10_000;

function requireObject(value, label) {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

/** Validate a full permutation of 0..15 and return a private copy. */
export function validateTiles(tiles, label = "tiles") {
  if (!Array.isArray(tiles) || tiles.length !== TILE_COUNT) {
    throw new TypeError(`${label} must be an array of ${TILE_COUNT} tiles`);
  }
  const seen = new Set();
  for (const value of tiles) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= TILE_COUNT) {
      throw new RangeError(`${label} must contain integers from 0 to ${TILE_COUNT - 1}`);
    }
    if (seen.has(value)) throw new RangeError(`${label} contains duplicate tile ${value}`);
    seen.add(value);
  }
  return tiles.slice();
}

function validateRandomValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("random must return a finite number in [0,1)");
  }
  return value;
}

/** Accept a linear index or a { row, col } position; always return a valid index. */
export function positionToIndex(position) {
  if (typeof position === "number") {
    if (!Number.isFinite(position)) throw new TypeError("position must be a finite number or { row, col }");
    if (!Number.isInteger(position)) throw new RangeError("linear position must be an integer");
    if (position < 0 || position >= TILE_COUNT) {
      throw new RangeError(`linear position must be from 0 to ${TILE_COUNT - 1}`);
    }
    return position;
  }
  const target = requireObject(position, "position");
  const { row, col } = target;
  if (typeof row !== "number" || typeof col !== "number" ||
      !Number.isFinite(row) || !Number.isFinite(col)) {
    throw new TypeError("position needs finite numeric row and col");
  }
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    throw new RangeError("row and col must be integers");
  }
  if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) {
    throw new RangeError(`row/col must be inside ${GRID_SIZE}×${GRID_SIZE}`);
  }
  return row * GRID_SIZE + col;
}

/** Inverse of positionToIndex for rendering and keyboard navigation. */
export function indexToPosition(index) {
  const normalized = positionToIndex(index);
  return Object.freeze({
    row: Math.floor(normalized / GRID_SIZE),
    col: normalized % GRID_SIZE,
  });
}

function adjacentIndices(tiles, blankIndex) {
  const blank = positionToIndex(blankIndex);
  const { row, col } = indexToPosition(blank);
  // `tiles` is only read for its validated length/shape at the call sites.
  if (!Array.isArray(tiles) || tiles.length !== TILE_COUNT) {
    throw new TypeError("tiles must be a full board");
  }
  const result = [];
  if (row > 0) result.push(blank - GRID_SIZE);
  if (row < GRID_SIZE - 1) result.push(blank + GRID_SIZE);
  if (col > 0) result.push(blank - 1);
  if (col < GRID_SIZE - 1) result.push(blank + 1);
  return result;
}

/** Tile positions that can currently slide into the gap, frozen and unique. */
export function legalMoves(tiles) {
  const list = validateTiles(tiles);
  return Object.freeze(adjacentIndices(list, list.indexOf(0)));
}

export function isSolved(tiles) {
  const list = validateTiles(tiles);
  return list.every((value, index) => value === SOLVED_TILES[index]);
}

/**
 * Even-width grid rule: with the blank row counted from the bottom (1-based),
 * a layout is solvable exactly when inversions + blank row from bottom is odd.
 */
export function isSolvable(tiles) {
  const list = validateTiles(tiles);
  let inversions = 0;
  for (let i = 0; i < TILE_COUNT; i += 1) {
    if (list[i] === 0) continue;
    for (let j = i + 1; j < TILE_COUNT; j += 1) {
      if (list[j] !== 0 && list[i] > list[j]) inversions += 1;
    }
  }
  const blankRowFromBottom = GRID_SIZE - Math.floor(list.indexOf(0) / GRID_SIZE);
  return (inversions + blankRowFromBottom) % 2 === 1;
}

/** Shape-valid is not enough: reject parity-impossible boards before play begins. */
function requireSolvable(tiles, label) {
  const list = validateTiles(tiles, label);
  if (!isSolvable(list)) {
    throw new RangeError(`${label} must be a solvable ${GRID_SIZE}×${GRID_SIZE} layout (wrong inversion/blank-row parity)`);
  }
  return list;
}

export function createFifteenPuzzle(options = {}) {
  const config = requireObject(options, "Fifteen puzzle options");
  const random = config.random === undefined ? Math.random : config.random;
  if (typeof random !== "function") throw new TypeError("random must be a function returning [0,1)");
  validateRandomValue(random());

  const shuffleMoves = config.shuffleMoves === undefined ? DEFAULT_SHUFFLE_MOVES : config.shuffleMoves;
  if (!Number.isInteger(shuffleMoves) || shuffleMoves < 0 || shuffleMoves > MAX_SHUFFLE_MOVES) {
    throw new RangeError(`shuffleMoves must be an integer from 0 to ${MAX_SHUFFLE_MOVES}`);
  }
  // Reject an unwinnable injected layout before any game state is created.
  const fixed = config.tiles === undefined ? null : requireSolvable(config.tiles, "tiles");

  let tiles = [];
  let moves = 0;
  let phase = "playing";
  let cache = null;

  const getState = () => {
    if (cache) return cache;
    cache = Object.freeze({
      size: GRID_SIZE,
      tiles: Object.freeze(tiles.slice()),
      blankIndex: tiles.indexOf(0),
      moves,
      phase,
      solvable: isSolvable(tiles),
    });
    return cache;
  };

  const applyLayout = (layout) => {
    // Defense in depth: every start/restart path installs a winnable board.
    tiles = requireSolvable(layout, "layout");
    moves = 0;
    phase = isSolved(tiles) ? "won" : "playing";
    cache = null;
  };

  /** Start solved, then only ever slide a legal tile: solvability is guaranteed. */
  const shuffle = () => {
    const next = [...SOLVED_TILES];
    let previousBlank = -1;
    for (let step = 0; step < shuffleMoves; step += 1) {
      const blank = next.indexOf(0);
      const candidates = adjacentIndices(next, blank).filter((index) => index !== previousBlank);
      const value = validateRandomValue(random());
      const choice = candidates[Math.floor(value * candidates.length)];
      if (choice === undefined) throw new RangeError("no legal slide is available while shuffling");
      next[blank] = next[choice];
      next[choice] = 0;
      previousBlank = blank;
    }
    // Legal slides preserve parity; assert the invariant before publishing it.
    if (!isSolvable(next)) throw new RangeError("shuffle produced an unsolvable layout");
    return next;
  };

  const initialize = () => applyLayout(fixed || shuffle());
  initialize();

  const moveTile = (position) => {
    const index = positionToIndex(position);
    if (phase === "won") return getState();
    const blank = tiles.indexOf(0);
    if (!adjacentIndices(tiles, blank).includes(index)) return getState();
    tiles[blank] = tiles[index];
    tiles[index] = 0;
    moves += 1;
    if (isSolved(tiles)) {
      phase = "won";
    }
    cache = null;
    return getState();
  };

  const moveBlank = (direction) => {
    if (typeof direction !== "string" || !Object.hasOwn(DIRECTIONS, direction)) {
      throw new TypeError("direction must be one of up, down, left, right");
    }
    const { row, col } = indexToPosition(tiles.indexOf(0));
    let nextRow = row;
    let nextCol = col;
    if (direction === DIRECTIONS.up) nextRow -= 1;
    else if (direction === DIRECTIONS.down) nextRow += 1;
    else if (direction === DIRECTIONS.left) nextCol -= 1;
    else nextCol += 1;
    if (nextRow < 0 || nextRow >= GRID_SIZE || nextCol < 0 || nextCol >= GRID_SIZE) {
      return getState();
    }
    return moveTile(nextRow * GRID_SIZE + nextCol);
  };

  const getLegalMoves = () => legalMoves(tiles);
  const restart = () => {
    initialize();
    return getState();
  };

  return Object.freeze({
    getState,
    moveTile,
    moveBlank,
    legalMoves: getLegalMoves,
    restart,
  });
}

export default {
  GRID_SIZE,
  TILE_COUNT,
  SOLVED_TILES,
  createFifteenPuzzle,
};
