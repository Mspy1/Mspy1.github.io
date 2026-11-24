/**
 * Sokoban model — pure, dependency-free, no DOM, timers, storage or network.
 *
 * A small bundled level set is parsed into frozen wall/goal maps. The UI renders
 * the frozen snapshot from `getState()` and forwards direction names into `move`.
 * Boxes can be pushed but never pulled; walls and other boxes block a push.
 * There is no losing state: a level is solved when every box sits on a goal.
 *
 * `undo()` restores the exact player/box/counter position before the last move,
 * including the winning move. `restart()` reloads the current level, `nextLevel()`
 * advances and `loadLevel()` jumps to an index or id; unlocks never go backwards.
 * Every action returns the cached snapshot, so no-ops preserve reference identity
 * and old snapshots are immutable.
 *
 * Legend: '#' wall, ' ' floor, '.' goal, '$' box, '@' player,
 *         '*' box on goal, '+' player on goal.
 * `par` is the optimal number of player steps, proved by the BFS in the tests.
 */

export const WALL = "#";
export const FLOOR = " ";
export const GOAL = ".";
export const BOX = "$";
export const PLAYER = "@";
export const BOX_ON_GOAL = "*";
export const PLAYER_ON_GOAL = "+";

export const DIRECTIONS = Object.freeze({
  up: Object.freeze({ row: -1, col: 0 }),
  down: Object.freeze({ row: 1, col: 0 }),
  left: Object.freeze({ row: 0, col: -1 }),
  right: Object.freeze({ row: 0, col: 1 }),
});

const TILES = new Set([WALL, FLOOR, GOAL, BOX, PLAYER, BOX_ON_GOAL, PLAYER_ON_GOAL]);
const DIRECTION_NAMES = Object.keys(DIRECTIONS);

/* Six compact, original levels. Par values are the BFS-optimal step counts. */
export const LEVELS = Object.freeze([
  Object.freeze({
    id: "first-push",
    name: "First Push",
    par: 2,
    rows: Object.freeze([
      "########",
      "#  .   #",
      "#      #",
      "#  $   #",
      "#  @   #",
      "#      #",
      "########",
    ]),
  }),
  Object.freeze({
    id: "double-delivery",
    name: "Double Delivery",
    par: 5,
    rows: Object.freeze([
      "########",
      "#  . . #",
      "#  $ $ #",
      "#  @   #",
      "#      #",
      "########",
    ]),
  }),
  Object.freeze({
    id: "around-the-corner",
    name: "Around the Corner",
    par: 4,
    rows: Object.freeze([
      "#######",
      "#     #",
      "# .#  #",
      "#  $@ #",
      "#     #",
      "#######",
    ]),
  }),
  Object.freeze({
    id: "two-routes",
    name: "Two Routes",
    par: 7,
    rows: Object.freeze([
      "#########",
      "#       #",
      "# .$ .  #",
      "#  @ $  #",
      "#       #",
      "#########",
    ]),
  }),
  Object.freeze({
    id: "three-in-a-row",
    name: "Three in a Row",
    par: 11,
    rows: Object.freeze([
      "########",
      "#      #",
      "# . . .#",
      "# $ $ $#",
      "#   @  #",
      "#      #",
      "########",
    ]),
  }),
  Object.freeze({
    id: "final-delivery",
    name: "Final Delivery",
    par: 8,
    rows: Object.freeze([
      "########",
      "#  #   #",
      "# .$  .#",
      "#  $@$ #",
      "#  .   #",
      "########",
    ]),
  }),
]);

const point = (row, col) => Object.freeze({ row, col });
const samePoint = (a, b) => a.row === b.row && a.col === b.col;
const keyOf = (row, col) => `${row},${col}`;

/**
 * Validate and expand one authored level into a frozen model.
 * Throws TypeError for a malformed level object and RangeError for bad tile data.
 */
export function parseLevel(level) {
  if (level === null || typeof level !== "object") {
    throw new TypeError("level must be an object");
  }
  const { id, name, rows, par } = level;
  if (typeof id !== "string" || id.length === 0) throw new TypeError("level.id must be a non-empty string");
  if (typeof name !== "string" || name.length === 0) throw new TypeError("level.name must be a non-empty string");
  if (!Array.isArray(rows) || rows.length < 3 || !rows.every((row) => typeof row === "string")) {
    throw new TypeError("level.rows must be an array of at least three strings");
  }
  if (!Number.isInteger(par) || par <= 0) throw new TypeError("level.par must be a positive integer");

  const width = rows[0].length;
  if (width < 3 || rows.some((row) => row.length !== width)) {
    throw new RangeError("level rows must be rectangular and at least three columns wide");
  }

  const walls = [];
  const goals = [];
  const boxes = [];
  let player = null;
  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const tile = rows[row][col];
      if (!TILES.has(tile)) {
        throw new RangeError(`unknown tile "${tile}" at row ${row}, column ${col}`);
      }
      if (tile === WALL) walls.push(point(row, col));
      if (tile === GOAL || tile === BOX_ON_GOAL || tile === PLAYER_ON_GOAL) goals.push(point(row, col));
      if (tile === BOX || tile === BOX_ON_GOAL) boxes.push(point(row, col));
      if (tile === PLAYER || tile === PLAYER_ON_GOAL) {
        if (player) throw new RangeError("a level needs exactly one player");
        player = point(row, col);
      }
    }
  }
  if (!player) throw new RangeError("a level needs exactly one player");
  if (boxes.length === 0) throw new RangeError("a level needs at least one box");
  if (goals.length !== boxes.length) throw new RangeError("a level needs one goal per box");

  return Object.freeze({
    id,
    name,
    par,
    width,
    height: rows.length,
    walls: Object.freeze(walls),
    goals: Object.freeze(goals),
    boxes: Object.freeze(boxes),
    player,
  });
}

