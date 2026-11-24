/* Gate 4: Fifteen Puzzle model — pure, dependency-free, no DOM and no timers.
   Acceptance: a shuffled 4x4 board is always solvable through legal slides,
   move counting starts at zero, and returning the tiles to ordered form wins. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  GRID_SIZE,
  TILE_COUNT,
  SOLVED_TILES,
  createFifteenPuzzle,
  indexToPosition,
  isSolvable,
  isSolved,
  legalMoves,
  positionToIndex,
} from "../../findows/js/apps/fifteen-puzzle-engine.mjs";

/** Deterministic, repeatable uniform-ish RNG for shuffle evidence. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** One legal slide away from the ordered goal: tile 12 sits below the gap. */
const ONE_MOVE_AWAY = Object.freeze([
  1, 2, 3, 4,
  5, 6, 7, 8,
  9, 10, 11, 0,
  13, 14, 15, 12,
]);
/** Swapping two numbered tiles makes the arrangement impossible to solve. */
const UNSOLVABLE = Object.freeze([
  1, 2, 3, 4,
  5, 6, 7, 8,
  9, 10, 11, 12,
  13, 15, 14, 0,
]);

test("the 4x4 contract exposes a frozen ordered goal and position helpers", () => {
  assert.equal(GRID_SIZE, 4);
  assert.equal(TILE_COUNT, 16);
  assert.equal(SOLVED_TILES.length, 16);
  assert.deepEqual([...SOLVED_TILES], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0]);
  assert.ok(Object.isFrozen(SOLVED_TILES));

  assert.equal(positionToIndex({ row: 2, col: 3 }), 11);
  assert.equal(positionToIndex(11), 11);
  assert.deepEqual({ ...indexToPosition(11) }, { row: 2, col: 3 });
  assert.deepEqual({ ...indexToPosition(15) }, { row: 3, col: 3 });
  assert.ok(Object.isFrozen(indexToPosition(11)));
  for (const bad of [null, undefined, "3", -1, 16, 1.5, Number.NaN, { row: -1, col: 0 }, { row: 4, col: 0 }, { row: 0, col: 4 }, { row: 1.5, col: 2 }]) {
    assert.throws(() => positionToIndex(bad), (error) => error instanceof TypeError || error instanceof RangeError, `position ${String(bad)}`);
    assert.throws(() => indexToPosition(bad), (error) => error instanceof TypeError || error instanceof RangeError, `index ${String(bad)}`);
  }
});

test("solvability parity recognizes ordered, one-move and impossible layouts", () => {
  assert.equal(isSolved([...SOLVED_TILES]), true);
  assert.equal(isSolved([...ONE_MOVE_AWAY]), false);
  assert.equal(isSolvable([...SOLVED_TILES]), true);
  assert.equal(isSolvable([...ONE_MOVE_AWAY]), true);
  assert.equal(isSolvable([...UNSOLVABLE]), false);
  assert.deepEqual([...legalMoves([...SOLVED_TILES])].sort((a, b) => a - b), [11, 14]);
  assert.deepEqual([...legalMoves([...ONE_MOVE_AWAY])].sort((a, b) => a - b), [7, 10, 15]);
  assert.ok(Object.isFrozen(legalMoves([...SOLVED_TILES])));
  for (const bad of [null, [1, 2], [...SOLVED_TILES.slice(0, 15), 16], [...SOLVED_TILES.slice(0, 15), 1], "nope"]) {
    assert.throws(() => isSolvable(bad), (error) => error instanceof TypeError || error instanceof RangeError);
  }
});

