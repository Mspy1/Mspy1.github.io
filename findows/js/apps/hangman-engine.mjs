/**
 * Hangman model — pure, dependency-free, no DOM, no timers and no network.
 *
 * The word list is bundled below: guessing never fetches a dictionary and the
 * engine never imports anything. A word is chosen once at creation and again on
 * each reset using the injectable `random: () => number` (uniform [0,1)).
 *
 * Snapshot safety: while ready/playing the secret is `null`, and `letters`
 * contains a letter only at positions the player has already revealed. On a
 * terminal phase the full word is disclosed. Snapshots are deeply frozen and
 * cached, so an old snapshot never changes when play continues.
 *
 * Guesses are case-insensitive single letters. Repeats and terminal-phase
 * guesses are stable no-ops. Every correct letter reveals all of its positions;
 * each distinct wrong letter spends one miss. Reaching `maxMisses` loses, and
 * revealing every distinct letter wins. Both outcomes lock play until reset.
 */

export const MAX_MISSES = 6;
export const PHASES = Object.freeze(["ready", "playing", "won", "lost"]);

/** Original bundled word list — local data, no dictionary API. */
export const WORDS = Object.freeze([
  "BANANA", "CHEESE", "LETTER", "PLANET", "ROCKET", "COMET", "ORBIT",
  "GALAXY", "STAR", "MOON", "GRAVITY", "TELESCOPE", "ASTRONAUT", "OCEAN",
  "RIVER", "LAKE", "BEACH", "ISLAND", "CLOUD", "STORM", "RAINBOW",
  "SUNSET", "BREEZE", "FOREST", "GARDEN", "FLOWER", "TULIP", "MAPLE",
  "CACTUS", "LEAF", "BRANCH", "SEED", "ANIMAL", "TIGER", "LION", "PANDA",
  "KOALA", "DOLPHIN", "PENGUIN", "GIRAFFE", "BUTTERFLY", "RABBIT",
  "GUITAR", "PIANO", "VIOLIN", "DRUM", "TRUMPET", "MELODY", "RHYTHM",
  "CONCERT", "ALBUM", "CHORUS", "BREAD", "APPLE", "ORANGE", "GRAPE",
  "PEACH", "CARROT", "POTATO", "TOMATO", "SCHOOL", "TEACHER", "STUDENT",
  "BOOK", "PENCIL", "PAPER", "LESSON", "HOMEWORK", "CLASSROOM", "LIBRARY",
  "CITY", "VILLAGE", "HOUSE", "BRIDGE", "TOWER", "CASTLE", "STREET",
  "MARKET", "MUSEUM", "STADIUM", "BICYCLE", "TRAIN", "SCOOTER", "AIRPLANE",
  "BOAT", "MOTOR", "WHEEL", "ENGINE", "TRACK", "JOURNEY", "CAMERA",
  "PHOTO", "PAINT", "BRUSH", "CANVAS", "COLOR", "SKETCH", "GALLERY",
  "FRAME", "POCKET", "BUTTON", "ZIPPER", "JACKET", "SNEAKER", "HELMET",
  "GLOVE", "SCARF", "UNIFORM", "FABRIC", "HAPPY", "BRAVE", "CALM", "SILLY",
  "BRIGHT", "QUICK", "QUIET", "SWEET", "GIANT", "TINY", "MORNING",
  "EVENING", "WEEKEND", "HOLIDAY", "FESTIVAL", "BIRTHDAY", "VACATION",
  "PICNIC", "PARADE", "MIDNIGHT", "CHIMPANZEE", "KANGAROO", "CROCODILE",
  "ELEPHANT", "TORTOISE", "HAMSTER", "PARROT", "FALCON", "WHALE", "SHARK",
  "BALLOON", "COFFEE", "EAGLE", "OTTER", "BEAVER", "MEADOW", "HARVEST",
  "SHADOW", "LANTERN", "BRICK",
]);

