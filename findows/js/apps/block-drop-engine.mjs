/**
 * Block Drop — pure falling-tetromino model. No DOM, no timers, no audio, no
 * network. The UI owns the clock, focus, input bindings and announcements; it
 * renders the frozen snapshot from `getState()` and forwards player intent into
 * the documented actions. A 10×20 well, seven-bag piece queue, wall-kick
 * rotations, soft/hard drop, line-clear scoring, pause and terminal lock are all
 * modelled here so both keyboard and touch travel exactly the same path.
 *
 * Inject `random: () => number` for a deterministic seven-bag shuffle, or
 * `pieces: ["T", ...]` to cycle an explicit test sequence. `board` accepts an
 * array of 20 strings (one char per column; "." is empty) for scripted boards.
 * A malformed option throws before any state is created; a malformed draw throws
 * before the queue is committed.
 */

export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;
export const PHASES = Object.freeze(["ready", "playing", "paused", "over"]);
export const LINE_SCORES = Object.freeze([0, 100, 300, 500, 800]);
export const WALL_KICKS = Object.freeze([
  [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0],
]);

const TYPES = Object.freeze(["I", "O", "T", "S", "Z", "J", "L"]);
const SHAPES = Object.freeze({
  I: Object.freeze(["....", "IIII", "....", "...."]),
  O: Object.freeze(["OO", "OO"]),
  T: Object.freeze([".T.", "TTT", "..."]),
  S: Object.freeze([".SS", "SS.", "..."]),
  Z: Object.freeze(["ZZ.", ".ZZ", "..."]),
  J: Object.freeze(["J..", "JJJ", "..."]),
  L: Object.freeze(["..L", "LLL", "..."]),
});

/** Clockwise rotation of a square glyph matrix. */
function rotated(matrix) {
  const size = matrix.length;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    let row = "";
    for (let x = 0; x < size; x += 1) row += matrix[size - 1 - x][y];
    rows.push(row);
  }
  return Object.freeze(rows);
}

function cellsOf(matrix) {
  const cells = [];
  for (let y = 0; y < matrix.length; y += 1) {
    for (let x = 0; x < matrix[y].length; x += 1) {
      if (matrix[y][x] !== ".") cells.push(Object.freeze([x, y]));
    }
  }
  return Object.freeze(cells);
}

/** Four frozen rotation states per type; state 0 is the spawn orientation. */
export const PIECES = Object.freeze(Object.fromEntries(TYPES.map((type) => {
  const states = [];
  let matrix = SHAPES[type];
  for (let turn = 0; turn < 4; turn += 1) {
    states.push(cellsOf(matrix));
    matrix = rotated(matrix);
  }
  return [type, Object.freeze(states)];
})));

export function levelForLines(lines) {
  return 1 + Math.floor(lines / 10);
}

function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function parseBoard(value) {
  if (value === undefined) {
    return Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(null));
  }
  if (!Array.isArray(value) || value.length !== BOARD_HEIGHT) {
    throw new RangeError(`board must have exactly ${BOARD_HEIGHT} rows`);
  }
  return value.map((line, y) => {
    if (typeof line !== "string" || line.length !== BOARD_WIDTH) {
      throw new RangeError(`board row ${y} must be a string of ${BOARD_WIDTH} chars`);
    }
    return Array.from(line, (char) => (char === "." ? null : char));
  });
}

function shuffledBag(random) {
  const bag = [...TYPES];
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const value = random();
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError("random must return a finite number in [0,1)");
    }
    const swap = Math.floor(value * (index + 1));
    const held = bag[index];
    bag[index] = bag[swap];
    bag[swap] = held;
  }
  return bag;
}

