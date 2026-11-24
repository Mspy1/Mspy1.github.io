/* Gate 4: Minesweeper beginner-board model (pure, dependency-free).
   Deterministic RNG sequences make mine placement observable without exposing
   mines in ready/playing snapshots. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_COUNT,
  MINE_COUNT,
  PHASES,
  createMinesweeper,
  indexToPosition,
  neighborIndices,
  positionToIndex,
} from "../../findows/js/apps/minesweeper-engine.mjs";

const CENTER = 40;
const FORBIDDEN = new Set([CENTER, ...neighborIndices(CENTER)]);
const ELIGIBLE = Array.from({ length: CELL_COUNT }, (_, index) => index).filter((index) => !FORBIDDEN.has(index));

/** RNG that chooses exactly the given eligible-cell indices, in order. */
function rngChoosing(indices, { cycle = false } = {}) {
  const values = indices.map((index) => {
    const slot = ELIGIBLE.indexOf(index);
    assert.notEqual(slot, -1, `test mine ${index} must be eligible after a center first reveal`);
    return (slot + 0.5) / ELIGIBLE.length;
  });
  let calls = 0;
  return {
    random() {
      if (calls >= values.length && !cycle) throw new Error("test RNG exhausted");
      const value = values[calls % values.length];
      calls += 1;
      return value;
    },
    calls: () => calls,
  };
}

/** Mines spread over the board so flood fill leaves useful numbered boundaries. */
function spreadRng(options) {
  return rngChoosing([0, 8, 20, 24, 54, 58, 70, 76, 80, 60], options);
}

test("the beginner contract is a fixed 9x9 board with 10 mines and four phases", () => {
  assert.equal(BOARD_WIDTH, 9);
  assert.equal(BOARD_HEIGHT, 9);
  assert.equal(CELL_COUNT, 81);
  assert.equal(MINE_COUNT, 10);
  assert.deepEqual([...PHASES], ["ready", "playing", "won", "lost"]);
  assert.ok(Object.isFrozen(PHASES));
});

test("position helpers validate and convert row/col, index and neighbors", () => {
  assert.equal(positionToIndex({ row: 2, col: 3 }), 21);
  assert.equal(positionToIndex(21), 21);
  assert.deepEqual({ ...indexToPosition(21) }, { row: 2, col: 3 });
  assert.deepEqual({ ...indexToPosition(80) }, { row: 8, col: 8 });
  assert.ok(Object.isFrozen(indexToPosition(21)));
  assert.equal(neighborIndices(40).length, 8);
  assert.equal(neighborIndices(0).length, 3);
  assert.equal(neighborIndices(8).length, 3, "top-right is a corner");
  assert.equal(neighborIndices(4).length, 5, "top edge has five neighbors");
  assert.equal(neighborIndices(80).length, 3);
  for (const list of [neighborIndices(0), neighborIndices(40), neighborIndices(80)]) {
    assert.equal(new Set(list).size, list.length, "neighbors are unique");
    assert.ok(list.every((index) => index >= 0 && index < CELL_COUNT && index !== CENTER));
  }
  assert.ok(!neighborIndices(40).includes(40), "a cell is not its own neighbor");
  assert.throws(() => positionToIndex({ row: -1, col: 0 }), RangeError);
  assert.throws(() => positionToIndex({ row: 9, col: 0 }), RangeError);
  assert.throws(() => positionToIndex({ row: 0, col: 9 }), RangeError);
  assert.throws(() => positionToIndex({ row: 1.5, col: 2 }), RangeError);
  assert.throws(() => positionToIndex({ row: Number.NaN, col: 0 }), TypeError);
  assert.throws(() => positionToIndex(81), RangeError);
  assert.throws(() => positionToIndex("12"), TypeError);
  assert.throws(() => indexToPosition(-1), RangeError);
});

test("a fresh board has a frozen, stable, mine-free snapshot", () => {
  const game = createMinesweeper({ random: () => 0.5 });
  const state = game.getState();
  assert.equal(state.phase, "ready");
  assert.equal(state.width, 9);
  assert.equal(state.height, 9);
  assert.equal(state.mines, 10);
  assert.equal(state.cells.length, 81);
  assert.equal(state.revealedCount, 0);
  assert.equal(state.flaggedCount, 0);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.cells));
  assert.ok(state.cells.every((cell) => Object.isFrozen(cell)));
  assert.strictEqual(game.getState(), state, "unchanged snapshots are the same object");
  assert.ok(state.cells.every((cell) => cell.mine === null), "hidden mines are redacted");
  assert.ok(state.cells.every((cell) => cell.revealed === false && cell.flagged === false));
  assert.ok(state.cells.every((cell) => cell.adjacent === null));
  assert.deepEqual(Object.keys(state).sort(), [
    "cells", "flaggedCount", "height", "mines", "phase", "revealedCount", "width",
  ]);
  assert.ok(!JSON.stringify(state).includes('"mine":true'), "no true mine appears in serialized play state");
});

