/* Gate: Snake grid engine (pure, dependency-free, no DOM and no timers).
   The engine is a set of pure state reducers plus a thin stateful wrapper. Tests
   call the reducers with hand-built states so collisions, growth and win are
   deterministic without driving the UI clock. An injected RNG makes food
   placement observable. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DIRECTIONS,
  advanceState,
  createSnake,
  initialState,
  pauseState,
  resetState,
  resumeState,
  setWrapState,
  startState,
  togglePauseState,
  turnState,
} from "../../findows/js/apps/snake-engine.mjs";

const OPT = (overrides = {}) => ({ width: 15, height: 15, wrap: false, random: () => 0, ...overrides });

function state(overrides = {}) {
  return {
    phase: "playing",
    width: 15,
    height: 15,
    wrap: false,
    snake: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }],
    direction: "right",
    pendingDirection: "right",
    food: { x: 9, y: 9 },
    score: 0,
    reason: null,
    ...overrides,
  };
}

test("exports a frozen direction table with orthogonal unit vectors", () => {
  assert.ok(Object.isFrozen(DIRECTIONS));
  assert.deepEqual(Object.keys(DIRECTIONS).sort(), ["down", "left", "right", "up"]);
  assert.deepEqual({ ...DIRECTIONS.up }, { x: 0, y: -1 });
  assert.deepEqual({ ...DIRECTIONS.down }, { x: 0, y: 1 });
  assert.deepEqual({ ...DIRECTIONS.left }, { x: -1, y: 0 });
  assert.deepEqual({ ...DIRECTIONS.right }, { x: 1, y: 0 });
  for (const vector of Object.values(DIRECTIONS)) assert.ok(Object.isFrozen(vector));
});

test("initialState centers a length-3 snake, places food off it and is deeply frozen", () => {
  const fresh = initialState(OPT());
  assert.equal(fresh.phase, "ready");
  assert.equal(fresh.width, 15);
  assert.equal(fresh.height, 15);
  assert.equal(fresh.wrap, false);
  assert.equal(fresh.direction, "right");
  assert.equal(fresh.pendingDirection, "right");
  assert.equal(fresh.score, 0);
  assert.equal(fresh.reason, null);
  assert.deepEqual(fresh.snake.map((p) => ({ ...p })), [{ x: 7, y: 7 }, { x: 6, y: 7 }, { x: 5, y: 7 }]);
  assert.deepEqual({ ...fresh.food }, { x: 0, y: 0 }, "RNG () => 0 picks the first free cell (top-left)");
  assert.ok(Object.isFrozen(fresh));
  assert.ok(Object.isFrozen(fresh.snake) && fresh.snake.every((p) => Object.isFrozen(p)));
  assert.ok(Object.isFrozen(fresh.food));
  assert.throws(() => { fresh.snake[0].x = 99; }, TypeError);
  assert.throws(() => { fresh.phase = "playing"; }, TypeError);
});

test("food placement is deterministic from the injected RNG and rejects bad values", () => {
  const first = initialState(OPT({ random: () => 0 })).food;
  assert.deepEqual({ ...first }, { x: 0, y: 0 });
  const last = initialState(OPT({ random: () => 0.999999 })).food;
  assert.deepEqual({ ...last }, { x: 14, y: 14 }, "RNG near 1 picks the last free cell");
  const mid = initialState(OPT({ random: () => 0.5 })).food;
  assert.ok(mid && Number.isInteger(mid.x) && Number.isInteger(mid.y));
  const occupied = new Set(initialState(OPT()).snake.map((p) => `${p.x},${p.y}`));
  assert.ok(!occupied.has(`${mid.x},${mid.y}`), "food never lands on the snake");
  assert.throws(() => initialState(OPT({ random: () => 1 })), RangeError);
  assert.throws(() => initialState(OPT({ random: () => Number.NaN })), RangeError);
  assert.throws(() => initialState(OPT({ random: 42 })), TypeError);
});

test("start only activates a ready game; turn sets direction in ready and validates input", () => {
  const fresh = initialState(OPT());
  const playing = startState(fresh);
  assert.equal(playing.phase, "playing");
  assert.strictEqual(startState(playing), playing, "start is idempotent");
  assert.throws(() => turnState(fresh, "diagonal"), RangeError);
  const up = turnState(fresh, "up");
  assert.equal(up.direction, "up");
  assert.equal(up.pendingDirection, "up");
  assert.strictEqual(turnState(fresh, "right"), fresh, "same direction is a no-op");
  assert.strictEqual(turnState(fresh, "left"), fresh, "reversal is ignored even in ready");
});

test("turns reject reversals, ignore same-direction presses and respect paused/over locks", () => {
  const live = state();
  const up = turnState(live, "up");
  assert.equal(up.pendingDirection, "up");
  assert.equal(up.direction, "right", "committed direction does not change until a step");
  assert.strictEqual(turnState(live, "left"), live, "left is opposite of right");
  assert.strictEqual(turnState(live, "right"), live, "right is already committed");
  assert.strictEqual(turnState(live, "down").pendingDirection, "down", "down is a legal 90-degree turn");

  const paused = pauseState(live);
  assert.strictEqual(turnState(paused, "up"), paused, "no turns while paused");
  const over = { ...live, phase: "over", reason: "wall" };
  assert.strictEqual(turnState(over, "up"), over, "no turns after game over");
});

test("advanceState moves head and tail at constant length without eating", () => {
  const before = state();
  const after = advanceState(before, OPT());
  assert.deepEqual(after.snake.map((p) => ({ ...p })), [{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 }]);
  assert.equal(after.length, 3);
  assert.equal(after.score, 0);
  assert.equal(after.direction, "right");
  assert.deepEqual({ ...after.food }, { ...before.food }, "food is untouched when not eaten");
  assert.equal(after.phase, "playing");
  assert.notStrictEqual(after, before);
});

test("eating grows the snake, scores and relocates food off the body", () => {
  const before = state({ food: { x: 6, y: 5 } });
  const after = advanceState(before, OPT({ random: () => 0 }));
  assert.equal(after.score, 10);
  assert.equal(after.length, 4);
  assert.deepEqual(after.snake.map((p) => ({ ...p })), [{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }]);
  assert.deepEqual({ ...after.food }, { x: 0, y: 0 }, "new food is deterministic and off the grown body");
  assert.ok(!after.snake.some((p) => p.x === after.food.x && p.y === after.food.y));
});

test("wall collision ends play with wall reason and locks all actions until reset", () => {
  const before = state({ snake: [{ x: 14, y: 5 }, { x: 13, y: 5 }, { x: 12, y: 5 }] });
  const over = advanceState(before, OPT());
  assert.equal(over.phase, "over");
  assert.equal(over.reason, "wall");
  assert.deepEqual(over.snake.map((p) => ({ ...p })), before.snake, "head never enters the wall");
  assert.strictEqual(advanceState(over, OPT()), over, "no stepping after game over");
  assert.strictEqual(turnState(over, "up"), over);
  assert.strictEqual(startState(over), over);
  assert.strictEqual(pauseState(over), over);
  assert.strictEqual(resumeState(over), over);
  assert.strictEqual(setWrapState(over, true), over);
  const fresh = resetState(OPT());
  assert.equal(fresh.phase, "ready");
  assert.equal(fresh.score, 0);
  assert.equal(fresh.reason, null);
});

test("wrap mode teleports across edges instead of colliding", () => {
  const wrapped = state({ wrap: true, snake: [{ x: 14, y: 5 }, { x: 13, y: 5 }, { x: 12, y: 5 }] });
  const after = advanceState(wrapped, OPT({ wrap: true }));
  assert.equal(after.phase, "playing");
  assert.equal(after.reason, null);
  assert.deepEqual({ ...after.snake[0] }, { x: 0, y: 5 }, "head wraps to the left edge");
  const vertical = state({ wrap: true, direction: "up", pendingDirection: "up", snake: [{ x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }] });
  assert.deepEqual({ ...advanceState(vertical, OPT({ wrap: true })).snake[0] }, { x: 5, y: 14 });
});

test("self collision ends play with self reason", () => {
  const before = state({
    width: 8,
    height: 8,
    snake: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 4 }, { x: 6, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 4 }],
    direction: "left",
    pendingDirection: "up",
    food: { x: 0, y: 0 },
  });
  const over = advanceState(before, OPT({ width: 8, height: 8 }));
  assert.equal(over.phase, "over");
  assert.equal(over.reason, "self");
});

test("moving into the tail cell is legal when the tail vacates this step", () => {
  const before = state({
    snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 5 }],
    direction: "left",
    pendingDirection: "left",
    food: { x: 12, y: 12 },
  });
  const after = advanceState(before, OPT());
  assert.equal(after.phase, "playing");
  assert.deepEqual(after.snake.map((p) => ({ ...p })), [{ x: 4, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 6 }]);
});

test("filling the board wins without placing another food", () => {
  let calls = 0;
  const never = { ...state().food, x: 0, y: 0 };
  const full = state({
    width: 3,
    height: 3,
    snake: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }],
    direction: "left",
    pendingDirection: "left",
    food: { ...never },
  });
  const won = advanceState(full, OPT({ width: 3, height: 3, random: () => { calls += 1; return 0; } }));
  assert.equal(won.phase, "over");
  assert.equal(won.reason, "win");
  assert.equal(won.length, 9);
  assert.equal(calls, 0, "no food placement when the board is full");
  assert.equal(won.food, null);
});

test("pause, resume and togglePause only affect live phases", () => {
  const live = state();
  const paused = pauseState(live);
  assert.equal(paused.phase, "paused");
  assert.strictEqual(pauseState(paused), paused);
  assert.strictEqual(advanceState(paused, OPT()), paused, "a paused game does not move");
  const resumed = resumeState(paused);
  assert.equal(resumed.phase, "playing");
  assert.strictEqual(resumeState(live), live);
  assert.equal(togglePauseState(live).phase, "paused");
  assert.equal(togglePauseState(paused).phase, "playing");
  assert.strictEqual(togglePauseState({ ...live, phase: "ready" }).phase, "ready");
  assert.strictEqual(togglePauseState({ ...live, phase: "over" }).phase, "over");
});

test("setWrap toggles only when the game is not over", () => {
  const live = state();
  const wrapped = setWrapState(live, true);
  assert.equal(wrapped.wrap, true);
  assert.strictEqual(setWrapState(wrapped, true), wrapped);
  assert.strictEqual(setWrapState(live, false), live);
  const over = { ...live, phase: "over", reason: "wall" };
  assert.strictEqual(setWrapState(over, true), over);
});

test("the stateful wrapper exposes the mount-facing API and caches snapshots", () => {
  const game = createSnake(OPT());
  const api = ["getState", "start", "turn", "step", "pause", "resume", "togglePause", "setWrap", "reset", "restart"];
  for (const name of api) assert.equal(typeof game[name], "function", `${name} exists`);
  assert.ok(Object.isFrozen(game));
  const fresh = game.getState();
  assert.equal(fresh.phase, "ready");
  assert.strictEqual(game.getState(), fresh, "unchanged snapshots keep identity");
  assert.strictEqual(game.turn("left"), fresh, "a no-op turn does not change the snapshot");
  const playing = game.start();
  assert.equal(playing.phase, "playing");
  assert.strictEqual(game.start(), playing);
  const turned = game.turn("up");
  assert.equal(turned.pendingDirection, "up");
  const stepped = game.step();
  assert.equal(stepped.direction, "up");
  const paused = game.pause();
  assert.equal(paused.phase, "paused");
  assert.strictEqual(game.step(), paused, "stepping while paused is a no-op");
  assert.equal(game.resume().phase, "playing");
  assert.equal(game.setWrap(true).wrap, true);
  assert.strictEqual(game.getState(), game.getState());
});

test("reset restarts a fresh ready game and restart is an alias", () => {
  const game = createSnake(OPT({ random: () => 0 }));
  game.start();
  for (let i = 0; i < 5; i += 1) game.step();
  assert.ok(game.getState().score >= 0);
  const fresh = game.reset();
  assert.equal(fresh.phase, "ready");
  assert.equal(fresh.score, 0);
  assert.equal(fresh.length, 3);
  assert.equal(fresh.reason, null);
  assert.deepEqual({ ...fresh.food }, { x: 0, y: 0 });
  assert.deepEqual(game.restart(), game.reset(), "restart and reset both yield a fresh ready state");
});

test("invalid options are rejected before any state is built", () => {
  assert.throws(() => createSnake(null), TypeError);
  assert.throws(() => initialState(OPT({ width: 2 })), RangeError);
  assert.throws(() => initialState(OPT({ height: 1.5 })), RangeError);
  assert.throws(() => initialState(OPT({ wrap: "yes" })), TypeError);
  assert.ok(initialState(OPT({ width: 3, height: 3 })).phase === "ready", "3x3 is the minimum board");
});

test("reset preserves the current wrap setting instead of reverting to creation defaults", () => {
  const game = createSnake(OPT({ random: () => 0 }));
  game.setWrap(true);
  game.start();
  const fresh = game.reset();
  assert.equal(fresh.wrap, true, "wrap survives a restart");
  assert.equal(fresh.phase, "ready");
  assert.equal(fresh.score, 0);
  assert.equal(game.restart().wrap, true, "restart keeps wrap too");
});

test("terminal lock survives every reducer except reset", () => {
  const over = { ...state(), phase: "over", reason: "self" };
  assert.strictEqual(advanceState(over, OPT()), over);
  assert.strictEqual(turnState(over, "up"), over);
  assert.strictEqual(pauseState(over), over);
  assert.strictEqual(resumeState(over), over);
  assert.strictEqual(togglePauseState(over), over);
  assert.strictEqual(startState(over), over);
  assert.strictEqual(setWrapState(over, true), over);
  assert.notStrictEqual(resetState(OPT()), over);
});
