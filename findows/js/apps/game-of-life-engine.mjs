/**
 * Conway's Game of Life — pure, dependency-free world model.
 *
 * The UI owns visuals, timers, focus and announcements. This module owns only
 * the 20×14 cell grid, the generation clock, the wrap setting and the preset
 * catalog. Every action returns a cached, deeply frozen snapshot; snapshots
 * already handed out never change, so they can be retained for comparison.
 *
 * Rules (Moore neighborhood, eight neighbors): a dead cell with exactly three
 * live neighbors is born; a live cell with two or three neighbors survives;
 * every other live cell dies. With wrap=false the world has dead, bounded
 * edges; with wrap=true it is a torus. `stepCells` computes one generation
 * from any boolean cell array without mutating it.
 *
 * `random` is injectable for deterministic tests. A malformed or out-of-range
 * value is rejected before any board mutation.
 */

export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 14;
export const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;

/** Frozen, ordered catalog of the shipped still lifes, oscillators and ships. */
export const PRESETS = Object.freeze([
  "glider",
  "blinker",
  "toad",
  "beacon",
  "block",
  "beehive",
  "lightweight-spaceship",
  "pulsar",
]);

const PATTERNS = Object.freeze({
  glider: Object.freeze({ rows: Object.freeze([".O.", "..O", "OOO"]), origin: Object.freeze([2, 3]) }),
  blinker: Object.freeze({ rows: Object.freeze(["O", "O", "O"]), origin: Object.freeze([5, 9]) }),
  toad: Object.freeze({ rows: Object.freeze([".OOO", "OOO."]), origin: Object.freeze([5, 8]) }),
  beacon: Object.freeze({ rows: Object.freeze(["OO..", "OO..", "..OO", "..OO"]), origin: Object.freeze([4, 8]) }),
  block: Object.freeze({ rows: Object.freeze(["OO", "OO"]), origin: Object.freeze([5, 9]) }),
  beehive: Object.freeze({ rows: Object.freeze([".OO.", "O..O", ".OO."]), origin: Object.freeze([5, 8]) }),
  "lightweight-spaceship": Object.freeze({
    rows: Object.freeze([".OOOO", "O...O", "....O", "O..O."]),
    origin: Object.freeze([4, 7]),
  }),
  pulsar: Object.freeze({
    rows: Object.freeze([
      "..OOO...OOO..",
      ".............",
      "O....O.O....O",
      "O....O.O....O",
      "O....O.O....O",
      "..OOO...OOO..",
      ".............",
      "..OOO...OOO..",
      "O....O.O....O",
      "O....O.O....O",
      "O....O.O....O",
      ".............",
      "..OOO...OOO..",
    ]),
    origin: Object.freeze([0, 3]),
  }),
});

function requireObject(value, label) {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

/** Accept a linear index or { row, col }; validate before any mutation. */
export function positionToIndex(position) {
  if (typeof position === "number") {
    if (!Number.isFinite(position)) throw new TypeError("position must be a finite number or { row, col }");
    if (!Number.isInteger(position)) throw new RangeError("linear position must be an integer");
    if (position < 0 || position >= CELL_COUNT) {
      throw new RangeError(`linear position must be from 0 to ${CELL_COUNT - 1}`);
    }
    return position;
  }
  const target = requireObject(position, "position");
  const { row, col } = target;
  if (
    typeof row !== "number" || typeof col !== "number" ||
    !Number.isFinite(row) || !Number.isFinite(col)
  ) {
    throw new TypeError("position needs finite numeric row and col");
  }
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    throw new RangeError("row and col must be integers");
  }
  if (row < 0 || row >= GRID_HEIGHT || col < 0 || col >= GRID_WIDTH) {
    throw new RangeError(`row/col must be inside ${GRID_WIDTH}×${GRID_HEIGHT}`);
  }
  return row * GRID_WIDTH + col;
}

/** Frozen { row, col }; inverse of positionToIndex. */
export function indexToPosition(index) {
  const normalized = positionToIndex(index);
  return Object.freeze({
    row: Math.floor(normalized / GRID_WIDTH),
    col: normalized % GRID_WIDTH,
  });
}

/**
 * Up to eight orthogonal/diagonal neighbor indices. Bounded by default;
 * pass { wrap: true } for a toroidal world. The center is never included.
 */
export function neighborIndices(index, options = {}) {
  const normalized = positionToIndex(index);
  const config = requireObject(options, "neighbor options");
  const wrap = config.wrap === undefined ? false : config.wrap;
  if (typeof wrap !== "boolean") throw new TypeError("wrap must be a boolean");
  const row = Math.floor(normalized / GRID_WIDTH);
  const col = normalized % GRID_WIDTH;
  const result = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      let nextRow = row + dr;
      let nextCol = col + dc;
      if (wrap) {
        nextRow = (nextRow + GRID_HEIGHT) % GRID_HEIGHT;
        nextCol = (nextCol + GRID_WIDTH) % GRID_WIDTH;
      } else if (nextRow < 0 || nextRow >= GRID_HEIGHT || nextCol < 0 || nextCol >= GRID_WIDTH) {
        continue;
      }
      result.push(nextRow * GRID_WIDTH + nextCol);
    }
  }
  return Object.freeze(result);
}