export function createBlockDrop(options = {}) {
  const config = requireObject(options, "Block Drop options");
  const board = parseBoard(config.board);
  const fixedPieces = config.pieces;
  if (fixedPieces !== undefined) {
    if (!Array.isArray(fixedPieces) || fixedPieces.length === 0) {
      throw new RangeError("pieces must be a non-empty array of tetromino types");
    }
    for (const type of fixedPieces) {
      if (!TYPES.includes(type)) throw new RangeError(`unknown tetromino type: ${String(type)}`);
    }
  }
  const random = config.random === undefined ? Math.random : config.random;
  if (fixedPieces === undefined && typeof random !== "function") {
    throw new TypeError("random must be a function returning [0,1)");
  }

  let bag = [];
  let pieceCursor = 0;
  function draw() {
    if (fixedPieces) {
      const type = fixedPieces[pieceCursor % fixedPieces.length];
      pieceCursor += 1;
      return type;
    }
    if (bag.length === 0) bag = shuffledBag(random);
    return bag.pop();
  }

  let queue = [draw(), draw()];
  let phase = "ready";
  let piece = null;
  let score = 0;
  let lines = 0;
  let lastClear = 0;
  let cache = null;

  const invalidate = () => { cache = null; };
  const emptyRow = () => Array(BOARD_WIDTH).fill(null);
  const cellsFor = (type, rotation) => PIECES[type][rotation];

  function collides(type, rotation, x, y) {
    for (const [dx, dy] of cellsFor(type, rotation)) {
      const bx = x + dx;
      const by = y + dy;
      if (bx < 0 || bx >= BOARD_WIDTH || by >= BOARD_HEIGHT) return true;
      if (by >= 0 && board[by][bx] !== null) return true;
    }
    return false;
  }

  function ghostYFor(target) {
    let y = target.y;
    while (!collides(target.type, target.rotation, target.x, y + 1)) y += 1;
    return y;
  }

  function spawn() {
    const type = queue.shift();
    queue.push(draw());
    const size = type === "I" ? 4 : type === "O" ? 2 : 3;
    const candidate = { type, rotation: 0, x: Math.floor((BOARD_WIDTH - size) / 2), y: 0 };
    if (collides(candidate.type, candidate.rotation, candidate.x, candidate.y)) {
      piece = null;
      phase = "over";
      return;
    }
    piece = candidate;
  }

  function lock() {
    const locked = piece;
    piece = null;
    let overflow = false;
    for (const [dx, dy] of cellsFor(locked.type, locked.rotation)) {
      const bx = locked.x + dx;
      const by = locked.y + dy;
      if (by < 0 || by >= BOARD_HEIGHT || bx < 0 || bx >= BOARD_WIDTH) {
        overflow = true;
      } else {
        board[by][bx] = locked.type;
      }
    }

    const full = [];
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      if (board[y].every((cell) => cell !== null)) full.push(y);
    }
    lastClear = full.length;
    if (full.length > 0) {
      const kept = board.filter((_, y) => !full.includes(y));
      while (kept.length < BOARD_HEIGHT) kept.unshift(emptyRow());
      for (let y = 0; y < BOARD_HEIGHT; y += 1) board[y] = kept[y];
      lines += full.length;
      score += LINE_SCORES[full.length] * levelForLines(lines);
    }

    if (overflow) {
      phase = "over";
      return;
    }
    spawn();
  }

  function dropOne(bonus) {
    if (phase !== "playing" || !piece) return;
    if (collides(piece.type, piece.rotation, piece.x, piece.y + 1)) {
      lock();
    } else {
      piece.y += 1;
      score += bonus;
    }
    invalidate();
  }

  function getState() {
    if (cache) return cache;
    const ghost = piece ? ghostYFor(piece) : null;
    cache = Object.freeze({
      phase,
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
      board: Object.freeze(board.map((row) => Object.freeze([...row]))),
      piece: piece ? Object.freeze({
        type: piece.type,
        rotation: piece.rotation,
        x: piece.x,
        y: piece.y,
        cells: cellsFor(piece.type, piece.rotation),
        ghostY: ghost,
      }) : null,
      next: queue[0] || null,
      ghostY: ghost,
      score,
      lines,
      level: levelForLines(lines),
      lastClear,
    });
    return cache;
  }

  return Object.freeze({
    getState,
    start() {
      if (phase !== "ready") return getState();
      phase = "playing";
      if (!piece) spawn();
      invalidate();
      return getState();
    },
    moveLeft() {
      if (phase !== "playing" || !piece) return getState();
      if (!collides(piece.type, piece.rotation, piece.x - 1, piece.y)) {
        piece.x -= 1;
        invalidate();
      }
      return getState();
    },
    moveRight() {
      if (phase !== "playing" || !piece) return getState();
      if (!collides(piece.type, piece.rotation, piece.x + 1, piece.y)) {
        piece.x += 1;
        invalidate();
      }
      return getState();
    },
    rotate(direction = 1) {
      if (direction !== 1 && direction !== -1) throw new RangeError("direction must be 1 or -1");
      if (phase !== "playing" || !piece) return getState();
      const rotation = (piece.rotation + (direction === 1 ? 1 : 3)) % 4;
      for (const [kx, ky] of WALL_KICKS) {
        if (!collides(piece.type, rotation, piece.x + kx, piece.y + ky)) {
          piece.rotation = rotation;
          piece.x += kx;
          piece.y += ky;
          invalidate();
          return getState();
        }
      }
      return getState();
    },
    step() {
      dropOne(0);
      return getState();
    },
    softDrop() {
      dropOne(1);
      return getState();
    },
    hardDrop() {
      if (phase !== "playing" || !piece) return getState();
      const distance = ghostYFor(piece) - piece.y;
      piece.y += distance;
      score += distance * 2;
      lock();
      invalidate();
      return getState();
    },
    pause() {
      if (phase !== "playing") return getState();
      phase = "paused";
      invalidate();
      return getState();
    },
    resume() {
      if (phase !== "paused") return getState();
      phase = "playing";
      invalidate();
      return getState();
    },
    reset() {
      for (const row of board) row.fill(null);
      bag = [];
      pieceCursor = 0;
      queue = [draw(), draw()];
      phase = "ready";
      piece = null;
      score = 0;
      lines = 0;
      lastClear = 0;
      invalidate();
      return getState();
    },
  });
}

export default { createBlockDrop };
