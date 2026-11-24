/**
 * Mastermind code-breaking model — pure, dependency-free, no DOM and no timers.
 *
 * A secret of CODE_LENGTH pegs is drawn from COLOR_COUNT colours (repeats are
 * allowed). The player submits guesses; each guess records how many pegs are an
 * exact hit (right colour, right place) and how many are a partial hit (right
 * colour, wrong place). A peg is counted once at most. The game ends when the
 * code is cracked (won) or MAX_GUESSES is spent (lost); after that every guess
 * is a no-op until reset().
 *
 * Inject `random: () => number` (uniform [0,1)) for deterministic secrets, or
 * pass an explicit `secret` array for fully reproducible games. Malformed RNG
 * values and invalid codes throw before any state is mutated. Snapshots are
 * deeply frozen and cached: getState() returns the same object until an action
 * actually changes the game, and the secret is redacted (null) until the game
 * ends. The UI owns all visuals, input, focus and announcements.
 */

export const CODE_LENGTH = 4;
export const COLOR_COUNT = 6;
export const MAX_GUESSES = 10;
export const PHASES = Object.freeze(["playing", "won", "lost"]);
export const COLOR_NAMES = Object.freeze(["Red", "Blue", "Green", "Yellow", "Purple", "Orange"]);

function requireObject(value, label) {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

/** Validate and copy a code. Returns a plain array; caller arrays are never retained. */
function normalizeCode(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array of colour indices`);
  if (value.length !== CODE_LENGTH) {
    throw new RangeError(`${label} must contain exactly ${CODE_LENGTH} pegs`);
  }
  const copy = [];
  for (const peg of value) {
    if (typeof peg !== "number" || !Number.isFinite(peg)) {
      throw new TypeError(`${label} pegs must be finite numbers`);
    }
    if (!Number.isInteger(peg)) throw new RangeError(`${label} pegs must be integers`);
    if (peg < 0 || peg >= COLOR_COUNT) {
      throw new RangeError(`${label} pegs must be from 0 to ${COLOR_COUNT - 1}`);
    }
    copy.push(peg);
  }
  return copy;
}

/**
 * Score a guess against a secret.
 *
 * Exact hits are matched positions first. The remaining positions are compared
 * as colour multisets so a peg can never be counted twice, which keeps feedback
 * truthful when either code contains repeated colours.
 */
export function scoreGuess(secret, guess) {
  const answer = normalizeCode(secret, "secret");
  const attempt = normalizeCode(guess, "guess");

  let exact = 0;
  const remainingSecret = Array.from({ length: COLOR_COUNT }, () => 0);
  const remainingGuess = Array.from({ length: COLOR_COUNT }, () => 0);

  for (let index = 0; index < CODE_LENGTH; index += 1) {
    if (answer[index] === attempt[index]) {
      exact += 1;
    } else {
      remainingSecret[answer[index]] += 1;
      remainingGuess[attempt[index]] += 1;
    }
  }

  let partial = 0;
  for (let color = 0; color < COLOR_COUNT; color += 1) {
    partial += Math.min(remainingSecret[color], remainingGuess[color]);
  }
  return Object.freeze({ exact, partial });
}

/** Draw one secret. The RNG is validated before the game object is created. */
function generateSecret(random) {
  const secret = [];
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    const value = random();
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError("random must return a finite number in [0,1)");
    }
    secret.push(Math.floor(value * COLOR_COUNT));
  }
  return secret;
}

export function createMastermind(options = {}) {
  const config = requireObject(options, "Mastermind options");
  const random = config.random === undefined ? Math.random : config.random;
  if (typeof random !== "function") {
    throw new TypeError("random must be a function returning [0,1)");
  }

  let secret;
  let secretOverride = null;
  if (config.secret === undefined) {
    secret = generateSecret(random);
  } else {
    secretOverride = normalizeCode(config.secret, "secret");
    secret = [...secretOverride];
  }

  let phase = "playing";
  let guesses = [];
  let cache = null;

  const isTerminal = () => phase === "won" || phase === "lost";
  const invalidate = () => { cache = null; };

  const getState = () => {
    if (cache) return cache;
    const views = guesses.map((entry) => Object.freeze({
      code: Object.freeze([...entry.code]),
      exact: entry.exact,
      partial: entry.partial,
    }));
    cache = Object.freeze({
      phase,
      codeLength: CODE_LENGTH,
      colorCount: COLOR_COUNT,
      maxGuesses: MAX_GUESSES,
      guessCount: guesses.length,
      remaining: MAX_GUESSES - guesses.length,
      guesses: Object.freeze(views),
      lastFeedback: guesses.length > 0
        ? Object.freeze({ exact: guesses[guesses.length - 1].exact, partial: guesses[guesses.length - 1].partial })
        : null,
      secret: isTerminal() ? Object.freeze([...secret]) : null,
    });
    return cache;
  };

  const guess = (code) => {
    const attempt = normalizeCode(code, "guess");
    if (isTerminal()) return getState();
    const feedback = scoreGuess(secret, attempt);
    guesses.push({ code: attempt, exact: feedback.exact, partial: feedback.partial });
    if (feedback.exact === CODE_LENGTH) {
      phase = "won";
    } else if (guesses.length >= MAX_GUESSES) {
      phase = "lost";
    }
    invalidate();
    return getState();
  };

  const reset = () => {
    secret = secretOverride === null ? generateSecret(random) : [...secretOverride];
    guesses = [];
    phase = "playing";
    invalidate();
    return getState();
  };

  return Object.freeze({ getState, guess, reset });
}

export default { scoreGuess, createMastermind };
