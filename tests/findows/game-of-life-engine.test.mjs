/* Gate: Game of Life pure model (no DOM, no timers, no dependencies).
   The glider acceptance case asserts a real four-generation translation, and
   every mutation path is checked for invalid input and snapshot immutability. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CELL_COUNT,
  GRID_HEIGHT,
  GRID_WIDTH,
  PRESETS,
  createGameOfLife,
  getPresetCells,
  indexToPosition,
  neighborIndices,
  positionToIndex,
  stepCells,
} from "../../findows/js/apps/game-of-life-engine.mjs";

const toCoords = (cells) => {
  const result = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]) result.push([Math.floor(index / GRID_WIDTH), index % GRID_WIDTH]);
  }
  return result;
};
const shifted = (coords, dr, dc) => coords.map(([row, col]) => [row + dr, col + dc]).sort();
const sorted = (coords) => coords.slice().sort();
const key = (coords) => JSON.stringify(sorted(coords));

test("the model contract is a fixed 20x14 world with a frozen preset catalog", () => {
  assert.equal(GRID_WIDTH, 20);
  assert.equal(GRID_HEIGHT, 14);
  assert.equal(CELL_COUNT, 280);
  assert.ok(PRESETS.includes("glider"));
  assert.deepEqual([...PRESETS], [
    "glider", "blinker", "toad", "beacon", "block", "beehive", "lightweight-spaceship", "pulsar",
  ]);
  assert.ok(Object.isFrozen(PRESETS));
});

test("position helpers validate and convert row/col, index and wrapped neighbors", () => {
  assert.equal(positionToIndex({ row: 2, col: 3 }), 43);
  assert.equal(positionToIndex(43), 43);
  assert.deepEqual({ ...indexToPosition(43) }, { row: 2, col: 3 });
  assert.deepEqual({ ...indexToPosition(279) }, { row: 13, col: 19 });
  assert.ok(Object.isFrozen(indexToPosition(43)));
  assert.equal(neighborIndices(0).length, 3, "a corner has three bounded neighbors");
  assert.equal(neighborIndices(43).length, 8, "an interior cell has eight");
  assert.equal(neighborIndices(0, { wrap: true }).length, 8, "wrap makes the corner toroidal");
  assert.ok(neighborIndices(0, { wrap: true }).includes(279), "wrap connects the last column");
  assert.ok(!neighborIndices(43).includes(43), "a cell is never its own neighbor");
  for (const bad of [null, undefined, "12", -1, 280, 1.5, Number.NaN, { row: -1, col: 0 },
    { row: 14, col: 0 }, { row: 0, col: 20 }, { row: 1.5, col: 2 }, { row: Number.NaN, col: 0 }]) {
    assert.throws(() => positionToIndex(bad), (error) => error instanceof TypeError || error instanceof RangeError,
      `positionToIndex ${String(bad)}`);
  }
  assert.throws(() => indexToPosition(-1), RangeError);
  assert.throws(() => neighborIndices(0, { wrap: "yes" }), TypeError);
});

test("a fresh world is a cached, deeply frozen, empty bounded snapshot", () => {
  const game = createGameOfLife();
  const state = game.getState();
  assert.equal(state.width, GRID_WIDTH);
  assert.equal(state.height, GRID_HEIGHT);
  assert.equal(state.generation, 0);
  assert.equal(state.population, 0);
  assert.equal(state.wrap, false);
  assert.equal(state.preset, null);
  assert.equal(state.cells.length, CELL_COUNT);
  assert.ok(state.cells.every((cell) => cell === false));
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.cells));
  assert.strictEqual(game.getState(), state, "unchanged snapshots are the same object");
  assert.deepEqual(Object.keys(state).sort(), ["cells", "generation", "height", "population", "preset", "width", "wrap"]);
});

test("every shipped preset fits the world and is returned as a frozen index list", () => {
  for (const name of PRESETS) {
    const cells = getPresetCells(name);
    assert.ok(Object.isFrozen(cells), `${name} is frozen`);
    assert.ok(cells.length > 0, `${name} has live cells`);
    assert.ok(cells.every((index) => Number.isInteger(index) && index >= 0 && index < CELL_COUNT),
      `${name} stays inside the world`);
    assert.equal(new Set(cells).size, cells.length, `${name} has no duplicate cells`);
  }
  assert.throws(() => getPresetCells("nope"), RangeError);
  assert.throws(() => getPresetCells(null), TypeError);
});

test("ACCEPTANCE: the glider preset translates one row and one column after four generations", () => {
  const game = createGameOfLife();
  game.loadPreset("glider");
  const before = game.getState();
  assert.equal(key(toCoords(before.cells)), key([[2, 4], [3, 5], [4, 3], [4, 4], [4, 5]]));
  assert.equal(before.preset, "glider");
  assert.equal(before.generation, 0);
  assert.equal(before.population, 5);
  for (let generation = 1; generation <= 4; generation += 1) {
    const state = game.step();
    assert.equal(state.generation, generation);
  }
  const after = game.getState();
  assert.equal(key(toCoords(after.cells)), key(shifted(toCoords(before.cells), 1, 1)),
    "the same five-cell shape appears one row down and one column right");
  assert.equal(after.population, 5, "a glider preserves its population");
});

test("the blinker oscillates with period two and a block is a still life", () => {
  const blinker = createGameOfLife();
  blinker.loadPreset("blinker");
  const start = key(toCoords(blinker.getState().cells));
  const horizontal = key(toCoords(blinker.step().cells));
  assert.notEqual(horizontal, start, "the vertical blinker flips");
  assert.equal(key(toCoords(blinker.step().cells)), start, "two steps return to the vertical blinker");

  const block = createGameOfLife();
  block.loadPreset("block");
  const still = key(toCoords(block.getState().cells));
  for (let i = 0; i < 5; i += 1) block.step();
  assert.equal(key(toCoords(block.getState().cells)), still, "a block never changes");
});

test("the lightweight spaceship translates two columns in four generations", () => {
  const game = createGameOfLife();
  game.loadPreset("lightweight-spaceship");
  const before = key(toCoords(game.getState().cells));
  for (let i = 0; i < 4; i += 1) game.step();
  const after = game.getState().cells;
  assert.equal(key(toCoords(after)), key(shifted(JSON.parse(before), 0, 2)),
    "the spaceship keeps its nine-cell shape while moving right");
});

test("wrap toggles toroidal neighbors and changes an edge birth", () => {
  const bounded = createGameOfLife();
  const wrapped = createGameOfLife();
  wrapped.setWrap(true);
  assert.equal(wrapped.getState().wrap, true);
  // Three live cells around the far edge become three neighbors of (5,19)
  // only when the world wraps; birth then needs exactly three.
  for (const game of [bounded, wrapped]) {
    game.setCell({ row: 5, col: 0 }, true);
    game.setCell({ row: 6, col: GRID_WIDTH - 1 }, true);
    game.setCell({ row: 4, col: 0 }, true);
  }
  const boundedNext = stepCells(bounded.getState().cells, GRID_WIDTH, GRID_HEIGHT, false);
  const wrappedNext = stepCells(wrapped.getState().cells, GRID_WIDTH, GRID_HEIGHT, true);
  assert.equal(boundedNext[5 * GRID_WIDTH + GRID_WIDTH - 1], false, "bounded edges do not meet");
  assert.equal(wrappedNext[5 * GRID_WIDTH + GRID_WIDTH - 1], true, "wrap births a cell across the seam");
  assert.throws(() => wrapped.setWrap("true"), TypeError);
  assert.throws(() => stepCells([], 0, 0, false), TypeError);
});

test("stepCells is pure and follows birth, survival, death and underpopulation", () => {
  const cells = new Array(CELL_COUNT).fill(false);
  cells[5 * GRID_WIDTH + 5] = true; // lone cell dies
  const snapshot = cells.slice();
  const next = stepCells(cells, GRID_WIDTH, GRID_HEIGHT, false);
  assert.equal(next[5 * GRID_WIDTH + 5], false, "underpopulation kills a lone cell");
  assert.deepEqual(cells, snapshot, "the input array is never mutated");
  assert.ok(Object.isFrozen(next), "the returned generation is frozen");

  // Three neighbors birth a cell; exactly two or three keep a live cell alive.
  const block = getPresetCells("block");
  const blockCells = new Array(CELL_COUNT).fill(false);
  for (const index of block) blockCells[index] = true;
  assert.deepEqual(toCoords(stepCells(blockCells, GRID_WIDTH, GRID_HEIGHT, false)), toCoords(blockCells));
});

test("toggleCell, setCell, clear, loadPreset and randomize drive one cached snapshot", () => {
  let sample = 0;
  const game = createGameOfLife({ random: () => (sample++ % 10) / 10 });
  const empty = game.getState();
  assert.strictEqual(game.toggleCell(0), game.getState());
  assert.notStrictEqual(game.getState(), empty, "a change publishes a new snapshot");
  assert.equal(game.getState().cells[0], true);
  assert.equal(game.getState().population, 1);
  assert.equal(game.getState().preset, null, "editing marks the world custom");
  game.setCell(0, false);
  assert.deepEqual(game.getState(), empty, "setting the cell back restores the empty world");
  const restored = game.getState();
  assert.strictEqual(game.setCell(0, false), restored, "setting an unchanged value is a stable no-op");

  game.loadPreset("blinker");
  assert.equal(game.getState().preset, "blinker");
  assert.equal(game.getState().population, 3);
  assert.equal(game.getState().generation, 0, "loading a preset resets the generation clock");
  assert.throws(() => game.loadPreset("unknown"), RangeError);
  assert.equal(game.getState().preset, "blinker", "a failed load does not mutate");

  game.step();
  assert.equal(game.getState().generation, 1);
  const cleared = game.clear();
  assert.equal(cleared.generation, 0);
  assert.equal(cleared.population, 0);
  assert.equal(cleared.preset, null);
  assert.ok(cleared.cells.every((cell) => cell === false));

  const randomized = game.randomize({ density: 0.5 });
  assert.ok(randomized.population > 0 && randomized.population < CELL_COUNT,
    `randomize produced ${randomized.population} live cells`);
  assert.equal(randomized.generation, 0);
  assert.equal(randomized.preset, null);
});

test("randomize uses only a valid injected RNG and rejects malformed values", () => {
  assert.throws(() => createGameOfLife({ random: 42 }), TypeError);
  assert.throws(() => createGameOfLife(null), TypeError);
  const bad = createGameOfLife({ random: () => 1 });
  assert.throws(() => bad.randomize(), RangeError);
  assert.equal(bad.getState().generation, 0, "a rejected RNG leaves no partial world");
  const badDensity = createGameOfLife();
  assert.throws(() => badDensity.randomize({ density: 0 }), RangeError);
  assert.throws(() => badDensity.randomize({ density: 2 }), RangeError);
  assert.throws(() => badDensity.randomize({ density: "many" }), TypeError);

  // A deterministic 0.5 RNG with density 0.5 fills every cell.
  const full = createGameOfLife({ random: () => 0.5 });
  assert.equal(full.randomize({ density: 0.5 }).population, CELL_COUNT);
});

test("invalid positions never mutate state", () => {
  const game = createGameOfLife();
  const initial = game.getState();
  const bad = [null, undefined, "12", -1, 280, 1.5, Number.NaN, { row: -1, col: 0 },
    { row: 14, col: 0 }, { row: 0, col: 20 }, { row: 1.5, col: 2 }];
  for (const position of bad) {
    assert.throws(() => game.toggleCell(position), (error) => error instanceof TypeError || error instanceof RangeError,
      `toggleCell ${String(position)}`);
    assert.throws(() => game.setCell(position, true), (error) => error instanceof TypeError || error instanceof RangeError,
      `setCell ${String(position)}`);
    assert.throws(() => game.cellAt(position), (error) => error instanceof TypeError || error instanceof RangeError,
      `cellAt ${String(position)}`);
  }
  assert.strictEqual(game.getState(), initial, "rejected input leaves the snapshot untouched");
});

test("snapshots are immutable historical views", () => {
  const game = createGameOfLife();
  game.loadPreset("glider");
  const first = game.getState();
  game.step();
  const second = game.getState();
  assert.notStrictEqual(second, first);
  assert.equal(first.generation, 0, "an old snapshot never advances");
  assert.equal(first.population, 5);
  assert.throws(() => { first.cells[0] = true; }, TypeError);
  assert.throws(() => { first.cells.length = 0; }, TypeError);
  assert.throws(() => { second.generation = 99; }, TypeError);
});
