/* Sokoban engine contract (pure, dependency-free). Written before the engine:
   running this file now must fail with ERR_MODULE_NOT_FOUND (RED evidence).

   Every bundled level is proved solvable by an independent breadth-first solver
   in this test. The solver returns a direction path which is replayed through
   the real engine, so win detection, pushing and level data are verified together.
   The solver also yields the optimal move count asserted as each level's `par`. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BOX,
  BOX_ON_GOAL,
  DIRECTIONS,
  FLOOR,
  GOAL,
  LEVELS,
  PLAYER,
  PLAYER_ON_GOAL,
  WALL,
  createSokoban,
  parseLevel,
} from "../../findows/js/apps/sokoban-engine.mjs";

/* ---------- independent reference solver (test-only) ---------- */

function referenceModel(level) {
  const parsed = parseLevel(level);
  const goals = new Set(parsed.goals.map((cell) => `${cell.row},${cell.col}`));
  return {
    width: parsed.width,
    height: parsed.height,
    walls: new Set(parsed.walls.map((cell) => `${cell.row},${cell.col}`)),
    goals,
    start: { player: parsed.player, boxes: parsed.boxes.map((box) => ({ ...box })) },
  };
}

const keyOf = (player, boxes) =>
  `${player.row},${player.col}|${boxes.map((b) => `${b.row},${b.col}`).sort().join(";")}`;

/** BFS over (player position, box set). Returns { moves, path } or null. */
function solve(level) {
  const model = referenceModel(level);
  const blocked = (row, col, boxes) =>
    row < 0 || row >= model.height || col < 0 || col >= model.width ||
    model.walls.has(`${row},${col}`) ||
    boxes.some((b) => b.row === row && b.col === col);
  const won = (boxes) => boxes.every((b) => model.goals.has(`${b.row},${b.col}`));

  const start = model.start;
  if (won(start.boxes)) return { moves: 0, path: [] };
  const queue = [{ player: start.player, boxes: start.boxes, path: [] }];
  const seen = new Set([keyOf(start.player, start.boxes)]);
  let head = 0;
  while (head < queue.length) {
    const node = queue[head];
    head += 1;
    for (const [direction, delta] of Object.entries(DIRECTIONS)) {
      const row = node.player.row + delta.row;
      const col = node.player.col + delta.col;
      let boxes = node.boxes;
      const hit = boxes.findIndex((b) => b.row === row && b.col === col);
      if (hit !== -1) {
        const beyondRow = row + delta.row;
        const beyondCol = col + delta.col;
        if (blocked(beyondRow, beyondCol, boxes.filter((_, i) => i !== hit))) continue;
        boxes = boxes.map((b, i) => (i === hit ? { row: beyondRow, col: beyondCol } : b));
      } else if (blocked(row, col, boxes)) {
        continue;
      }
      const player = { row, col };
      const path = [...node.path, direction];
      if (won(boxes)) return { moves: path.length, path };
      const key = keyOf(player, boxes);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ player, boxes, path });
    }
  }
  return null;
}

/* ---------- tests ---------- */

test("tile characters and direction vectors form a frozen, orthogonal contract", () => {
  assert.equal(WALL, "#");
  assert.equal(FLOOR, " ");
  assert.equal(GOAL, ".");
  assert.equal(BOX, "$");
  assert.equal(PLAYER, "@");
  assert.equal(BOX_ON_GOAL, "*");
  assert.equal(PLAYER_ON_GOAL, "+");
  assert.deepEqual(Object.keys(DIRECTIONS), ["up", "down", "left", "right"]);
  assert.ok(Object.isFrozen(DIRECTIONS));
  for (const vector of Object.values(DIRECTIONS)) {
    assert.ok(Object.isFrozen(vector));
    assert.equal(Math.abs(vector.row) + Math.abs(vector.col), 1);
  }
});

