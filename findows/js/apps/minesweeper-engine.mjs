/**
 * Minesweeper beginner-board model — pure, dependency-free, no DOM and no timers.
 *
 * The UI owns visuals, input bindings, focus and announcements. It renders the
 * frozen snapshot from `getState()` and forwards row/col (or linear index)
 * positions into the documented actions. Both touch and keyboard use the same
 * actions; `cellAt(position)` returns the matching frozen cell view.
 *
 * Board: fixed 9×9, 10 mines. Phases: ready → playing → won|lost. Mines are
 * placed lazily on the first reveal and never include that cell or any of its
 * neighbors, so the first reveal is always safe and opens an empty area. Empty
 * cells flood-fill iteratively; numbered boundary cells are revealed but do not
 * continue the flood. Flagged cells are never opened by flood or chord.
 *
 * Snapshot safety: while ready/playing, every cell's `mine` is `null`, and hidden
 * cells have `adjacent: null`. Only after won/lost does `mine` become a boolean
 * for every cell (full reveal) and `wrongFlag` mark flags on safe cells. The UI
 * cannot accidentally leak hidden mines by rendering the snapshot. Snapshots are
 * deeply frozen and cached: `getState()` returns the same object until an action
 * actually changes the board.
 *
 * Bounds: invalid positions throw before any mutation. Flags are capped at the
 * mine count. A chord (revealNeighbors) only fires on an opened numbered cell
 * whose adjacent flags exactly equal its number; otherwise it is a no-op.
 * Terminal phases ignore all play actions until `reset()`.
 *
 * Inject `random: () => number` (uniform [0,1)) for deterministic boards/tests.
 * A malformed or endlessly repeated value is rejected, never looped forever.
 */

export const BOARD_WIDTH = 9;
export const BOARD_HEIGHT = 9;
export const CELL_COUNT = BOARD_WIDTH * BOARD_HEIGHT;
export const MINE_COUNT = 10;
export const PHASES = Object.freeze(["ready", "playing", "won", "lost"]);

const MAX_PLACEMENT_ATTEMPTS = 1000;

function requireObject(value, label) {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

/** Accept a linear index or a { row, col } position; always return a valid index. */
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
  if (row < 0 || row >= BOARD_HEIGHT || col < 0 || col >= BOARD_WIDTH) {
    throw new RangeError(`row/col must be inside ${BOARD_WIDTH}×${BOARD_HEIGHT}`);
  }
  return row * BOARD_WIDTH + col;
}

/** Inverse of positionToIndex for board rendering and keyboard navigation. */
export function indexToPosition(index) {
  const normalized = positionToIndex(index);
  return Object.freeze({
    row: Math.floor(normalized / BOARD_WIDTH),
    col: normalized % BOARD_WIDTH,
  });
}

/** Up to eight orthogonal/diagonal neighbor indices, frozen and unique. */
export function neighborIndices(index) {
  const normalized = positionToIndex(index);
  const row = Math.floor(normalized / BOARD_WIDTH);
  const col = normalized % BOARD_WIDTH;
  const result = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (nextRow < 0 || nextRow >= BOARD_HEIGHT || nextCol < 0 || nextCol >= BOARD_WIDTH) continue;
      result.push(nextRow * BOARD_WIDTH + nextCol);
    }
  }
  return Object.freeze(result);
}

