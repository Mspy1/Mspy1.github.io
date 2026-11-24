/**
 * Nonogram (picross) model — pure, dependency-free, no DOM, no timers, no network.
 *
 * The UI renders the frozen snapshot from `getState()` and forwards row/col (or
 * linear index) positions into the documented actions. A blank line's clue is
 * conventionally [0]. The bundled puzzle is a 5×5 heart with a unique solution;
 * `makePuzzle()` derives row and column clues from any local `#`/`.` grid.
 *
 * Cell states are "empty", "filled" and "marked" (an X). Wrong fills are allowed
 * but counted as mistakes; a win requires every solution cell filled and no wrong
 * fill anywhere. Marks never count as fills, so marking a solution cell blocks the
 * win. Snapshots never expose the solution grid — only counts — so rendering the
 * state cannot leak answers to the player. Terminal phases ignore all play actions
 * until `reset()`.
 */

export const CELL_STATES = Object.freeze(["empty", "filled", "marked"]);

function requireObject(value, label) {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function toBits(value, label) {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  throw new TypeError(`${label} must be a boolean, 0 or 1`);
}

/** Run lengths of a line; an entirely blank line has the conventional clue [0]. */
export function cluesForLine(line) {
  if (!Array.isArray(line)) throw new TypeError("line must be an array");
  const runs = [];
  let run = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (toBits(line[index], `line[${index}]`)) {
      run += 1;
    } else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return Object.freeze(runs.length > 0 ? runs : [0]);
}

/** Build a validated, deeply frozen puzzle from an array of equal-length `#`/`.` strings. */
export function makePuzzle(options = {}) {
  const config = requireObject(options, "puzzle options");
  if (typeof config.id !== "string" || !config.id.trim()) throw new TypeError("puzzle id must be a non-empty string");
  if (typeof config.title !== "string" || !config.title.trim()) throw new TypeError("puzzle title must be a non-empty string");
  if (!Array.isArray(config.grid) || config.grid.length < 2 || config.grid.length > 10) {
    throw new RangeError("grid must be an array of 2 to 10 rows");
  }
  const size = config.grid.length;
  for (const row of config.grid) {
    if (typeof row !== "string" || row.length !== size || !/^[.#]+$/.test(row)) {
      throw new TypeError(`each grid row must be exactly ${size} characters of '#' and '.'`);
    }
  }
  const bits = config.grid.map((row) => [...row].map((char) => char === "#"));
  const solution = Object.freeze(bits.flat());
  const total = solution.filter(Boolean).length;
  if (total === 0) throw new RangeError("a puzzle needs at least one filled cell");
  const rows = Object.freeze(bits.map((row) => cluesForLine(row)));
  const columns = Object.freeze(
    Array.from({ length: size }, (_, col) => cluesForLine(Array.from({ length: size }, (_, row) => bits[row][col]))),
  );
  return Object.freeze({
    id: config.id,
    title: config.title,
    size,
    rows,
    columns,
    solution,
    total,
  });
}

const HEART_GRID = Object.freeze([
  ".#.#.",
  "#####",
  "#####",
  ".###.",
  "..#..",
]);

/** The shipped, locally generated puzzle: 16 filled cells, one unique solution. */
export const PUZZLE = makePuzzle({ id: "heart", title: "Little heart", grid: HEART_GRID });

function assertPuzzle(puzzle) {
  requireObject(puzzle, "puzzle");
  if (typeof puzzle.id !== "string" || !puzzle.id.trim() ||
      typeof puzzle.title !== "string" || !puzzle.title.trim()) {
    throw new TypeError("puzzle needs an id and a title");
  }
  if (!Number.isInteger(puzzle.size) || puzzle.size < 2 || puzzle.size > 10) {
    throw new RangeError("puzzle size must be an integer from 2 to 10");
  }
  const { size } = puzzle;
  if (!Array.isArray(puzzle.rows) || puzzle.rows.length !== size ||
      !Array.isArray(puzzle.columns) || puzzle.columns.length !== size) {
    throw new RangeError("puzzle needs one row and one column clue per line");
  }
  if (!Array.isArray(puzzle.solution) || puzzle.solution.length !== size * size ||
      !puzzle.solution.every((value) => typeof value === "boolean")) {
    throw new TypeError("puzzle solution must be a flat boolean array of size² entries");
  }
  if (!Number.isInteger(puzzle.total) || puzzle.total !== puzzle.solution.filter(Boolean).length) {
    throw new RangeError("puzzle total must equal the number of filled solution cells");
  }
  for (const [label, clues] of [["row", puzzle.rows], ["column", puzzle.columns]]) {
    for (const line of clues) {
      if (!Array.isArray(line) || line.length === 0 || line.length > size ||
          !line.every((value) => Number.isInteger(value) && value >= (line.length === 1 ? 0 : 1) && value <= size)) {
        throw new RangeError(`${label} clues must be positive run lengths, or [0] for a blank line`);
      }
    }
  }
  const derivedRows = puzzle.solution.reduce((lines, value, index) => {
    const row = Math.floor(index / size);
    lines[row].push(value);
    return lines;
  }, Array.from({ length: size }, () => []));
  const derivedColumns = puzzle.solution.reduce((lines, value, index) => {
    const col = index % size;
    lines[col].push(value);
    return lines;
  }, Array.from({ length: size }, () => []));
  for (let index = 0; index < size; index += 1) {
    const rowClue = [...cluesForLine(derivedRows[index])].join(",");
    const colClue = [...cluesForLine(derivedColumns[index])].join(",");
    if (rowClue !== [...puzzle.rows[index]].join(",") || colClue !== [...puzzle.columns[index]].join(",")) {
      throw new RangeError("puzzle clues must agree with its solution");
    }
  }
  return puzzle;
}

/** Accept a linear index or a { row, col } position; always return a valid index. */
export function positionToIndex(position, size = PUZZLE.size) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("size must be a positive integer");
  const limit = size * size;
  if (typeof position === "number") {
    if (!Number.isFinite(position)) throw new TypeError("position must be a finite number or { row, col }");
    if (!Number.isInteger(position)) throw new RangeError("linear position must be an integer");
    if (position < 0 || position >= limit) throw new RangeError(`linear position must be from 0 to ${limit - 1}`);
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
  if (row < 0 || row >= size || col < 0 || col >= size) {
    throw new RangeError(`row/col must be inside ${size}×${size}`);
  }
  return row * size + col;
}

/** Inverse of positionToIndex for rendering and keyboard navigation. */
export function indexToPosition(index, size = PUZZLE.size) {
  const normalized = positionToIndex(index, size);
  return Object.freeze({
    row: Math.floor(normalized / size),
    col: normalized % size,
  });
}

export function createNonogram(options = {}) {
  const config = requireObject(options, "Nonogram options");
  const puzzle = assertPuzzle(config.puzzle === undefined ? PUZZLE : config.puzzle);
  const { size, solution, total } = puzzle;
  const cells = Array.from({ length: size * size }, (_, index) => ({
    index,
    row: Math.floor(index / size),
    col: index % size,
    state: "empty",
  }));

  let phase = "playing";
  let filledCount = 0;
  let markedCount = 0;
  let mistakes = 0;
  let cache = null;

  const invalidate = () => { cache = null; };
  const isWon = () => filledCount === total && mistakes === 0;

  const getState = () => {
    if (cache) return cache;
    const views = cells.map((cell) => Object.freeze({ ...cell }));
    cache = Object.freeze({
      phase,
      puzzleId: puzzle.id,
      title: puzzle.title,
      size,
      total,
      rows: puzzle.rows,
      columns: puzzle.columns,
      filledCount,
      markedCount,
      mistakes,
      cells: Object.freeze(views),
    });
    return cache;
  };

  /** Apply a state change through one path so counters, win and cache stay in sync. */
  const setState = (position, next) => {
    if (!CELL_STATES.includes(next)) throw new TypeError(`cell state must be empty, filled or marked`);
    const index = positionToIndex(position, size);
    const cell = cells[index];
    if (phase === "won" || cell.state === next) return getState();
    const previous = cell.state;
    if (previous === "filled") {
      filledCount -= 1;
      if (!solution[index]) mistakes -= 1;
    } else if (previous === "marked") {
      markedCount -= 1;
    }
    cell.state = next;
    if (next === "filled") {
      filledCount += 1;
      if (!solution[index]) mistakes += 1;
    } else if (next === "marked") {
      markedCount += 1;
    }
    if (isWon()) phase = "won";
    invalidate();
    return getState();
  };

  const fill = (position) => setState(position, "filled");
  const mark = (position) => setState(position, "marked");
  const clear = (position) => setState(position, "empty");
  const toggleFill = (position) => {
    const index = positionToIndex(position, size);
    return setState(index, cells[index].state === "filled" ? "empty" : "filled");
  };
  const toggleMark = (position) => {
    const index = positionToIndex(position, size);
    return setState(index, cells[index].state === "marked" ? "empty" : "marked");
  };

  const reset = () => {
    for (const cell of cells) cell.state = "empty";
    phase = "playing";
    filledCount = 0;
    markedCount = 0;
    mistakes = 0;
    invalidate();
    return getState();
  };

  const cellAt = (position) => getState().cells[positionToIndex(position, size)];

  return Object.freeze({
    getState,
    cellAt,
    fill,
    mark,
    clear,
    setCell: setState,
    toggleFill,
    toggleMark,
    reset,
  });
}

export default { PUZZLE, createNonogram, makePuzzle };