test("the bundled level set is frozen, small, named and par-labelled", () => {
  assert.ok(Array.isArray(LEVELS));
  assert.ok(Object.isFrozen(LEVELS));
  assert.ok(LEVELS.length >= 4 && LEVELS.length <= 10);
  for (const [index, level] of LEVELS.entries()) {
    assert.ok(Object.isFrozen(level), `level ${index} is frozen`);
    assert.ok(Object.isFrozen(level.rows), `level ${index} rows are frozen`);
    assert.equal(typeof level.id, "string");
    assert.match(level.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(level.name.length > 0 && level.name.length < 40);
    assert.ok(Number.isInteger(level.par) && level.par > 0);
    assert.ok(level.rows.length >= 3 && level.rows.length <= 9);
  }
  assert.equal(new Set(LEVELS.map((level) => level.id)).size, LEVELS.length, "ids are unique");
});

test("every level is structurally valid and parseLevel exposes a frozen model", () => {
  for (const level of LEVELS) {
    const model = parseLevel(level);
    assert.ok(Object.isFrozen(model));
    assert.ok(Object.isFrozen(model.walls) && Object.isFrozen(model.goals));
    assert.ok(model.goals.length === model.boxes.length, `${level.id}: one goal per box`);
    assert.ok(model.boxes.length >= 1 && model.boxes.length <= 4);
    assert.ok(model.walls.length > 0);
    const width = model.width;
    assert.ok(level.rows.every((row) => row.length === width));
    assert.ok(model.player.row >= 0 && model.player.row < model.height);
    const inside = (cell) => cell.row >= 0 && cell.row < model.height && cell.col >= 0 && cell.col < width;
    assert.ok(model.boxes.every(inside));
    assert.ok(model.goals.every(inside));
    assert.equal(
      new Set([...model.goals, ...model.walls].map((cell) => `${cell.row},${cell.col}`)).size,
      model.goals.length + model.walls.length,
      "goals never sit inside walls",
    );
  }
});

test("an independent BFS solves every bundled level in its declared par", () => {
  for (const level of LEVELS) {
    const solution = solve(level);
    assert.ok(solution, `${level.id} must be solvable`);
    assert.equal(solution.moves, level.par, `${level.id}: par is the optimal move count`);
    assert.deepEqual(Object.keys(solve(level)).sort(), ["moves", "path"]);
  }
});

test("replaying each BFS solution through the engine wins and freezes play", () => {
  for (const [index, level] of LEVELS.entries()) {
    const game = createSokoban({ levelIndex: index });
    const solution = solve(level);
    assert.ok(solution, `${level.id}: reference solution exists`);
    for (const direction of solution.path) game.move(direction);
    const state = game.getState();
    assert.equal(state.phase, "won", `${level.id}: replay wins`);
    assert.equal(state.moves, level.par);
    assert.ok(state.grid.flat().every((cell) => !cell.box || cell.boxOnGoal));
    const locked = game.move("up");
    assert.strictEqual(locked, state, `${level.id}: no play after a win`);
    assert.strictEqual(game.undo() === state, false, `${level.id}: undo unlocks a solved board`);
    assert.equal(game.getState().phase, "playing");
  }
});

test("a fresh snapshot is deeply frozen, cached and describes the first level", () => {
  const game = createSokoban();
  const state = game.getState();
  assert.equal(state.phase, "playing");
  assert.equal(state.levelIndex, 0);
  assert.equal(state.levelCount, LEVELS.length);
  assert.equal(state.levelId, LEVELS[0].id);
  assert.equal(state.levelName, LEVELS[0].name);
  assert.equal(state.par, LEVELS[0].par);
  assert.equal(state.moves, 0);
  assert.equal(state.pushes, 0);
  assert.equal(state.canUndo, false);
  assert.equal(state.isLastLevel, LEVELS.length === 1);
  assert.equal(state.unlocked, 0);
  assert.equal(state.grid.length, state.height);
  assert.ok(state.grid.every((row) => row.length === state.width));
  assert.ok(state.grid.flat().every((cell) => Object.isFrozen(cell)));
  assert.ok(Object.isFrozen(state.grid));
  assert.ok(state.grid.every((row) => Object.isFrozen(row)));
  assert.ok(Object.isFrozen(state.player));
  assert.strictEqual(game.getState(), state, "no-op reads reuse the snapshot");
  assert.throws(() => { state.moves = 9; }, TypeError);
  assert.throws(() => { state.grid[0][0].wall = false; }, TypeError);
  assert.deepEqual(Object.keys(state).sort(), [
    "canUndo", "grid", "height", "isLastLevel", "levelCount", "levelId", "levelIndex",
    "levelName", "moves", "par", "phase", "player", "pushes", "unlocked", "width",
  ]);
});

test("a free step changes the player only; blocked steps are stable no-ops", () => {
  const game = createSokoban();
  const start = game.getState();
  const model = parseLevel(LEVELS[0]);
  const open = DIRECTIONS[Object.keys(DIRECTIONS).find((name) => {
    const d = DIRECTIONS[name];
    const row = model.player.row + d.row;
    const col = model.player.col + d.col;
    return !model.walls.some((w) => w.row === row && w.col === col) &&
      !model.boxes.some((b) => b.row === row && b.col === col);
  })];
  const after = game.move(Object.keys(DIRECTIONS).find((name) => DIRECTIONS[name] === open));
  assert.notStrictEqual(after, start);
  assert.equal(after.moves, 1);
  assert.equal(after.pushes, 0);
  assert.deepEqual({ ...after.player }, {
    row: start.player.row + open.row,
    col: start.player.col + open.col,
  });
  assert.equal(after.canUndo, true);
  assert.strictEqual(game.getState(), after);

  // Walking back into the vacated tile is free and reversible.
  const backName = Object.keys(DIRECTIONS).find((name) =>
    DIRECTIONS[name].row === -open.row && DIRECTIONS[name].col === -open.col);
  assert.equal(game.move(backName).moves, 2);

  // A wall blocks movement and keeps the exact snapshot, without consuming a move.
  const corner = {
    id: "corner", name: "Corner", par: 2,
    rows: ["####", "#@ #", "# $#", "#. #", "####"],
  };
  const bordered = createSokoban({ levels: [corner] });
  const before = bordered.getState();
  assert.strictEqual(bordered.move("up"), before, "the wall above the player blocks the step");
  assert.strictEqual(bordered.move("left"), before, "the wall to the left blocks the step");
  assert.strictEqual(bordered.getState(), before, "blocked steps publish the same frozen snapshot");
});

test("undo restores player, boxes, counters and phase; restart clears history", () => {
  const game = createSokoban();
  const fresh = game.getState();
  assert.strictEqual(game.undo(), fresh, "undo at the start is a stable no-op");

  const first = game.move(solve(LEVELS[0]).path[0]);
  assert.equal(first.canUndo, true);
  const undone = game.undo();
  assert.notStrictEqual(undone, first);
  assert.deepEqual({ ...undone.player }, { ...fresh.player });
  assert.equal(undone.moves, 0);
  assert.equal(undone.pushes, 0);
  assert.equal(undone.phase, "playing");
  assert.equal(undone.canUndo, false);
  assert.strictEqual(game.undo(), undone);

  for (const direction of solve(LEVELS[0]).path) game.move(direction);
  assert.equal(game.getState().phase, "won");
  assert.equal(game.undo().phase, "playing", "undo after a win reopens the level");

  game.move("up");
  const restarted = game.restart();
  assert.equal(restarted.moves, 0);
  assert.equal(restarted.pushes, 0);
  assert.equal(restarted.canUndo, false);
  assert.equal(restarted.phase, "playing");
  assert.deepEqual({ ...restarted.player }, { ...fresh.player });
  assert.strictEqual(game.restart(), restarted, "restart is idempotent");
});

test("level progression advances once, stops at the end and tracks unlocks", () => {
  const game = createSokoban();
  const first = game.getState();
  const second = game.nextLevel();
  assert.equal(second.levelIndex, 1);
  assert.equal(second.levelId, LEVELS[1].id);
  assert.equal(second.moves, 0);
  assert.equal(second.canUndo, false);
  assert.equal(second.unlocked, 1);
  assert.notStrictEqual(second, first, "old snapshots keep their level index");

  const jumped = game.loadLevel(LEVELS.length - 1);
  assert.equal(jumped.levelIndex, LEVELS.length - 1);
  assert.equal(jumped.unlocked, LEVELS.length - 1);
  assert.equal(jumped.isLastLevel, true);
  assert.strictEqual(game.nextLevel(), jumped, "nextLevel is a no-op on the final level");

  assert.equal(game.loadLevel(0).levelIndex, 0, "revisiting an unlocked level is allowed");
  assert.equal(game.getState().unlocked, LEVELS.length - 1, "unlocks are not lost on revisit");
  const byId = game.loadLevel(LEVELS[1].id);
  assert.equal(byId.levelIndex, 1);
});

test("malformed configuration and out-of-range input throw without mutating state", () => {
  assert.throws(() => createSokoban(null), TypeError);
  assert.throws(() => createSokoban({ levels: [] }), RangeError);
  assert.throws(() => createSokoban({ levels: LEVELS, levelIndex: -1 }), RangeError);
  assert.throws(() => createSokoban({ levels: LEVELS, levelIndex: LEVELS.length }), RangeError);
  assert.throws(() => createSokoban({ levels: LEVELS, levelIndex: 1.5 }), RangeError);

  const badRows = { id: "bad", name: "Bad", rows: ["###", "#@#", "##"], par: 1 };
  assert.throws(() => parseLevel(badRows), RangeError, "rows must be rectangular");
  const badChar = { id: "bad", name: "Bad", rows: ["###", "#@#", "#X#", "###"], par: 1 };
  assert.throws(() => parseLevel(badChar), RangeError, "unknown tiles are rejected");
  const noPlayer = { id: "bad", name: "Bad", rows: ["###", "#$#", "#.#", "###"], par: 1 };
  assert.throws(() => parseLevel(noPlayer), RangeError, "exactly one player is required");
  const twoPlayers = { id: "bad", name: "Bad", rows: ["####", "#@@#", "#..#", "####"], par: 1 };
  assert.throws(() => parseLevel(twoPlayers), RangeError);
  const mismatch = { id: "bad", name: "Bad", rows: ["###", "#@#", "#.#", "###"], par: 1 };
  assert.throws(() => parseLevel(mismatch), RangeError, "goals must match boxes");
  assert.throws(() => parseLevel(null), TypeError);
  assert.throws(() => parseLevel({ ...LEVELS[0], rows: null }), TypeError);

  const game = createSokoban();
  const before = game.getState();
  for (const direction of [null, undefined, "upward", "", 1, {}, "UP"]) {
    assert.throws(() => game.move(direction), (error) =>
      error instanceof TypeError || error instanceof RangeError, `move ${String(direction)}`);
  }
  assert.strictEqual(game.getState(), before, "invalid input never mutates the board");
  assert.throws(() => game.loadLevel(99), RangeError);
  assert.throws(() => game.loadLevel(-1), RangeError);
  assert.throws(() => game.loadLevel("missing-id"), RangeError);
  assert.throws(() => game.loadLevel(null), TypeError);
  assert.strictEqual(game.getState(), before, "invalid level selection never mutates the board");
});