/** Create a game. `levels` and `levelIndex` are injectable for tests. */
export function createSokoban(options = {}) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("Sokoban options must be an object");
  }
  const levels = options.levels === undefined ? LEVELS : options.levels;
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new RangeError("levels must be a non-empty array");
  }
  const levelIndex = options.levelIndex === undefined ? 0 : options.levelIndex;
  if (!Number.isInteger(levelIndex) || levelIndex < 0 || levelIndex >= levels.length) {
    throw new RangeError(`levelIndex must be an integer from 0 to ${levels.length - 1}`);
  }
  const models = Object.freeze(levels.map((level) => parseLevel(level)));
  const goalKeys = models.map((model) => new Set(model.goals.map((cell) => keyOf(cell.row, cell.col))));
  const wallKeys = models.map((model) => new Set(model.walls.map((cell) => keyOf(cell.row, cell.col))));

  let current = levelIndex;
  let unlocked = levelIndex;
  let player = { ...models[current].player };
  let boxes = models[current].boxes.map((box) => ({ ...box }));
  let moves = 0;
  let pushes = 0;
  let history = [];
  let phase = "playing";
  let cache = null;

  const invalidate = () => { cache = null; };

  const isOnGoal = (box) => goalKeys[current].has(keyOf(box.row, box.col));

  const load = (index) => {
    current = index;
    unlocked = Math.max(unlocked, index);
    player = { ...models[index].player };
    boxes = models[index].boxes.map((box) => ({ ...box }));
    moves = 0;
    pushes = 0;
    history = [];
    phase = "playing";
    invalidate();
  };

  const getState = () => {
    if (cache) return cache;
    const model = models[current];
    const grid = [];
    for (let row = 0; row < model.height; row += 1) {
      const cells = [];
      for (let col = 0; col < model.width; col += 1) {
        const wall = wallKeys[current].has(keyOf(row, col));
        const goal = goalKeys[current].has(keyOf(row, col));
        const box = boxes.some((item) => item.row === row && item.col === col);
        const isPlayer = player.row === row && player.col === col;
        cells.push(Object.freeze({
          row,
          col,
          wall,
          goal,
          box,
          player: isPlayer,
          boxOnGoal: box && goal,
          playerOnGoal: isPlayer && goal,
        }));
      }
      grid.push(Object.freeze(cells));
    }
    cache = Object.freeze({
      phase,
      levelIndex: current,
      levelCount: models.length,
      levelId: model.id,
      levelName: model.name,
      par: model.par,
      width: model.width,
      height: model.height,
      grid: Object.freeze(grid),
      player: Object.freeze({ ...player }),
      moves,
      pushes,
      canUndo: history.length > 0,
      isLastLevel: current === models.length - 1,
      unlocked,
    });
    return cache;
  };

  const remember = () => {
    history.push({
      player: { ...player },
      boxes: boxes.map((box) => ({ ...box })),
      moves,
      pushes,
    });
  };

  const refreshPhase = () => {
    phase = boxes.every(isOnGoal) ? "won" : "playing";
  };

  const move = (direction) => {
    if (typeof direction !== "string" || !DIRECTION_NAMES.includes(direction)) {
      throw new TypeError(`direction must be one of ${DIRECTION_NAMES.join(", ")}`);
    }
    if (phase === "won") return getState();

    const delta = DIRECTIONS[direction];
    const row = player.row + delta.row;
    const col = player.col + delta.col;
    const bounds = models[current];
    if (row < 0 || row >= bounds.height || col < 0 || col >= bounds.width) return getState();
    if (wallKeys[current].has(keyOf(row, col))) return getState();

    const hit = boxes.findIndex((box) => box.row === row && box.col === col);
    if (hit !== -1) {
      const beyondRow = row + delta.row;
      const beyondCol = col + delta.col;
      if (beyondRow < 0 || beyondRow >= bounds.height || beyondCol < 0 || beyondCol >= bounds.width) {
        return getState();
      }
      if (wallKeys[current].has(keyOf(beyondRow, beyondCol))) return getState();
      if (boxes.some((box) => box.row === beyondRow && box.col === beyondCol)) return getState();

      remember();
      boxes = boxes.map((box, index) =>
        index === hit ? { row: beyondRow, col: beyondCol } : box);
      pushes += 1;
    } else {
      remember();
    }

    player = { row, col };
    moves += 1;
    refreshPhase();
    invalidate();
    return getState();
  };

  const undo = () => {
    if (history.length === 0) return getState();
    const previous = history.pop();
    player = previous.player;
    boxes = previous.boxes;
    moves = previous.moves;
    pushes = previous.pushes;
    phase = "playing";
    invalidate();
    return getState();
  };

  const restart = () => {
    if (history.length === 0 && moves === 0 && pushes === 0 && phase === "playing") {
      return getState();
    }
    load(current);
    return getState();
  };

  const nextLevel = () => {
    if (current === models.length - 1) return getState();
    load(current + 1);
    return getState();
  };

  const loadLevel = (target) => {
    if (typeof target === "number") {
      if (!Number.isInteger(target)) throw new TypeError("level index must be an integer");
      if (target < 0 || target >= models.length) throw new RangeError(`level index must be from 0 to ${models.length - 1}`);
      load(target);
    } else if (typeof target === "string") {
      const index = models.findIndex((model) => model.id === target);
      if (index === -1) throw new RangeError(`unknown level id "${target}"`);
      load(index);
    } else {
      throw new TypeError("level must be an index or an id string");
    }
    return getState();
  };

  return Object.freeze({ getState, move, undo, restart, nextLevel, loadLevel });
}

export default { LEVELS, DIRECTIONS, createSokoban, parseLevel };