function normalizeWords(words) {
  if (!Array.isArray(words)) throw new TypeError("words must be an array of A-Z words");
  if (words.length === 0) throw new RangeError("words must contain at least one word");
  const seen = new Set();
  const normalized = [];
  for (const word of words) {
    if (typeof word !== "string") throw new TypeError("every word must be a string");
    const upper = word.toUpperCase();
    if (!/^[A-Z]{1,16}$/.test(upper)) throw new TypeError(`word ${JSON.stringify(word)} must be 1-16 A-Z letters`);
    if (seen.has(upper)) continue;
    seen.add(upper);
    normalized.push(upper);
  }
  if (normalized.length === 0) throw new RangeError("words must contain at least one valid word");
  return Object.freeze(normalized);
}

/** Accept uppercase or lowercase single letters only. */
function normalizeLetter(value) {
  if (typeof value !== "string") throw new TypeError("guess must be a single A-Z letter");
  if (value.length !== 1) throw new TypeError("guess must be exactly one letter");
  const upper = value.toUpperCase();
  if (!/^[A-Z]$/.test(upper)) throw new RangeError("guess must be an A-Z letter");
  return upper;
}

/**
 * Render a frozen snapshot as a spaced mask; unrevealed positions use
 * `placeholder` (a middle dot by default).
 */
export function formatWord(state, placeholder = "\u00B7") {
  if (state === null || typeof state !== "object" || !Array.isArray(state.letters)) {
    throw new TypeError("formatWord needs a Hangman snapshot");
  }
  if (typeof placeholder !== "string") throw new TypeError("placeholder must be a string");
  return state.letters.map((letter) => (letter == null ? placeholder : letter)).join(" ");
}

export function createHangman(options = {}) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("Hangman options must be an object");
  }
  const { random = Math.random, words = WORDS, maxMisses = MAX_MISSES } = options;
  if (typeof random !== "function") throw new TypeError("random must be a function returning [0,1)");
  if (!Number.isInteger(maxMisses) || maxMisses < 1 || maxMisses > 12) {
    throw new RangeError("maxMisses must be an integer from 1 to 12");
  }
  const dictionary = normalizeWords(words);

  const chooseWord = () => {
    const value = random();
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError("random must return a finite number in [0,1)");
    }
    return dictionary[Math.floor(value * dictionary.length)];
  };

  let secret = chooseWord();
  let phase = "ready";
  let misses = 0;
  let revealed = Array.from({ length: secret.length }, () => false);
  let guesses = [];
  let guessed = new Set();
  let cache = null;

  const isTerminal = () => phase === "won" || phase === "lost";
  const invalidate = () => { cache = null; };

  const getState = () => {
    if (cache) return cache;
    const terminal = isTerminal();
    cache = Object.freeze({
      phase,
      wordLength: secret.length,
      maxMisses,
      misses,
      remaining: maxMisses - misses,
      guesses: Object.freeze(guesses.map((guess) => Object.freeze({ ...guess }))),
      guessedLetters: Object.freeze(guesses.map((guess) => guess.letter)),
      letters: Object.freeze(revealed.map((shown, index) => (shown ? secret[index] : null))),
      word: terminal ? secret : null,
    });
    return cache;
  };

  const guess = (value) => {
    const letter = normalizeLetter(value);
    if (isTerminal() || guessed.has(letter)) return getState();

    guessed.add(letter);
    let correct = false;
    for (let index = 0; index < secret.length; index += 1) {
      if (secret[index] === letter) {
        revealed[index] = true;
        correct = true;
      }
    }
    guesses.push({ letter, correct });
    if (!correct) misses += 1;
    if (phase === "ready") phase = "playing";

    if (misses >= maxMisses) {
      phase = "lost";
      revealed = Array.from({ length: secret.length }, () => true);
    } else if (revealed.every(Boolean)) {
      phase = "won";
    }
    invalidate();
    return getState();
  };

  const reset = () => {
    const next = chooseWord();
    secret = next;
    phase = "ready";
    misses = 0;
    revealed = Array.from({ length: secret.length }, () => false);
    guesses = [];
    guessed = new Set();
    invalidate();
    return getState();
  };

  return Object.freeze({ getState, guess, reset });
}

export default { createHangman, formatWord, WORDS, MAX_MISSES };
