/* Mastermind pure engine contract (dependency-free, no DOM, no timers).
   An injectable RNG and an optional explicit secret make every outcome observable
   without exposing the code during play. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CODE_LENGTH,
  COLOR_COUNT,
  MAX_GUESSES,
  PHASES,
  COLOR_NAMES,
  scoreGuess,
  createMastermind,
} from "../../findows/js/apps/mastermind-engine.mjs";

const colorValue = (color) => (color + 0.5) / COLOR_COUNT;

/** RNG yielding one colour per call from the given list, then failing loudly. */
function rngFor(colors) {
  let calls = 0;
  return {
    random() {
      if (calls >= colors.length) throw new Error("test RNG exhausted");
      return colorValue(colors[calls++]);
    },
    calls: () => calls,
  };
}

test("the game contract is four pegs, six colours, ten guesses and three phases", () => {
  assert.equal(CODE_LENGTH, 4);
  assert.equal(COLOR_COUNT, 6);
  assert.equal(MAX_GUESSES, 10);
  assert.deepEqual([...PHASES], ["playing", "won", "lost"]);
  assert.ok(Object.isFrozen(PHASES));
  assert.equal(COLOR_NAMES.length, COLOR_COUNT);
  assert.ok(Object.isFrozen(COLOR_NAMES));
});

test("scoreGuess reports exact and partial hits for the acceptance example", () => {
  assert.deepEqual({ ...scoreGuess([1, 3, 0, 2], [1, 0, 3, 2]) }, { exact: 2, partial: 2 });
});

test("scoreGuess counts each peg at most once, including duplicate colours", () => {
  assert.deepEqual({ ...scoreGuess([0, 0, 1, 1], [0, 1, 0, 1]) }, { exact: 2, partial: 2 });
  assert.deepEqual({ ...scoreGuess([0, 0, 0, 1], [0, 0, 1, 1]) }, { exact: 3, partial: 0 });
  assert.deepEqual({ ...scoreGuess([0, 1, 2, 3], [4, 4, 4, 4]) }, { exact: 0, partial: 0 });
  assert.deepEqual({ ...scoreGuess([0, 1, 2, 3], [0, 1, 2, 3]) }, { exact: 4, partial: 0 });
  assert.deepEqual({ ...scoreGuess([0, 1, 2, 3], [3, 2, 1, 0]) }, { exact: 0, partial: 4 });
});

test("scoreGuess is symmetric in exact/partial counts and returns a frozen result", () => {
  const secret = [0, 0, 1, 2];
  const guess = [0, 2, 2, 5];
  const forward = scoreGuess(secret, guess);
  const reverse = scoreGuess(guess, secret);
  assert.deepEqual({ ...forward }, { ...reverse });
  assert.ok(Object.isFrozen(forward));
});

test("scoreGuess validates both codes without mutating them", () => {
  const secret = [1, 2, 3, 4];
  const guess = [1, 1, 1, 1];
  assert.throws(() => scoreGuess([1, 2, 3], guess), RangeError);
  assert.throws(() => scoreGuess(secret, [1, 2, 3]), RangeError);
  assert.throws(() => scoreGuess([1, 2, 3, 9], guess), RangeError);
  assert.throws(() => scoreGuess(secret, [1, 2, 3, -1]), RangeError);
  assert.throws(() => scoreGuess(secret, [1, 2, 3, 1.5]), RangeError);
  assert.throws(() => scoreGuess(null, guess), TypeError);
  assert.throws(() => scoreGuess(secret, "abcd"), TypeError);
  assert.deepEqual(secret, [1, 2, 3, 4]);
  assert.deepEqual(guess, [1, 1, 1, 1]);
});

test("a fresh game publishes a deeply frozen, secret-free snapshot", () => {
  const game = createMastermind({ random: () => 0.5 });
  const state = game.getState();
  assert.equal(state.phase, "playing");
  assert.equal(state.codeLength, CODE_LENGTH);
  assert.equal(state.colorCount, COLOR_COUNT);
  assert.equal(state.maxGuesses, MAX_GUESSES);
  assert.equal(state.guessCount, 0);
  assert.equal(state.remaining, MAX_GUESSES);
  assert.equal(state.lastFeedback, null);
  assert.deepEqual(state.guesses, []);
  assert.equal(state.secret, null, "the secret is redacted during play");
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.guesses));
  assert.strictEqual(game.getState(), state, "unchanged snapshots keep identity");
  assert.deepEqual(Object.keys(state).sort(), [
    "codeLength", "colorCount", "guessCount", "guesses", "lastFeedback",
    "maxGuesses", "phase", "remaining", "secret",
  ]);
  assert.ok(!JSON.stringify(state).includes('"secret":[0'), "no secret pegs in serialized play state");
});

test("the injectable RNG chooses the secret once, four pegs at a time", () => {
  const rng = rngFor([0, 1, 2, 3]);
  const game = createMastermind({ random: rng.random });
  assert.equal(rng.calls(), 4, "one sample per peg at creation");
  const won = game.guess([0, 1, 2, 3]);
  assert.equal(won.phase, "won", "the sampled colours form the secret");
  assert.equal(rng.calls(), 4, "guessing does not consume RNG values");
  assert.deepEqual([...won.secret], [0, 1, 2, 3]);
});