/** One Conway generation from a boolean cell array; the input is never changed. */
export function stepCells(cells, width, height, wrap = false) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new TypeError("width and height must be positive integers");
  }
  if (typeof wrap !== "boolean") throw new TypeError("wrap must be a boolean");
  if (!Array.isArray(cells) || cells.length !== width * height) {
    throw new TypeError("cells must be an array matching width × height");
  }
  const next = new Array(cells.length);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      let neighbors = 0;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          let nr = row + dr;
          let nc = col + dc;
          if (wrap) {
            nr = (nr + height) % height;
            nc = (nc + width) % width;
          } else if (nr < 0 || nr >= height || nc < 0 || nc >= width) {
            continue;
          }
          if (cells[nr * width + nc]) neighbors += 1;
        }
      }
      const index = row * width + col;
      next[index] = cells[index] ? neighbors === 2 || neighbors === 3 : neighbors === 3;
    }
  }
  return Object.freeze(next);
}

const presetCache = new Map();

/** Absolute, frozen cell indices for a named preset. */
export function getPresetCells(name) {
  if (typeof name !== "string") throw new TypeError("preset name must be a string");
  if (!Object.hasOwn(PATTERNS, name)) throw new RangeError(`unknown preset: ${name}`);
  const cached = presetCache.get(name);
  if (cached) return cached;
  const { rows, origin } = PATTERNS[name];
  const [originRow, originCol] = origin;
  const indices = [];
  rows.forEach((line, rowOffset) => {
    for (let colOffset = 0; colOffset < line.length; colOffset += 1) {
      if (line[colOffset] !== "O") continue;
      const row = originRow + rowOffset;
      const col = originCol + colOffset;
      if (row < 0 || row >= GRID_HEIGHT || col < 0 || col >= GRID_WIDTH) {
        throw new RangeError(`preset ${name} does not fit the world`);
      }
      indices.push(row * GRID_WIDTH + col);
    }
  });
  const frozen = Object.freeze(indices);
  presetCache.set(name, frozen);
  return frozen;
}

export function createGameOfLife(options = {}) {
  const config = requireObject(options, "Game of Life options");
  const random = config.random === undefined ? Math.random : config.random;
  if (typeof random !== "function") throw new TypeError("random must be a function returning [0,1)");

  let cells = new Array(CELL_COUNT).fill(false);
  let generation = 0;
  let wrap = false;
  let preset = null;
  let cache = null;

  const invalidate = () => { cache = null; };

  const getState = () => {
    if (cache) return cache;
    let population = 0;
    for (const cell of cells) if (cell) population += 1;
    cache = Object.freeze({
      width: GRID_WIDTH,
      height: GRID_HEIGHT,
      generation,
      population,
      wrap,
      preset,
      cells: Object.freeze(cells.slice()),
    });
    return cache;
  };

  const setWrap = (value) => {
    if (typeof value !== "boolean") throw new TypeError("wrap must be a boolean");
    if (wrap === value) return getState();
    wrap = value;
    invalidate();
    return getState();
  };

  const toggleCell = (position) => {
    const index = positionToIndex(position);
    cells[index] = !cells[index];
    preset = null;
    invalidate();
    return getState();
  };

  const setCell = (position, alive) => {
    const index = positionToIndex(position);
    if (typeof alive !== "boolean") throw new TypeError("alive must be a boolean");
    if (cells[index] === alive) return getState();
    cells[index] = alive;
    preset = null;
    invalidate();
    return getState();
  };

  const clear = () => {
    cells = new Array(CELL_COUNT).fill(false);
    generation = 0;
    preset = null;
    invalidate();
    return getState();
  };

  const loadPreset = (name) => {
    const live = getPresetCells(name); // validate fully before touching the world
    const next = new Array(CELL_COUNT).fill(false);
    for (const index of live) next[index] = true;
    cells = next;
    generation = 0;
    preset = name;
    invalidate();
    return getState();
  };

  const randomize = (configOptions = {}) => {
    const settings = requireObject(configOptions, "randomize options");
    const density = settings.density === undefined ? 0.28 : settings.density;
    if (typeof density !== "number" || !Number.isFinite(density)) {
      throw new TypeError("density must be a finite number");
    }
    if (density <= 0 || density > 1) throw new RangeError("density must be greater than 0 and at most 1");
    // Sample everything first: an invalid RNG leaves the world untouched.
    const samples = new Array(CELL_COUNT);
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const value = random();
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
        throw new RangeError("random must return a finite number in [0,1)");
      }
      samples[index] = value <= density;
    }
    cells = samples;
    generation = 0;
    preset = null;
    invalidate();
    return getState();
  };

  const step = () => {
    cells = stepCells(cells, GRID_WIDTH, GRID_HEIGHT, wrap);
    generation += 1;
    invalidate();
    return getState();
  };

  const cellAt = (position) => getState().cells[positionToIndex(position)];

  return Object.freeze({
    getState,
    cellAt,
    setWrap,
    toggleCell,
    setCell,
    clear,
    loadPreset,
    randomize,
    step,
  });
}
