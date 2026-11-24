/* Gate 4: Nonogram pure-logic lane (dependency-free, no DOM, no timers).
   The bundled puzzle is a 5x5 heart with unique row/column clues. Tests pin the
   clue derivation, bounded positions, immutable snapshots, mistake accounting,
   and — critically — that wrong marks or wrong fills can never produce a win. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CELL_STATES,
  PUZZLE,
  cluesForLine,
  createNonogram,
  indexToPosition,
  makePuzzle,
  positionToIndex,
} from "../../findows/js/apps/nonogram-engine.mjs";

/** Every binary row of length `size` whose run lengths equal `clue` ([0] = blank). */
function patternsFor(clue, size) {
  const patterns = [];
  for (let bits = 0; bits < 2 ** size; bits += 1) {
    const line = Array.from({ length: size }, (_, col) => ((bits >> (size - 1 - col)) & 1) === 1);
    const runs = [];
    let run = 0;
    for (const value of line) {
      if (value) run += 1;
      else if (run > 0) { runs.push(run); run = 0; }
    }
    if (run > 0) runs.push(run);
    const expected = clue.length === 1 && clue[0] === 0 ? [] : clue;
    if (runs.length === expected.length && runs.every((value, i) => value === expected[i])) patterns.push(line);
  }
  return patterns;
}

/** Exhaustive backtracking solver used to prove the shipped puzzle is unique. */
function solveAll(puzzle) {
  const { size, rows, columns } = puzzle;
  const rowCandidates = rows.map((clue) => patternsFor(clue, size));
  const columnCandidates = columns.map((clue) => patternsFor(clue, size).map((line) => line.map(Number).join("")));
  const solutions = [];
  function walk(row, prefixes, chosen) {
    if (row === size) { solutions.push(chosen.map((line) => [...line])); return; }
    for (const line of rowCandidates[row]) {
      const bits = line.map(Number).join("");
      const next = prefixes.map((prefix, col) => prefix + bits[col]);
      const possible = next.every((prefix, col) =>
        columnCandidates[col].some((candidate) => candidate.startsWith(prefix)));
      if (!possible) continue;
      chosen.push(line);
      walk(row + 1, next, chosen);
      chosen.pop();
    }
  }
  walk(0, Array.from({ length: size }, () => ""), []);
  return solutions;
}

test("clue derivation turns runs into numbers and blank lines into [0]", () => {
  assert.deepEqual([...cluesForLine([true, false, true, true, false])], [1, 2]);
  assert.deepEqual([...cluesForLine([0, 0, 0])], [0]);
  assert.deepEqual([...cluesForLine([1, 1, 1, 1])], [4]);
  assert.deepEqual([...cluesForLine([false, true, false, true, false])], [1, 1]);
  assert.ok(Object.isFrozen(cluesForLine([true])));
  assert.throws(() => cluesForLine(["x"]), TypeError);
  assert.throws(() => cluesForLine(null), TypeError);
});

test("makePuzzle derives frozen clues from a local string grid and validates it", () => {
  const puzzle = makePuzzle({ id: "demo", title: "Demo", grid: [".#.", "###", ".#."] });
  assert.equal(puzzle.size, 3);
  assert.deepEqual(puzzle.rows.map((row) => [...row]), [[1], [3], [1]]);
  assert.deepEqual(puzzle.columns.map((col) => [...col]), [[1], [3], [1]]);
  assert.deepEqual([...puzzle.solution], [false, true, false, true, true, true, false, true, false]);
  assert.equal(puzzle.total, 5);
  assert.ok(Object.isFrozen(puzzle) && Object.isFrozen(puzzle.rows) && Object.isFrozen(puzzle.solution));
  assert.ok(puzzle.rows.every((row) => Object.isFrozen(row)));
  assert.throws(() => makePuzzle({ id: "x", title: "X", grid: [".#"] }), RangeError);
  assert.throws(() => makePuzzle({ id: "x", title: "X", grid: [".#.", "##", ".#."] }), TypeError);
  assert.throws(() => makePuzzle({ id: "x", title: "X", grid: [".#?", "###", ".#."] }), TypeError);
  assert.throws(() => makePuzzle({ id: "x", title: "X", grid: ["..."] }), RangeError);
  assert.throws(() => makePuzzle({ id: "", title: "X", grid: [".#.", "###", ".#."] }), TypeError);
});

test("the bundled 5x5 heart puzzle is solvable and has exactly one solution", () => {
  assert.equal(PUZZLE.id, "heart");
  assert.equal(PUZZLE.size, 5);
  assert.equal(PUZZLE.total, 16);
  assert.deepEqual(PUZZLE.rows.map((row) => [...row]), [[1, 1], [5], [5], [3], [1]]);
  assert.deepEqual(PUZZLE.columns.map((col) => [...col]), [[2], [4], [4], [4], [2]]);
  const solutions = solveAll(PUZZLE);
  assert.equal(solutions.length, 1, "clues uniquely determine one picture");
  assert.equal(
    solutions[0].flat().map(Number).join(""),
    PUZZLE.solution.map(Number).join(""),
    "the unique solution is the bundled heart",
  );
});