test("the first reveal is safe, places exactly 10 mines and calls RNG only there", () => {
  const rng = spreadRng();
  const game = createMinesweeper({ random: rng.random });
  const first = game.reveal({ row: 4, col: 4 });
  assert.equal(rng.calls(), 10, "placement samples once per mine");
  assert.equal(first.phase, "playing");
  assert.equal(first.cells[CENTER].revealed, true);
  assert.equal(first.cells[CENTER].mine, null, "revealed first cell is safe");
  assert.equal(first.cells[CENTER].adjacent, 0, "first reveal cannot touch a mine, even diagonally");
  assert.ok(first.cells.every((cell) => cell.mine === null), "mines stay redacted while playing");
  assert.equal(game.getState(), first, "revealing an already revealed cell is a stable no-op");
  assert.equal(rng.calls(), 10, "no extra placement on repeated reveal");
});

test("first reveal stays safe at corners even when RNG favors the far edge", () => {
  for (const index of [0, 8, 72, 80]) {
    const forbidden = new Set([index, ...neighborIndices(index)]);
    const eligible = Array.from({ length: CELL_COUNT }, (_, value) => value).filter((value) => !forbidden.has(value));
    let calls = 0;
    const random = () => {
      const slot = eligible.length - 1 - (calls++ % 10);
      return (slot + 0.5) / eligible.length;
    };
    const game = createMinesweeper({ random });
    const state = game.reveal(index);
    assert.ok(state.phase === "playing" || state.phase === "won", `phase ${state.phase} is a safe outcome`);
    assert.equal(state.cells[index].revealed, true);
    assert.equal(state.cells[index].adjacent, 0, `corner/edge ${index} has a safe first neighborhood`);
    assert.equal(state.cells[index].mine === null || state.cells[index].mine === false, true, "first cell is never a mine");
    if (state.phase === "playing") {
      assert.ok(state.cells.every((cell) => cell.mine === null), "hidden mines stay redacted");
    }
  }
});

test("empty-cell flood fill spreads and keeps revealed numbers truthful", () => {
  const game = createMinesweeper({ random: spreadRng().random });
  const state = game.reveal(CENTER);
  assert.ok(state.revealedCount > 9, `flood revealed ${state.revealedCount} cells`);
  assert.ok(state.cells.every((cell) => !cell.revealed || cell.adjacent >= 0), "revealed cells carry a number");
  assert.ok(state.cells.some((cell) => cell.revealed && cell.adjacent > 0), "numbered boundary cells are revealed");
  assert.ok(state.cells.every((cell) => cell.revealed || cell.adjacent === null), "hidden cells never expose numbers");
  assert.equal(state.cells[72].revealed, true, "flood reaches the far side of the board");
});

test("flagged cells are never opened by the initial flood fill", () => {
  const game = createMinesweeper({ random: spreadRng().random });
  game.flag({ row: 4, col: 5 });
  assert.equal(game.getState().flaggedCount, 1);
  const state = game.reveal(CENTER);
  assert.equal(state.cells[41].revealed, false, "a flagged neighbor survives the flood fill");
  assert.equal(state.cells[41].flagged, true);
});

test("flag, unflag and setFlag stay bounded and cannot open a flagged cell", () => {
  const game = createMinesweeper({ random: spreadRng().random });
  let state = game.flag(0);
  assert.equal(state.cells[0].flagged, true);
  assert.equal(state.flaggedCount, 1);
  assert.strictEqual(game.getState(), state);
  state = game.unflag(0);
  assert.equal(state.cells[0].flagged, false);
  assert.equal(state.flaggedCount, 0);
  assert.strictEqual(game.getState(), state, "unflagging an unflagged cell is a no-op");
  state = game.setFlag(0, true);
  assert.equal(state.cells[0].flagged, true);
  assert.strictEqual(game.reveal(0), state, "reveal cannot open a flagged cell");
  assert.equal(state.phase, "ready", "blocked reveal does not place mines");

  for (let index = 1; index < MINE_COUNT; index += 1) game.flag(index);
  const full = game.getState();
  assert.equal(full.flaggedCount, MINE_COUNT);
  assert.strictEqual(game.flag(50), full, "flags are capped at the mine count");
  assert.strictEqual(game.setFlag(50, true), full);
  game.unflag(0);
  assert.equal(game.getState().flaggedCount, MINE_COUNT - 1);
});