test("guesses are recorded with exact/partial feedback and respect the guess limit", () => {
  const game = createMastermind({ secret: [1, 3, 0, 2] });
  let state = game.guess([1, 0, 3, 2]);
  assert.equal(state.phase, "playing");
  assert.equal(state.guessCount, 1);
  assert.equal(state.remaining, MAX_GUESSES - 1);
  assert.equal(state.guesses.length, 1);
  assert.deepEqual([...state.guesses[0].code], [1, 0, 3, 2]);
  assert.ok(Object.isFrozen(state.guesses[0]) && Object.isFrozen(state.guesses[0].code));
  assert.deepEqual({ ...state.lastFeedback }, { exact: 2, partial: 2 });

  const previous = state;
  state = game.guess([4, 4, 4, 4]);
  assert.equal(state.guessCount, 2);
  assert.equal(previous.guessCount, 1, "an older snapshot is never rewritten");
  assert.deepEqual({ ...state.lastFeedback }, { exact: 0, partial: 0 });
  assert.equal(state.guesses.length, 2);
});

test("an explicit secret is honoured and a perfect guess wins and locks the game", () => {
  const game = createMastermind({ secret: [1, 3, 0, 2], random: () => { throw new Error("unused"); } });
  const won = game.guess([1, 3, 0, 2]);
  assert.equal(won.phase, "won");
  assert.deepEqual({ ...won.lastFeedback }, { exact: CODE_LENGTH, partial: 0 });
  assert.deepEqual([...won.secret], [1, 3, 0, 2], "the secret is revealed on win");
  assert.ok(Object.isFrozen(won.secret));
  assert.strictEqual(game.getState(), won);
  const blocked = game.guess([0, 0, 0, 0]);
  assert.strictEqual(blocked, won, "play is locked after a win");
  assert.equal(blocked.guessCount, 1);
});

test("the last wrong guess loses, reveals the secret and locks the game", () => {
  const game = createMastermind({ secret: [1, 3, 0, 2] });
  let state = game.getState();
  for (let attempt = 0; attempt < MAX_GUESSES; attempt += 1) {
    state = game.guess([4, 4, 4, 4]);
    assert.equal(state.guesses.length, attempt + 1);
  }
  assert.equal(state.phase, "lost");
  assert.equal(state.remaining, 0);
  assert.deepEqual([...state.secret], [1, 3, 0, 2]);
  assert.strictEqual(game.getState(), state);
  assert.strictEqual(game.guess([0, 1, 2, 3]), state, "play is locked after a loss");
  assert.equal(state.guessCount, MAX_GUESSES);
});

test("reset starts a fresh game with a new RNG secret and clears history", () => {
  const rng = rngFor([0, 1, 2, 3, 4, 5, 0, 1]);
  const game = createMastermind({ random: rng.random });
  assert.equal(game.guess([0, 1, 2, 3]).phase, "won");
  const fresh = game.reset();
  assert.equal(fresh.phase, "playing");
  assert.equal(fresh.guessCount, 0);
  assert.equal(fresh.remaining, MAX_GUESSES);
  assert.equal(fresh.lastFeedback, null);
  assert.equal(fresh.secret, null);
  assert.deepEqual(fresh.guesses, []);
  assert.strictEqual(game.getState(), fresh);
  assert.equal(game.guess([4, 5, 0, 1]).phase, "won", "reset generates a new secret from the RNG");
});

test("an explicit secret is reused on reset for reproducible games", () => {
  const game = createMastermind({ secret: [2, 2, 5, 5] });
  game.guess([2, 2, 5, 5]);
  assert.equal(game.getState().phase, "won");
  const fresh = game.reset();
  assert.equal(fresh.phase, "playing");
  assert.equal(fresh.guessCount, 0);
  assert.equal(game.guess([2, 2, 5, 5]).phase, "won");
});

test("invalid guesses throw before mutating state", () => {
  const game = createMastermind({ secret: [0, 1, 2, 3] });
  const initial = game.getState();
  const bad = [null, undefined, "0123", [], [0, 1, 2], [0, 1, 2, 3, 4], [0, 1, 2, -1],
    [0, 1, 2, 6], [0, 1, 2, 1.5], [0, 1, 2, Number.NaN], [0, 1, 2, "3"]];
  for (const code of bad) {
    assert.throws(() => game.guess(code),
      (error) => error instanceof TypeError || error instanceof RangeError, `guess ${String(code)}`);
  }
  assert.strictEqual(game.getState(), initial, "rejected guesses leave the snapshot untouched");
  assert.equal(initial.guessCount, 0);
});

test("invalid construction options and malformed RNG values are rejected", () => {
  assert.throws(() => createMastermind(null), TypeError);
  assert.throws(() => createMastermind({ random: 42 }), TypeError);
  assert.throws(() => createMastermind({ random: () => 1 }), RangeError);
  assert.throws(() => createMastermind({ random: () => -0.01 }), RangeError);
  assert.throws(() => createMastermind({ random: () => Number.NaN }), RangeError);
  assert.throws(() => createMastermind({ secret: [1, 2, 3] }), RangeError);
  assert.throws(() => createMastermind({ secret: [1, 2, 3, 9] }), RangeError);
  assert.throws(() => createMastermind({ secret: "1234" }), TypeError);
});