test("position helpers validate row/col and linear indices before any mutation", () => {
  assert.equal(positionToIndex({ row: 2, col: 3 }), 13);
  assert.equal(positionToIndex(13), 13);
  assert.deepEqual({ ...indexToPosition(13) }, { row: 2, col: 3 });
  assert.ok(Object.isFrozen(indexToPosition(0)));
  assert.equal(positionToIndex(0, 3), 0);
  assert.equal(positionToIndex({ row: 2, col: 2 }, 3), 8);
  for (const bad of [null, undefined, "4", -1, 25, 1.5, Number.NaN, { row: -1, col: 0 },
    { row: 5, col: 0 }, { row: 0, col: 5 }, { row: 1.5, col: 2 }, { row: Number.NaN, col: 0 }]) {
    assert.throws(() => positionToIndex(bad), (error) => error instanceof TypeError || error instanceof RangeError);
  }
  assert.throws(() => indexToPosition(25), RangeError);
  assert.throws(() => positionToIndex(3, 0), RangeError);
});

test("a fresh game exposes a frozen snapshot with clues and no hidden solution", () => {
  const game = createNonogram();
  const state = game.getState();
  assert.equal(state.phase, "playing");
  assert.equal(state.puzzleId, "heart");
  assert.equal(state.title, "Little heart");
  assert.equal(state.size, 5);
  assert.equal(state.total, 16);
  assert.deepEqual(state.rows.map((row) => [...row]), [[1, 1], [5], [5], [3], [1]]);
  assert.deepEqual(state.columns.map((col) => [...col]), [[2], [4], [4], [4], [2]]);
  assert.equal(state.cells.length, 25);
  assert.equal(state.filledCount, 0);
  assert.equal(state.markedCount, 0);
  assert.equal(state.mistakes, 0);
  assert.ok(Object.isFrozen(state) && Object.isFrozen(state.cells) && Object.isFrozen(state.rows));
  assert.ok(state.cells.every((cell) => Object.isFrozen(cell) && cell.state === "empty"));
  assert.deepEqual([...CELL_STATES], ["empty", "filled", "marked"]);
  assert.ok(!Object.prototype.hasOwnProperty.call(state, "solution"));
  assert.ok(!JSON.stringify(state).includes('"solution"'));
  assert.strictEqual(game.getState(), state, "unchanged snapshots are the same object");
});

test("fill, mark, clear and their toggles mutate one cell at a time with stable snapshots", () => {
  const game = createNonogram();
  const initial = game.getState();
  let state = game.fill(0);
  assert.equal(state.cells[0].state, "filled");
  assert.equal(state.filledCount, 1);
  assert.strictEqual(game.getState(), state);
  assert.strictEqual(game.fill(0), state, "re-filling is a no-op");
  state = game.toggleFill(0);
  assert.equal(state.cells[0].state, "empty");
  assert.strictEqual(game.getState(), state);
  state = game.toggleFill(0);
  assert.equal(state.cells[0].state, "filled");
  state = game.mark(0);
  assert.equal(state.cells[0].state, "marked");
  assert.equal(state.filledCount, 0);
  assert.equal(state.markedCount, 1);
  assert.strictEqual(game.mark(0), state, "re-marking is a no-op");
  state = game.toggleMark(0);
  assert.equal(state.cells[0].state, "empty");
  state = game.setCell({ row: 0, col: 1 }, "marked");
  assert.equal(state.cells[1].state, "marked");
  state = game.clear(1);
  assert.equal(state.cells[1].state, "empty");
  assert.strictEqual(game.clear(1), state);
  assert.strictEqual(game.getState(), state);
  assert.notStrictEqual(initial, state);
  assert.equal(initial.cells[0].state, "empty", "an older snapshot is never rewritten");
  assert.strictEqual(game.cellAt(0), state.cells[0]);
});

test("wrong fills raise mistakes; marks on blanks are harmless", () => {
  const game = createNonogram();
  // Index 0 is blank in the heart, index 6 is filled.
  let state = game.fill(0);
  assert.equal(state.mistakes, 1);
  state = game.fill(6);
  assert.equal(state.mistakes, 1, "a correct fill does not add a mistake");
  assert.equal(state.filledCount, 2);
  state = game.mark(0);
  assert.equal(state.mistakes, 0, "removing a wrong fill clears its mistake");
  state = game.mark(3); // index 3 is filled in the heart
  assert.equal(state.mistakes, 0, "marks are not mistakes themselves");
  state = game.fill(3);
  assert.equal(state.mistakes, 0, "replacing a mark on a solution cell with a fill is correct");
});

