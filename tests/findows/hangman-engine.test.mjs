/* Hangman pure-logic gate: bundled words, injectable RNG, truthful reveals,
   bounded misses, terminal lock and a clean reset. No DOM, no network. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_MISSES,
  PHASES,
  WORDS,
  createHangman,
  formatWord,
} from "../../findows/js/apps/hangman-engine.mjs";

/** RNG returning a queued list of [0,1) samples; repeats the last value when exhausted. */
function queuedRandom(values) {
  let cursor = 0;
  const calls = [];
  return {
    calls,
    random() {
      const index = Math.min(cursor, values.length - 1);
      const value = values[index];
      cursor += 1;
      calls.push(value);
      return value;
    },
  };
}

/** Pick the [0,1) sample that selects `index` from a list of `size` words. */
const sampleFor = (index, size) => (index + 0.5) / size;

test("the contract is a bundled local word list, six misses and four phases", () => {
  assert.equal(MAX_MISSES, 6);
  assert.deepEqual([...PHASES], ["ready", "playing", "won", "lost"]);
  assert.ok(Object.isFrozen(PHASES));
  assert.ok(Array.isArray(WORDS) && WORDS.length >= 60, `bundled ${WORDS.length} words`);
  assert.ok(Object.isFrozen(WORDS));
  assert.equal(new Set(WORDS).size, WORDS.length, "bundled words are unique");
  assert.ok(WORDS.every((word) => /^[A-Z]{3,12}$/.test(word)), "every word is plain A-Z");
  assert.ok(WORDS.includes("BANANA"), "bundled list contains a repeated-letter word");
});

test("a fresh game is frozen and never leaks the secret word", () => {
  const rng = queuedRandom([0]);
  const game = createHangman({ random: rng.random });
  const state = game.getState();
  assert.equal(state.phase, "ready");
  assert.equal(state.wordLength, 6, "the first bundled word is BANANA");
  assert.equal(state.maxMisses, 6);
  assert.equal(state.misses, 0);
  assert.equal(state.remaining, 6);
  assert.deepEqual([...state.guesses], []);
  assert.deepEqual([...state.guessedLetters], []);
  assert.deepEqual([...state.letters], [null, null, null, null, null, null]);
  assert.equal(state.word, null, "the secret is redacted while playing");
  assert.equal(formatWord(state), "· · · · · ·");
  assert.ok(Object.isFrozen(state) && Object.isFrozen(state.letters) && Object.isFrozen(state.guesses));
  assert.ok(state.guesses.every((guess) => Object.isFrozen(guess)));
  assert.strictEqual(game.getState(), state, "unchanged snapshots are cached");
  assert.ok(!JSON.stringify(state).includes("BANANA"), "serialized play state hides the word");
  assert.equal(rng.calls.length, 1, "the RNG chose one word at creation");
});

test("injectable RNG and a custom local word list choose the secret deterministically", () => {
  const rng = queuedRandom([sampleFor(2, 4)]);
  const game = createHangman({ random: rng.random, words: ["CAT", "DOG", "BIRD", "FISH"] });
  assert.equal(game.getState().wordLength, 4);
  game.guess("B");
  game.guess("I");
  game.guess("R");
  const won = game.guess("D");
  assert.equal(won.phase, "won");
  assert.equal(won.word, "BIRD");
  assert.deepEqual(rng.calls, [sampleFor(2, 4)], "one RNG sample per chosen word");
});

test("a correct guess reveals every occurrence and accepts either case", () => {
  const game = createHangman({ words: ["BANANA"] });
  const state = game.guess("a");
  assert.equal(state.phase, "playing");
  assert.deepEqual([...state.letters], [null, "A", null, "A", null, "A"]);
  assert.equal(formatWord(state, "_"), "_ A _ A _ A");
  assert.deepEqual([...state.guesses], [{ letter: "A", correct: true }]);
  assert.deepEqual([...state.guessedLetters], ["A"]);
  assert.equal(state.misses, 0);
  assert.strictEqual(game.guess("A"), state, "repeating a letter is a stable no-op");
  assert.strictEqual(game.getState(), state);
});

test("a wrong guess spends exactly one miss and reveals nothing", () => {
  const game = createHangman({ words: ["BANANA"] });
  const state = game.guess("z");
  assert.equal(state.phase, "playing");
  assert.equal(state.misses, 1);
  assert.equal(state.remaining, MAX_MISSES - 1);
  assert.deepEqual([...state.letters], [null, null, null, null, null, null]);
  assert.deepEqual([...state.guesses], [{ letter: "Z", correct: false }]);
  assert.strictEqual(game.guess("z"), state, "a repeated wrong letter costs nothing");
  assert.equal(game.getState().misses, 1);
});

test("guessing every distinct letter wins, reveals the word and locks play", () => {
  const game = createHangman({ words: ["CAT"] });
  let state = game.guess("T");
  assert.equal(state.phase, "playing", "a partial reveal is not a win");
  state = game.guess("A");
  assert.equal(state.phase, "playing");
  state = game.guess("C");
  assert.equal(state.phase, "won");
  assert.equal(state.word, "CAT");
  assert.deepEqual([...state.letters], ["C", "A", "T"]);
  assert.equal(state.remaining, MAX_MISSES);
  assert.strictEqual(game.guess("Z"), state, "no guesses after a win");
  assert.strictEqual(game.guess("C"), state);
  assert.strictEqual(game.getState(), state);
});