test("hitting a mine loses, exposes mines and freezes play until reset", () => {
  const game = createMinesweeper({ random: spreadRng().random });
  game.reveal(CENTER);
  const before = game.getState();
  assert.ok(before.cells.every((cell) => cell.mine === null));
  const lost = game.reveal(0);
  assert.equal(lost.phase, "lost");
  assert.equal(lost.cells[0].revealed, true);
  assert.equal(lost.cells[0].mine, true);
  assert.equal(lost.cells.filter((cell) => cell.mine === true).length, MINE_COUNT, "all mines are exposed at game over");
  assert.ok(lost.cells.every((cell) => typeof cell.mine === "boolean"), "terminal state is a full reveal");
  assert.strictEqual(game.getState(), lost);
  assert.strictEqual(game.reveal(1), lost, "no reveal after loss");
  assert.strictEqual(game.flag(1), lost, "no flag after loss");
  assert.strictEqual(game.toggleFlag(1), lost, "no toggle after loss");
  assert.strictEqual(game.revealNeighbors(CENTER), lost, "no chord after loss");
  assert.strictEqual(game.reset() === lost, false, "reset returns a new ready snapshot");
});

test("revealing every safe cell wins without ever needing a mine click", () => {
  const mines = new Set([0, 8, 20, 24, 54, 58, 70, 76, 80, 60]);
  const game = createMinesweeper({ random: spreadRng().random });
  game.reveal(CENTER);
  for (const index of Array.from({ length: CELL_COUNT }, (_, value) => value)) {
    if (mines.has(index)) continue;
    const state = game.reveal(index);
    if (state.phase === "won") break;
  }
  const won = game.getState();
  assert.equal(won.phase, "won");
  assert.equal(won.revealedCount, CELL_COUNT - MINE_COUNT);
  assert.equal(won.cells.filter((cell) => cell.mine === true).length, MINE_COUNT);
  assert.strictEqual(game.getState(), won);
  assert.strictEqual(game.reveal(0), won, "terminal win stops play");
  assert.strictEqual(game.unflag(0), won);
});

test("chord is bounded: it requires an opened number and matching flags, then opens neighbors", () => {
  const mines = new Set([0, 8, 20, 24, 54, 58, 70, 76, 80, 60]);
  const game = createMinesweeper({ random: spreadRng().random });
  const played = game.reveal(CENTER);
  assert.strictEqual(game.revealNeighbors(0), played, "chord on an unrevealed cell is a no-op");
  const plainNumber = played.cells.find((cell) => cell.revealed && cell.adjacent > 0 && !cell.flagged);
  assert.ok(plainNumber, "flood produced a numbered cell");
  assert.strictEqual(
    game.revealNeighbors(plainNumber.index),
    played,
    "chord without matching flags does nothing",
  );

  let candidate = null;
  for (const cell of played.cells) {
    if (!cell.revealed || cell.adjacent === 0) continue;
    const neighbors = neighborIndices(cell.index);
    const unopenedSafe = neighbors.filter((index) => !played.cells[index].revealed && !mines.has(index));
    const hiddenMines = neighbors.filter((index) => mines.has(index));
    if (unopenedSafe.length > 0 && hiddenMines.length === cell.adjacent) {
      candidate = { cell, hiddenMines };
      break;
    }
  }
  assert.ok(candidate, "the deterministic board has a chordable numbered cell");
  for (const index of candidate.hiddenMines) game.flag(index);
  const flagged = game.getState();
  assert.equal(flagged.flaggedCount, candidate.cell.adjacent);
  const after = game.revealNeighbors(candidate.cell.index);
  assert.ok(after.revealedCount > flagged.revealedCount, "correct chord opens its safe neighbors");
  assert.notEqual(after.phase, "lost", "correct chord never opens a mine");
});