test("wrong marks and wrong fills can never trigger a false win", () => {
  const game = createNonogram();
  const solutionIndices = PUZZLE.solution.flatMap((filled, index) => (filled ? [index] : []));
  const blankIndices = PUZZLE.solution.flatMap((filled, index) => (filled ? [] : [index]));

  // Mark every solution square and fill every blank: all 25 cells decided, still not won.
  for (const index of solutionIndices) game.mark(index);
  for (const index of blankIndices) game.fill(index);
  let state = game.getState();
  assert.equal(state.filledCount, blankIndices.length);
  assert.equal(state.mistakes, blankIndices.length);
  assert.equal(state.phase, "playing", "a fully decided but inverted board is not a win");

  // Fill every cell: 16 correct fills plus 9 wrong ones is still not a win.
  for (const index of solutionIndices) game.fill(index);
  state = game.getState();
  assert.equal(state.filledCount, 25);
  assert.equal(state.mistakes, 9);
  assert.equal(state.phase, "playing");

  // Leave one solution square marked instead of filled: not a win. Reset first,
  // because clearing the wrong fills above already produces a legitimate win.
  game.reset();
  game.mark(solutionIndices[0]);
  for (const index of solutionIndices.slice(1)) game.fill(index);
  state = game.getState();
  assert.equal(state.mistakes, 0);
  assert.equal(state.filledCount, 15);
  assert.equal(state.phase, "playing", "a marked solution square blocks the win");

  // Correcting that last square wins exactly once and locks play.
  state = game.fill(solutionIndices[0]);
  assert.equal(state.phase, "won");
  assert.equal(state.filledCount, 16);
  assert.equal(state.mistakes, 0);
  const won = game.getState();
  assert.strictEqual(game.fill(0), won, "no fills after winning");
  assert.strictEqual(game.mark(0), won, "no marks after winning");
  assert.strictEqual(game.clear(0), won, "no clearing after winning");
  assert.strictEqual(game.toggleFill(0), won);
  assert.strictEqual(game.toggleMark(0), won);
  assert.strictEqual(game.setCell(0, "empty"), won);
});

test("reset clears every cell and play is available again", () => {
  const game = createNonogram();
  for (let index = 0; index < 25; index += 1) game.fill(index);
  assert.equal(game.getState().mistakes, 9);
  const fresh = game.reset();
  assert.equal(fresh.phase, "playing");
  assert.equal(fresh.filledCount, 0);
  assert.equal(fresh.markedCount, 0);
  assert.equal(fresh.mistakes, 0);
  assert.ok(fresh.cells.every((cell) => cell.state === "empty"));
  assert.strictEqual(game.getState(), fresh);
  assert.equal(game.fill(6).phase, "playing", "the engine accepts moves again after reset");
});

test("invalid positions and states throw without changing any cell", () => {
  const game = createNonogram();
  game.fill(6);
  const before = game.getState();
  for (const position of [null, undefined, "6", -1, 25, 2.5, Number.NaN,
    { row: -1, col: 0 }, { row: 5, col: 0 }, { row: 0, col: 5 }]) {
    assert.throws(() => game.fill(position), (error) => error instanceof TypeError || error instanceof RangeError);
    assert.throws(() => game.mark(position), (error) => error instanceof TypeError || error instanceof RangeError);
    assert.throws(() => game.clear(position), (error) => error instanceof TypeError || error instanceof RangeError);
    assert.throws(() => game.toggleFill(position), (error) => error instanceof TypeError || error instanceof RangeError);
    assert.throws(() => game.toggleMark(position), (error) => error instanceof TypeError || error instanceof RangeError);
    assert.throws(() => game.setCell(position, "filled"), (error) => error instanceof TypeError || error instanceof RangeError);
    assert.throws(() => game.cellAt(position), (error) => error instanceof TypeError || error instanceof RangeError);
  }
  assert.throws(() => game.setCell(0, "painted"), TypeError);
  assert.throws(() => game.setCell(0, null), TypeError);
  assert.strictEqual(game.getState(), before, "rejected input leaves the snapshot untouched");
  assert.throws(() => { before.cells[0].state = "filled"; }, TypeError);
  assert.throws(() => { before.rows[0].push(9); }, TypeError);
});

test("a custom, validated puzzle can be injected into the engine", () => {
  const tiny = makePuzzle({ id: "dot", title: "Dot", grid: [".#.", "###", ".#."] });
  const game = createNonogram({ puzzle: tiny });
  const state = game.getState();
  assert.equal(state.size, 3);
  assert.equal(state.total, 5);
  assert.deepEqual(state.rows.map((row) => [...row]), [[1], [3], [1]]);
  for (const index of [1, 3, 4, 5, 7]) game.fill(index);
  assert.equal(game.getState().phase, "won");
  assert.throws(() => createNonogram({ puzzle: { id: "bad" } }), TypeError);
  assert.throws(() => createNonogram(null), TypeError);
});
