/* Block Drop engine contract (pure, dependency-free, no DOM and no timers).
   Tests pin the tetromino model: shapes, movement, wall kicks, soft/hard drop,
   line-clear scoring, terminal lock, pause/reset and stable frozen snapshots. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  LINE_SCORES,
  PHASES,
  PIECES,
  WALL_KICKS,
  createBlockDrop,
  levelForLines,
} from "../../findows/js/apps/block-drop-engine.mjs";

const TYPES = ["I", "O", "T", "S", "Z", "J", "L"];
const EMPTY_BOARD = Array.from({ length: BOARD_HEIGHT }, () => ".".repeat(BOARD_WIDTH));

function fixedGame(pieces = ["O"], board = EMPTY_BOARD) {
  return createBlockDrop({ pieces, board });
}
function activeColumns(state) {
  return state.piece.cells.map(([x]) => x + state.piece.x);
}
function activeRows(state) {
  return state.piece.cells.map(([, y]) => y + state.piece.y);
}
function row(state, y) {
  return state.board[y].map((cell) => cell || ".").join("");
}

test("the contract exposes a 10x20 board, seven tetrominoes and four phases", () => {
  assert.equal(BOARD_WIDTH, 10);
  assert.equal(BOARD_HEIGHT, 20);
  assert.deepEqual([...PHASES], ["ready", "playing", "paused", "over"]);
  assert.ok(Object.isFrozen(PHASES));
  assert.deepEqual([...LINE_SCORES], [0, 100, 300, 500, 800]);
  assert.ok(Object.isFrozen(LINE_SCORES));
  assert.deepEqual(Object.keys(PIECES).sort(), [...TYPES].sort());
  for (const type of TYPES) {
    assert.equal(PIECES[type].length, 4, `${type} has four rotations`);
    assert.ok(Object.isFrozen(PIECES[type]));
    for (const rotation of PIECES[type]) {
      assert.ok(Object.isFrozen(rotation));
      assert.equal(rotation.length, 4, `${type} rotation has four cells`);
      assert.equal(new Set(rotation.map((cell) => cell.join(","))).size, 4, "cells are unique");
      for (const [x, y] of rotation) {
        assert.ok(Number.isInteger(x) && Number.isInteger(y));
        assert.ok(x >= 0 && y >= 0);
      }
    }
  }
  assert.ok(Object.isFrozen(WALL_KICKS) && WALL_KICKS.length >= 5);
  assert.equal(levelForLines(0), 1);
  assert.equal(levelForLines(9), 1);
  assert.equal(levelForLines(10), 2);
  assert.equal(levelForLines(25), 3);
});

test("a fresh game is ready, empty, deeply frozen and cached", () => {
  const game = fixedGame();
  const state = game.getState();
  assert.equal(state.phase, "ready");
  assert.equal(state.width, 10);
  assert.equal(state.height, 20);
  assert.equal(state.board.length, 20);
  assert.ok(state.board.every((line) => line.length === 10 && line.every((cell) => cell === null)));
  assert.equal(state.piece, null);
  assert.equal(state.next, "O");
  assert.equal(state.ghostY, null);
  assert.equal(state.score, 0);
  assert.equal(state.lines, 0);
  assert.equal(state.level, 1);
  assert.equal(state.lastClear, 0);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.board));
  assert.ok(state.board.every((line) => Object.isFrozen(line)));
  assert.strictEqual(game.getState(), state, "unchanged state is cached");
});

test("start opens play, and a spawned piece carries cells, next type and a ghost landing", () => {
  const game = fixedGame(["T", "I"]);
  assert.strictEqual(game.moveLeft(), game.getState(), "movement is inert while ready");
  game.start();
  const state = game.getState();
  assert.equal(state.phase, "playing");
  assert.equal(state.piece.type, "T");
  assert.equal(state.next, "I");
  assert.equal(state.piece.rotation, 0);
  assert.equal(state.piece.cells.length, 4);
  assert.ok(state.ghostY > state.piece.y, "ghost lands below the spawn row");
  game.start();
  assert.strictEqual(game.getState(), state, "a second start is a no-op");
});

test("horizontal movement is wall-bounded and leaves a stable snapshot when blocked", () => {
  const game = fixedGame();
  game.start();
  let state = game.getState();
  const startX = state.piece.x;
  for (let step = 0; step < 12; step += 1) game.moveLeft();
  state = game.getState();
  assert.ok(activeColumns(state).every((x) => x >= 0), "left wall holds");
  const atWall = state;
  game.moveLeft();
  assert.strictEqual(game.getState(), atWall, "a blocked move reuses the snapshot");
  for (let step = 0; step < 12; step += 1) game.moveRight();
  state = game.getState();
  assert.ok(activeColumns(state).every((x) => x < BOARD_WIDTH), "right wall holds");
  assert.notEqual(state.piece.x, startX - 12);
});

test("movement is blocked by locked cells, not only by walls", () => {
  const wall = EMPTY_BOARD.map((line, y) => (y === 4 ? "....OO...." : line));
  const game = fixedGame(["O"], wall);
  game.start();
  for (let step = 0; step < 2; step += 1) game.step();
  const before = game.getState();
  assert.deepEqual(activeRows(before).map((y) => y), [2, 2, 3, 3], "piece rests on the locked pair");
  game.step();
  assert.equal(game.getState().board[3][4], "O", "the falling piece locks into the board");
  assert.equal(game.getState().piece.type, "O", "a new piece spawns after lock");
});

test("clockwise and counterclockwise rotation change orientation and validate direction", () => {
  const game = fixedGame(["T"]);
  game.start();
  const before = game.getState().piece.cells.map((cell) => cell.join(",")).join("|");
  game.rotate(1);
  const cw = game.getState();
  assert.equal(cw.piece.rotation, 1);
  assert.notEqual(cw.piece.cells.map((cell) => cell.join(",")).join("|"), before);
  game.rotate(-1);
  assert.equal(game.getState().piece.rotation, 0);
  game.rotate(-1);
  assert.equal(game.getState().piece.rotation, 3, "one counterclockwise step wraps to the last state");
  assert.throws(() => game.rotate(0), RangeError);
  assert.throws(() => game.rotate("right"), RangeError);
});

test("wall kick slides a rotation away from an obstruction", () => {
  const board = [...EMPTY_BOARD];
  board[2] = "XXX.XXXXXX"; // rotated T wants (4,2); the left kick lands on the gap at (3,2)
  const game = fixedGame(["T"], board);
  game.start();
  const before = game.getState();
  game.rotate(1);
  const after = game.getState();
  assert.equal(after.piece.rotation, 1);
  assert.equal(after.piece.x, before.piece.x - 1, "the left kick clears the obstruction");
  assert.ok(activeColumns(after).every((x) => x >= 0 && x < BOARD_WIDTH), "kicked cells stay in bounds");
});

test("wall kick is bounded: a fully blocked rotation is a stable no-op", () => {
  const spawnCells = new Set(["4,0", "3,1", "4,1", "5,1"]); // T rotation 0 at spawn
  const board = EMPTY_BOARD.map((_, y) =>
    Array.from({ length: BOARD_WIDTH }, (__, x) => (spawnCells.has(`${x},${y}`) ? "." : "X")).join(""));
  const game = fixedGame(["T"], board);
  game.start();
  const blocked = game.getState();
  assert.equal(blocked.phase, "playing", "the spawn fits");
  game.rotate(1);
  assert.strictEqual(game.getState(), blocked, "every kick collides, so nothing changes");
});

test("gravity and soft drop move a piece down; soft drop awards one point per row", () => {
  const gravity = fixedGame();
  gravity.start();
  const y0 = gravity.getState().piece.y;
  gravity.step();
  assert.equal(gravity.getState().piece.y, y0 + 1);
  assert.equal(gravity.getState().score, 0, "gravity gives no bonus");

  const soft = fixedGame();
  soft.start();
  const softY = soft.getState().piece.y;
  soft.softDrop();
  assert.equal(soft.getState().piece.y, softY + 1);
  assert.equal(soft.getState().score, 1);
  soft.softDrop();
  assert.equal(soft.getState().score, 2);
});

test("soft drop at the floor locks the piece and spawns the next one", () => {
  const game = fixedGame(["O", "T"]);
  game.start();
  for (let step = 0; step < 30; step += 1) game.softDrop();
  const state = game.getState();
  assert.equal(state.piece.type, "T");
  assert.ok(state.board.some((line) => line.some((cell) => cell === "O")), "the locked piece is on the board");
  assert.equal(state.score >= 0, true);
});

test("hard drop falls the full distance, scores two per row and locks immediately", () => {
  const game = fixedGame(["O", "T"]);
  game.start();
  const before = game.getState();
  const distance = before.ghostY - before.piece.y;
  assert.ok(distance > 0);
  game.hardDrop();
  const after = game.getState();
  assert.equal(after.piece.type, "T");
  assert.equal(after.score, distance * 2);
  const bottom = after.board[BOARD_HEIGHT - 1];
  assert.ok(bottom.some((cell) => cell === "O"), "the piece locked on the bottom row");
});

test("one cleared line scores 100 and removes the full row", () => {
  const board = [...EMPTY_BOARD];
  board[BOARD_HEIGHT - 1] = "XXXXX.XXXX";
  const game = fixedGame(["I"], board);
  game.start();
  game.rotate(1);
  const before = game.getState();
  assert.equal(activeColumns(before).length, 4, "the vertical I occupies one column");
  assert.equal(new Set(activeColumns(before)).size, 1);
  game.hardDrop();
  const after = game.getState();
  assert.equal(after.lines, 1);
  assert.equal(after.lastClear, 1);
  assert.equal(after.level, 1);
  assert.equal(after.score, 100 + (before.ghostY - before.piece.y) * 2);
  assert.notEqual(row(after, BOARD_HEIGHT - 1), "XXXXX.XXXX", "the full row was removed");
  assert.equal(row(after, BOARD_HEIGHT - 1).split("").filter((cell) => cell !== ".").length, 1,
    "the row above falls into the cleared slot");
});

test("a tetris clears four rows with the 800-point bonus", () => {
  const board = [...EMPTY_BOARD];
  for (let y = BOARD_HEIGHT - 4; y < BOARD_HEIGHT; y += 1) board[y] = "XXXXX.XXXX";
  const game = fixedGame(["I"], board);
  game.start();
  game.rotate(1);
  const before = game.getState();
  game.hardDrop();
  const after = game.getState();
  assert.equal(after.lines, 4);
  assert.equal(after.lastClear, 4);
  assert.equal(after.score, 800 + (before.ghostY - before.piece.y) * 2);
  assert.ok(after.board.every((line) => line.every((cell) => cell === null)), "four full rows vanish");
});

test("a crowded spawn locks the run: play actions no-op until reset", () => {
  const board = EMPTY_BOARD.map((line, y) => (y <= 3 ? "XXXXXXXXXX" : line));
  const game = fixedGame(["O"], board);
  assert.equal(game.getState().phase, "ready");
  game.start();
  const ready = game.getState();
  assert.equal(ready.phase, "over", "the initial spawn already collides");
  assert.equal(ready.piece, null);
  assert.strictEqual(game.start(), ready);
  assert.strictEqual(game.moveLeft(), ready);
  assert.strictEqual(game.moveRight(), ready);
  assert.strictEqual(game.rotate(1), ready);
  assert.strictEqual(game.softDrop(), ready);
  assert.strictEqual(game.hardDrop(), ready);
  assert.strictEqual(game.step(), ready);
  assert.strictEqual(game.pause(), ready);
  assert.strictEqual(game.resume(), ready);
});

test("pause freezes play, resume restores it, and both ignore repeat calls", () => {
  const game = fixedGame();
  game.start();
  game.pause();
  const paused = game.getState();
  assert.equal(paused.phase, "paused");
  const y = paused.piece.y;
  game.step();
  game.moveLeft();
  game.softDrop();
  game.rotate(1);
  assert.strictEqual(game.getState(), paused, "no action mutates a paused game");
  game.pause();
  assert.strictEqual(game.getState(), paused);
  game.resume();
  assert.equal(game.getState().phase, "playing");
  assert.equal(game.getState().piece.y, y);
  game.resume();
  assert.equal(game.getState().phase, "playing");
});

test("reset clears board, score, lines and returns to ready with the next queued piece", () => {
  const game = fixedGame(["O", "T", "S"]);
  game.start();
  game.hardDrop();
  game.hardDrop();
  const played = game.getState();
  assert.ok(played.score > 0 && played.board.some((line) => line.some(Boolean)));
  const fresh = game.reset();
  assert.equal(fresh.phase, "ready");
  assert.equal(fresh.score, 0);
  assert.equal(fresh.lines, 0);
  assert.equal(fresh.lastClear, 0);
  assert.equal(fresh.piece, null);
  assert.equal(fresh.next, "O");
  assert.ok(fresh.board.every((line) => line.every((cell) => cell === null)));
  game.start();
  assert.equal(game.getState().piece.type, "O", "the piece sequence restarts");
});

test("the seven-bag deals each type once before repeating", () => {
  let calls = 0;
  const game = createBlockDrop({ random: () => { calls += 1; return 0; } });
  game.start();
  const seen = [];
  for (let index = 0; index < 7; index += 1) {
    seen.push(game.getState().piece.type);
    game.hardDrop();
  }
  assert.equal(new Set(seen).size, 7, `${seen.join(",")} contains all seven types`);
  assert.deepEqual([...seen].sort(), [...TYPES].sort());
  assert.ok(calls >= 7, "the bag is shuffled with the injected random function");
});

test("invalid options, pieces and boards are rejected before state changes", () => {
  assert.throws(() => createBlockDrop(null), TypeError);
  assert.throws(() => createBlockDrop({ random: 3 }), TypeError);
  assert.throws(() => createBlockDrop({ pieces: ["Q"] }), RangeError);
  assert.throws(() => createBlockDrop({ pieces: [] }), RangeError);
  assert.throws(() => createBlockDrop({ board: [] }), RangeError);
  assert.throws(() => createBlockDrop({ board: ["...."] }), RangeError);
  assert.throws(() => createBlockDrop({ board: ["?".repeat(BOARD_WIDTH)] }), RangeError);
  assert.throws(() => createBlockDrop({ random: () => 1.5 }), RangeError,
    "a bad draw is rejected when the queue is primed");
});

test("snapshots are immutable views and no-op actions keep their identity", () => {
  const game = fixedGame(["O", "T"]);
  game.start();
  const first = game.getState();
  game.moveLeft();
  const moved = game.getState();
  assert.notStrictEqual(moved, first);
  assert.equal(first.piece.x, moved.piece.x + 1, "the older snapshot is untouched");
  assert.throws(() => { first.board[0][0] = "X"; }, TypeError);
  assert.throws(() => { first.board.length = 0; }, TypeError);
  assert.throws(() => { first.piece.cells[0][0] = 99; }, TypeError);
  assert.throws(() => game.rotate(9), RangeError);
  assert.strictEqual(game.getState(), moved, "a rejected action does not invalidate the cache");
});