test("a default shuffle is a frozen, unsolved, solvable board with a fresh move counter", () => {
  const game = createFifteenPuzzle({ random: seededRandom(7) });
  const state = game.getState();
  assert.equal(state.size, 4);
  assert.equal(state.tiles.length, 16);
  assert.deepEqual([...state.tiles].slice().sort((a, b) => a - b), Array.from({ length: 16 }, (_, index) => index));
  assert.equal(state.moves, 0);
  assert.equal(state.phase, "playing");
  assert.equal(state.solvable, true);
  assert.equal(isSolved([...state.tiles]), false);
  assert.ok(state.blankIndex >= 0 && state.blankIndex < 16);
  assert.equal(state.tiles[state.blankIndex], 0);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.tiles));
  assert.strictEqual(game.getState(), state, "unchanged snapshots are cached");
  assert.deepEqual(Object.keys(state).sort(), ["blankIndex", "moves", "phase", "size", "solvable", "tiles"]);
});

test("shuffling only through legal moves keeps every board solvable across many seeds", () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const game = createFifteenPuzzle({ random: seededRandom(seed) });
    const state = game.getState();
    assert.equal(isSolvable([...state.tiles]), true, `seed ${seed} produced an impossible board`);
    assert.equal(state.solvable, true);
    assert.equal(isSolved([...state.tiles]), false, `seed ${seed} was not shuffled`);
    assert.equal(state.moves, 0);
  }
  const constant = createFifteenPuzzle({ random: () => 0.5, shuffleMoves: 12 });
  assert.equal(isSolvable([...constant.getState().tiles]), true, "a constant RNG still terminates on a solvable board");
});

test("malformed RNG is rejected before it can corrupt the board", () => {
  assert.throws(() => createFifteenPuzzle({ random: 42 }), TypeError);
  assert.throws(() => createFifteenPuzzle(null), TypeError);
  assert.throws(() => createFifteenPuzzle({ random: () => 1 }), RangeError);
  assert.throws(() => createFifteenPuzzle({ random: () => Number.NaN }), RangeError);
  assert.throws(() => createFifteenPuzzle({ tiles: [...ONE_MOVE_AWAY], random: () => -0.1 }), RangeError);
});

test("moveTile swaps an adjacent tile with the gap, counts moves and ignores illegal slides", () => {
  const game = createFifteenPuzzle({ tiles: [...ONE_MOVE_AWAY] });
  const before = game.getState();
  const after = game.moveTile(15);
  assert.equal(after.moves, 1);
  assert.equal(after.blankIndex, 15);
  assert.equal(after.tiles[11], 12, "tile 12 slid up into the gap");
  assert.equal(after.tiles[15], 0, "the gap took the tile's old square");
  assert.equal(after.phase, "won");
  assert.notStrictEqual(after, before);

  const fresh = createFifteenPuzzle({ tiles: [...ONE_MOVE_AWAY] });
  const initial = fresh.getState();
  assert.strictEqual(fresh.moveTile(0), initial, "a non-adjacent tile is a stable no-op");
  for (const bad of [null, undefined, "15", -1, 16, 1.5, Number.NaN, { row: 9, col: 9 }]) {
    assert.throws(() => fresh.moveTile(bad), (error) => error instanceof TypeError || error instanceof RangeError, `moveTile ${String(bad)}`);
  }
  assert.strictEqual(fresh.getState(), initial, "rejected input never mutates the board");
});

test("moveBlank slides the gap by direction and rejects unknown directions", () => {
  const game = createFifteenPuzzle({ tiles: [...ONE_MOVE_AWAY] });
  const moved = game.moveBlank("down");
  assert.equal(moved.tiles[11], 12, "the tile above the gap slid down into it");
  assert.equal(moved.blankIndex, 15);
  assert.equal(moved.phase, "won");
  assert.equal(moved.moves, 1);

  const fresh = createFifteenPuzzle({ tiles: [...ONE_MOVE_AWAY] });
  const initial = fresh.getState();
  assert.strictEqual(fresh.moveBlank("right"), initial, "the gap cannot leave the board");
  assert.throws(() => fresh.moveBlank("sideways"), TypeError);
  assert.throws(() => fresh.moveBlank(), TypeError);
});