test("the sixth distinct miss loses, reveals the word and locks play", () => {
  const game = createHangman({ words: ["CAT"] });
  const wrong = ["D", "E", "F", "G", "H"];
  for (const letter of wrong) assert.equal(game.guess(letter).phase, "playing");
  const lost = game.guess("I");
  assert.equal(lost.phase, "lost");
  assert.equal(lost.misses, MAX_MISSES);
  assert.equal(lost.remaining, 0);
  assert.equal(lost.word, "CAT", "the answer is disclosed at game over");
  assert.deepEqual([...lost.letters], ["C", "A", "T"]);
  assert.strictEqual(game.guess("J"), lost, "no guesses after a loss");
  assert.strictEqual(game.guess("C"), lost, "even a correct letter cannot rescue a loss");
  assert.equal(game.getState().misses, MAX_MISSES, "misses never exceed the limit");
});

test("mixing correct and wrong guesses keeps the mask and miss count truthful", () => {
  const game = createHangman({ words: ["CHEESE"] });
  let state = game.guess("E");
  assert.deepEqual([...state.letters], [null, null, "E", "E", null, "E"]);
  state = game.guess("X");
  assert.equal(state.misses, 1);
  state = game.guess("S");
  assert.deepEqual([...state.letters], [null, null, "E", "E", "S", "E"]);
  assert.equal(state.phase, "playing");
  state = game.guess("H");
  assert.deepEqual([...state.letters], [null, "H", "E", "E", "S", "E"]);
  assert.equal(formatWord(state, "_"), "_ H E E S E");
  assert.equal(state.misses, 1, "correct guesses never spend a miss");
});

test("reset picks a fresh word and clears guesses, misses and the terminal lock", () => {
  const rng = queuedRandom([sampleFor(0, 2), sampleFor(1, 2)]);
  const game = createHangman({ random: rng.random, words: ["CAT", "DOG"] });
  for (const letter of ["B", "E", "F", "G", "H", "I"]) game.guess(letter);
  assert.equal(game.getState().phase, "lost");
  const fresh = game.reset();
  assert.equal(fresh.phase, "ready");
  assert.equal(fresh.wordLength, 3);
  assert.equal(fresh.misses, 0);
  assert.equal(fresh.remaining, MAX_MISSES);
  assert.equal(fresh.word, null);
  assert.deepEqual([...fresh.guesses], []);
  assert.deepEqual([...fresh.letters], [null, null, null]);
  assert.strictEqual(game.getState(), fresh);
  assert.equal(rng.calls.length, 2, "reset consumes exactly one new RNG sample");
  game.guess("D");
  game.guess("O");
  const won = game.guess("G");
  assert.equal(won.phase, "won");
  assert.equal(won.word, "DOG", "the new secret is the second word");
});

test("invalid letters throw without mutating, including after a game starts", () => {
  const game = createHangman({ words: ["CAT"] });
  const initial = game.getState();
  for (const bad of ["", "AB", "1", "!", " ", null, undefined, 7, {}, "Ä"]) {
    assert.throws(
      () => game.guess(bad),
      (error) => error instanceof TypeError || error instanceof RangeError,
      `guess ${JSON.stringify(bad)}`,
    );
  }
  assert.strictEqual(game.getState(), initial, "invalid input leaves the snapshot untouched");
  game.guess("C");
  const playing = game.getState();
  assert.throws(() => game.guess("XY"), TypeError);
  assert.strictEqual(game.getState(), playing);
});

test("malformed configuration is rejected without a partial game", () => {
  assert.throws(() => createHangman(null), TypeError);
  assert.throws(() => createHangman({ random: 42 }), TypeError);
  assert.throws(() => createHangman({ words: [] }), RangeError);
  assert.throws(() => createHangman({ words: ["c@t"] }), TypeError);
  assert.throws(() => createHangman({ words: ["CAT", 4] }), TypeError);
  assert.throws(() => createHangman({ maxMisses: 0 }), RangeError);
  assert.throws(() => createHangman({ maxMisses: 2.5 }), RangeError);
  assert.throws(() => createHangman({ random: () => 1, words: ["CAT"] }), RangeError);
  assert.throws(() => createHangman({ random: () => Number.NaN, words: ["CAT"] }), RangeError);
  const broken = createHangman({ random: queuedRandom([0, 1]).random, words: ["CAT"] });
  assert.throws(() => broken.reset(), RangeError, "an out-of-range sample on reset is rejected");
  assert.equal(broken.getState().phase, "ready", "a rejected reset leaves the game intact");
  const notFinite = createHangman({ random: queuedRandom([0, Number.NaN]).random, words: ["CAT"] });
  assert.throws(() => notFinite.reset(), RangeError);
  const configurable = createHangman({ words: ["CAT"], maxMisses: 2 });
  assert.equal(configurable.getState().maxMisses, 2);
  configurable.guess("B");
  configurable.guess("E");
  assert.equal(configurable.getState().phase, "lost", "a custom miss limit is honoured");
});

test("formatWord validates its inputs and old snapshots never change", () => {
  assert.throws(() => formatWord(null), TypeError);
  const game = createHangman({ words: ["CAT"] });
  const fresh = game.getState();
  assert.equal(formatWord(fresh, "?"), "? ? ?");
  const playing = game.guess("C");
  assert.equal(formatWord(fresh, "?"), "? ? ?", "an older snapshot stays masked");
  assert.equal(formatWord(playing, "?"), "C ? ?");
  assert.throws(() => { playing.letters[0] = "Z"; }, TypeError);
  assert.throws(() => { playing.guesses.push({ letter: "B" }); }, TypeError);
  assert.equal(game.getState().letters[0], "C");
});

test("the engine source never reaches the network", () => {
  const source = readFileSync(new URL("../../findows/js/apps/hangman-engine.mjs", import.meta.url), "utf8");
  assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/.test(source) && !/\bimport\s*\(/.test(source),
    "no fetch, socket or dynamic import");
  assert.ok(!/\bfrom\s+["']/.test(source), "the engine has no imports");
});