export function createMinesweeper(options = {}) {
  const config = requireObject(options, "Minesweeper options");
  const random = config.random === undefined ? Math.random : config.random;
  if (typeof random !== "function") throw new TypeError("random must be a function returning [0,1)");

  const cells = Array.from({ length: CELL_COUNT }, (_, index) => ({
    index,
    row: Math.floor(index / BOARD_WIDTH),
    col: index % BOARD_WIDTH,
    mine: false,
    adjacent: 0,
    revealed: false,
    flagged: false,
  }));
  const neighbors = Array.from({ length: CELL_COUNT }, (_, index) => neighborIndices(index));

  let phase = "ready";
  let revealedCount = 0;
  let flaggedCount = 0;
  let cache = null;

  const isTerminal = () => phase === "won" || phase === "lost";
  const invalidate = () => {
    cache = null;
  };

  const getState = () => {
    if (cache) return cache;
    const terminal = isTerminal();
    const views = cells.map((cell) =>
      Object.freeze({
        index: cell.index,
        row: cell.row,
        col: cell.col,
        revealed: cell.revealed,
        flagged: cell.flagged,
        adjacent: cell.revealed && !cell.mine ? cell.adjacent : null,
        mine: terminal ? cell.mine : null,
        wrongFlag: terminal ? cell.flagged && !cell.mine : false,
      }),
    );
    cache = Object.freeze({
      phase,
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
      mines: MINE_COUNT,
      revealedCount,
      flaggedCount,
      cells: Object.freeze(views),
    });
    return cache;
  };

  /** Choose mines first, then mutate the board: a bad RNG leaves no partial board. */
  const placeMines = (safeIndex) => {
    const forbidden = new Set([safeIndex, ...neighbors[safeIndex]]);
    const eligible = [];
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if (!forbidden.has(index)) eligible.push(index);
    }
    const chosen = new Set();
    let attempts = 0;
    while (chosen.size < MINE_COUNT) {
      if (attempts >= MAX_PLACEMENT_ATTEMPTS) {
        throw new RangeError("random did not produce enough distinct mine positions");
      }
      attempts += 1;
      const value = random();
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
        throw new RangeError("random must return a finite number in [0,1)");
      }
      const candidate = eligible[Math.floor(value * eligible.length)];
      if (candidate === undefined || chosen.has(candidate)) continue;
      chosen.add(candidate);
    }
    for (const index of chosen) cells[index].mine = true;
    for (const cell of cells) {
      cell.adjacent = neighbors[cell.index].reduce(
        (total, neighbor) => total + (cells[neighbor].mine ? 1 : 0),
        0,
      );
    }
  };

  const openCell = (index) => {
    const cell = cells[index];
    if (cell.mine) {
      cell.revealed = true;
      phase = "lost";
      invalidate();
      return false;
    }
    const stack = [index];
    while (stack.length > 0) {
      const current = stack.pop();
      const target = cells[current];
      if (target.revealed || target.flagged || target.mine) continue;
      target.revealed = true;
      revealedCount += 1;
      if (target.adjacent === 0) {
        for (const neighbor of neighbors[current]) {
          if (!cells[neighbor].revealed && !cells[neighbor].flagged && !cells[neighbor].mine) {
            stack.push(neighbor);
          }
        }
      }
    }
    invalidate();
    return true;
  };

  const checkWin = () => {
    if (phase === "playing" && revealedCount === CELL_COUNT - MINE_COUNT) {
      phase = "won";
      invalidate();
    }
  };

  const reveal = (position) => {
    const index = positionToIndex(position);
    if (isTerminal()) return getState();
    const cell = cells[index];
    if (cell.revealed || cell.flagged) return getState();
    if (phase === "ready") {
      placeMines(index);
      phase = "playing";
      invalidate();
    }
    if (!openCell(index)) return getState();
    checkWin();
    return getState();
  };

  const setFlag = (position, flagged) => {
    const index = positionToIndex(position);
    if (isTerminal()) return getState();
    const cell = cells[index];
    if (cell.revealed || cell.flagged === flagged) return getState();
    if (flagged && flaggedCount >= MINE_COUNT) return getState();
    cell.flagged = flagged;
    flaggedCount += flagged ? 1 : -1;
    invalidate();
    return getState();
  };

  const flag = (position) => setFlag(position, true);
  const unflag = (position) => setFlag(position, false);
  const toggleFlag = (position) => {
    const index = positionToIndex(position);
    return setFlag(index, !cells[index].flagged);
  };

  const revealNeighbors = (position) => {
    const index = positionToIndex(position);
    if (isTerminal()) return getState();
    const cell = cells[index];
    if (!cell.revealed || cell.adjacent === 0) return getState();
    const adjacent = neighbors[index];
    const matchingFlags = adjacent.reduce((total, neighbor) => total + (cells[neighbor].flagged ? 1 : 0), 0);
    if (matchingFlags !== cell.adjacent) return getState();
    for (const neighbor of adjacent) {
      if (cells[neighbor].flagged || cells[neighbor].revealed) continue;
      if (!openCell(neighbor)) return getState();
    }
    checkWin();
    return getState();
  };

  const reset = () => {
    for (const cell of cells) {
      cell.mine = false;
      cell.adjacent = 0;
      cell.revealed = false;
      cell.flagged = false;
    }
    phase = "ready";
    revealedCount = 0;
    flaggedCount = 0;
    invalidate();
    return getState();
  };

  const cellAt = (position) => getState().cells[positionToIndex(position)];

  return Object.freeze({
    getState,
    cellAt,
    reveal,
    flag,
    unflag,
    toggleFlag,
    setFlag,
    revealNeighbors,
    reset,
  });
}