test("winning freezes play and a restart produces a playable board again", () => {
  const game = createFifteenPuzzle({ tiles: [...ONE_MOVE_AWAY] });
  const won = game.moveTile(15);
  assert.equal(won.phase, "won");
  assert.equal(isSolved([...won.tiles]), true);
  assert.strictEqual(game.moveTile(7), won, "no moves after winning");
  assert.strictEqual(game.moveBlank("up"), won);

  const restarted = game.restart();
  assert.equal(restarted.phase, "playing");
  assert.equal(restarted.moves, 0);
  assert.deepEqual([...restarted.tiles], [...ONE_MOVE_AWAY], "a fixed-layout game restarts to its start layout");
  const again = game.moveTile(15);
  assert.equal(again.phase, "won");
  assert.equal(again.moves, 1);

  const shuffled = createFifteenPuzzle({ random: seededRandom(99) });
  shuffled.moveBlank("up");
  const fresh = shuffled.restart();
  assert.equal(fresh.moves, 0);
  assert.equal(fresh.phase, "playing");
  assert.equal(isSolvable([...fresh.tiles]), true);
});

test("an explicitly ordered layout starts won; snapshots never change after later moves", () => {
  const solved = createFifteenPuzzle({ tiles: [...SOLVED_TILES] });
  assert.equal(solved.getState().phase, "won");
  assert.equal(solved.getState().moves, 0);

  const game = createFifteenPuzzle({ tiles: [...ONE_MOVE_AWAY] });
  const first = game.getState();
  game.moveTile(15);
  const second = game.getState();
  assert.notStrictEqual(second, first);
  assert.deepEqual([...first.tiles], [...ONE_MOVE_AWAY], "an old snapshot keeps its original tiles");
  assert.equal(first.moves, 0);
  assert.equal(first.phase, "playing");
  assert.throws(() => { first.tiles[0] = 9; }, TypeError);
  assert.throws(() => { first.tiles.length = 0; }, TypeError);
});

test("an invalid fixed layout is rejected with a clear error", () => {
  for (const tiles of [null, [1, 2, 3], [...ONE_MOVE_AWAY.slice(0, 15), -1], [...ONE_MOVE_AWAY.slice(0, 15), 16], [...ONE_MOVE_AWAY.slice(0, 15), 1]]) {
    assert.throws(() => createFifteenPuzzle({ tiles }), (error) => error instanceof TypeError || error instanceof RangeError);
  }
});

/* Bug-analysis F6 regression: a permutation-shaped but parity-impossible board
   must be rejected before a game can start; solvability is never merely reported. */
test("an explicit unsolvable permutation is rejected before a game can start", () => {
  const impossible = [
    [2, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0], // documented F6 repro
    [...UNSOLVABLE],                                           // swap of tiles 14/15
    [1, 2, 3, 4, 5, 6, 7, 0, 8, 9, 11, 10, 13, 12, 15, 14],   // blank row 1, even parity
    [0, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 1, 2],   // blank row 0, even parity
  ];
  for (const tiles of impossible) {
    assert.equal(isSolvable(tiles), false, "fixture really is unsolvable");
    assert.throws(() => createFifteenPuzzle({ tiles }), RangeError);
  }
  // Shape-valid layouts on the solvable side of the parity boundary still work.
  for (const tiles of [[...SOLVED_TILES], [...ONE_MOVE_AWAY]]) {
    assert.equal(createFifteenPuzzle({ tiles }).getState().solvable, true);
  }
});

test("solvability is an invariant across shuffles, moves and restarts", () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const game = createFifteenPuzzle({ random: seededRandom(seed) });
    assert.equal(game.getState().solvable, true, `seed ${seed} started unsolvable`);
    for (let step = 0; step < 12; step += 1) {
      game.moveBlank(["up", "down", "left", "right"][step % 4]);
      const state = game.getState();
      assert.equal(state.solvable, true, `seed ${seed} drifted unsolvable on step ${step}`);
      assert.equal(state.solvable, isSolvable([...state.tiles]));
    }
    assert.equal(game.restart().solvable, true, `seed ${seed} restarted unsolvable`);
  }
});