test("a wrong chord can lose, but still obeys the terminal lock", () => {
  const mines = new Set([0, 8, 20, 24, 54, 58, 70, 76, 80, 60]);
  const game = createMinesweeper({ random: spreadRng().random });
  const played = game.reveal(CENTER);
  let target = null;
  for (const cell of played.cells) {
    if (!cell.revealed || cell.adjacent === 0) continue;
    const neighbors = neighborIndices(cell.index);
    const hiddenMines = neighbors.filter((index) => mines.has(index));
    const decoys = neighbors.filter((index) => !mines.has(index) && !played.cells[index].revealed && !played.cells[index].flagged);
    if (hiddenMines.length > 0 && decoys.length >= hiddenMines.length) {
      target = { cell, decoys: decoys.slice(0, hiddenMines.length) };
      break;
    }
  }
  assert.ok(target, "a misleading flag setup is available on the deterministic board");
  for (const index of target.decoys) game.flag(index);
  const result = game.revealNeighbors(target.cell.index);
  assert.equal(result.phase, "lost", "incorrect flags can open a mined neighbor");
  assert.strictEqual(game.getState(), result);
});

test("reset clears the board and keeps the next first reveal safe", () => {
  const rng = spreadRng({ cycle: true });
  const game = createMinesweeper({ random: rng.random });
  game.reveal(CENTER);
  game.flag(1);
  game.reveal(0);
  assert.equal(game.getState().phase, "lost");

  const fresh = game.reset();
  assert.equal(fresh.phase, "ready");
  assert.equal(fresh.revealedCount, 0);
  assert.equal(fresh.flaggedCount, 0);
  assert.ok(fresh.cells.every((cell) => cell.mine === null && !cell.revealed && !cell.flagged && cell.adjacent === null));
  assert.strictEqual(game.getState(), fresh, "reset publishes one stable snapshot");

  const next = game.reveal(80);
  assert.equal(next.phase, "playing");
  assert.equal(next.cells[80].revealed, true);
  assert.equal(next.cells[80].adjacent, 0, "the new first reveal is safe too");
});

test("invalid positions never mutate state for reveal, flags or chord", () => {
  const game = createMinesweeper({ random: spreadRng().random });
  const initial = game.getState();
  const bad = [
    null,
    undefined,
    "12",
    -1,
    81,
    1.5,
    Number.NaN,
    { row: -1, col: 0 },
    { row: 9, col: 0 },
    { row: 0, col: 9 },
    { row: 1.5, col: 2 },
  ];
  for (const position of bad) {
    assert.throws(() => game.reveal(position), (error) => error instanceof TypeError || error instanceof RangeError, `reveal ${String(position)}`);
    assert.throws(() => game.flag(position), (error) => error instanceof TypeError || error instanceof RangeError, `flag ${String(position)}`);
    assert.throws(() => game.unflag(position), (error) => error instanceof TypeError || error instanceof RangeError, `unflag ${String(position)}`);
    assert.throws(() => game.toggleFlag(position), (error) => error instanceof TypeError || error instanceof RangeError, `toggle ${String(position)}`);
    assert.throws(() => game.revealNeighbors(position), (error) => error instanceof TypeError || error instanceof RangeError, `chord ${String(position)}`);
    assert.throws(() => game.cellAt(position), (error) => error instanceof TypeError || error instanceof RangeError, `cellAt ${String(position)}`);
  }
  assert.strictEqual(game.getState(), initial, "rejected input leaves the snapshot untouched");
  assert.strictEqual(game.cellAt(CENTER), initial.cells[CENTER], "cellAt returns the snapshot cell object");
});

test("an invalid or exhausted RNG is rejected instead of looping forever", () => {
  assert.throws(() => createMinesweeper({ random: 42 }), TypeError);
  assert.throws(() => createMinesweeper(null), TypeError);
  const outOfRange = createMinesweeper({ random: () => 1 });
  assert.throws(() => outOfRange.reveal(CENTER), RangeError);
  const duplicates = createMinesweeper({ random: () => 0 });
  assert.throws(() => duplicates.reveal(CENTER), RangeError, "bounding prevents an endless rejection loop");
});

test("snapshots are immutable views: later actions cannot rewrite an old state", () => {
  const game = createMinesweeper({ random: spreadRng().random });
  const first = game.getState();
  game.flag(0);
  const flagged = game.getState();
  assert.notStrictEqual(flagged, first);
  assert.equal(first.flaggedCount, 0);
  assert.equal(first.cells[0].flagged, false);
  assert.throws(() => { first.cells[0].flagged = true; }, TypeError);
  assert.throws(() => { first.cells.length = 0; }, TypeError);
  game.reveal(CENTER);
  assert.equal(flagged.phase, "ready", "an older snapshot never changes");
});
