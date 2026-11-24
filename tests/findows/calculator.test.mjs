/* Gate 3: Calculator standard-mode state machine (pure, immediate execution, no eval). */
import test from "node:test";
import assert from "node:assert/strict";
import { createCalculator } from "../../findows/js/apps/calculator-engine.mjs";

/** Press a sequence of canonical engine tokens and return the final snapshot. */
function enter(calc, tokens) {
  let state = calc.getState();
  for (const token of tokens) state = calc.press(token);
  return state;
}

test("starts at zero with no pending work or session history", () => {
  const calc = createCalculator();
  const state = calc.getState();
  assert.equal(state.display, "0");
  assert.equal(state.expression, "");
  assert.equal(state.error, null);
  assert.equal(state.pendingOperator, null);
  assert.deepEqual(state.history, []);
  assert.ok(Object.isFrozen(state), "snapshots are readonly");
});

test("digits start and extend an entry, with a single leading zero", () => {
  const calc = createCalculator();
  assert.equal(enter(calc, ["0", "0", "7"]).display, "7");
  calc.press("C");
  assert.equal(enter(calc, ["1", "2", "3"]).display, "123");
  calc.press("C");
  assert.equal(enter(calc, ["0", "5"]).display, "5", "a leading zero is replaced");
});

test("decimal point is allowed once, and only once per entry", () => {
  const calc = createCalculator();
  assert.equal(enter(calc, [".", "5"]).display, "0.5");
  assert.equal(enter(calc, ["."]).display, "0.5", "a second decimal point is ignored");
  assert.equal(enter(calc, ["0", "0"]).display, "0.500", "digits after the decimal append");
  calc.press("C");
  assert.equal(enter(calc, ["1", ".", ".", "5"]).display, "1.5");
});

test("sign toggles the entry, works before digits, and never shows negative zero", () => {
  const calc = createCalculator();
  assert.equal(enter(calc, ["5", "sign"]).display, "-5");
  assert.equal(calc.press("sign").display, "5");
  calc.press("C");
  assert.equal(enter(calc, ["sign", "sign", "5"]).display, "5");
  calc.press("C");
  assert.equal(enter(calc, ["sign", "5"]).display, "-5", "a pending sign applies to the next entry");
  calc.press("C");
  assert.equal(enter(calc, ["0", "sign"]).display, "0", "negative zero is not displayed");
});

test("digit entry is bounded by a configurable digit limit", () => {
  const calc = createCalculator({ maxDigits: 3 });
  assert.equal(enter(calc, ["1", "2", "3", "4"]).display, "123");
  calc.press("C");
  assert.equal(enter(calc, ["0", ".", "1", "2", "3", "4"]).display, "0.123", "the leading zero does not consume the limit");
  const defaults = createCalculator();
  assert.equal(enter(defaults, Array(16).fill("9")).display, "999999999999999", "default limit is 15 significant digits");
});

test("standard mode executes immediately: 2 + 3 × 4 = 20, not 14", () => {
  const calc = createCalculator();
  let state = enter(calc, ["2", "+"]);
  assert.equal(state.display, "2");
  assert.equal(state.pendingOperator, "+");
  state = enter(calc, ["3", "*"]);
  assert.equal(state.display, "5", "the pending addition runs when the next operator is pressed");
  assert.equal(state.expression, "2 + 3 ×");
  state = enter(calc, ["4", "="]);
  assert.equal(state.display, "20");
  assert.equal(state.expression, "2 + 3 × 4");
  assert.deepEqual(state.history, [{ expression: "2 + 3 × 4", result: "20" }]);
});

test("decimal precision policy hides binary floating-point noise", () => {
  const calc = createCalculator();
  assert.equal(enter(calc, ["0", ".", "1", "+", "0", ".", "2", "="]).display, "0.3");
  assert.equal(calc.getState().history[0].result, "0.3");
  calc.press("C");
  assert.equal(enter(calc, ["1", "/", "3", "="]).display, "0.333333333333", "results carry 12 significant digits");
});

test("pressing another operator before an operand replaces the operator", () => {
  const calc = createCalculator();
  assert.equal(enter(calc, ["2", "+", "*", "3", "="]).display, "6");
  assert.equal(calc.getState().history[0].expression, "2 × 3");
  calc.press("C");
  assert.equal(enter(calc, ["2", "+", "-", "3", "="]).display, "-1");
});

test("equals with no second operand reuses the left operand", () => {
  const calc = createCalculator();
  assert.equal(enter(calc, ["2", "+", "="]).display, "4");
  assert.equal(calc.getState().history[0].expression, "2 + 2");
  calc.press("C");
  assert.equal(enter(calc, ["8", "/", "="]).display, "1");
  calc.press("C");
  assert.equal(enter(calc, ["5", "-", "="]).display, "0");
  calc.press("C");
  assert.equal(enter(calc, ["6", "*", "="]).display, "36");
});

test("repeated equals repeats the last completed operation", () => {
  const calc = createCalculator();
  let state = enter(calc, ["2", "+", "3", "="]);
  assert.equal(state.display, "5");
  state = calc.press("=");
  assert.equal(state.display, "8");
  state = calc.press("=");
  assert.equal(state.display, "11");
  assert.deepEqual(state.history, [
    { expression: "8 + 3", result: "11" },
    { expression: "5 + 3", result: "8" },
    { expression: "2 + 3", result: "5" },
  ]);
});

test("an operator after equals continues from the result; a digit starts fresh", () => {
  const calc = createCalculator();
  enter(calc, ["2", "+", "3", "="]);
  assert.equal(enter(calc, ["+", "4", "="]).display, "9");
  assert.equal(calc.getState().history[0].expression, "5 + 4");
  calc.press("C");
  enter(calc, ["2", "+", "3", "="]);
  assert.equal(calc.press("7").display, "7", "a digit begins a new calculation");
  assert.equal(calc.press("=").display, "7", "a bare equals does not invent an operation");
  assert.equal(calc.getState().history.length, 3, "neither the digit nor the bare equals adds history");
});

test("CE clears only the current entry and keeps the pending operator", () => {
  const calc = createCalculator();
  let state = enter(calc, ["1", "2", "+", "3", "4", "CE"]);
  assert.equal(state.display, "0");
  assert.equal(state.expression, "12 +");
  state = enter(calc, ["5", "="]);
  assert.equal(state.display, "17");
  assert.equal(state.expression, "12 + 5");
  assert.equal(state.pendingOperator, null);
});

test("CE after equals clears the shown result and repeat memory but keeps history", () => {
  const calc = createCalculator();
  enter(calc, ["2", "+", "3", "="]);
  const state = calc.press("CE");
  assert.equal(state.display, "0");
  assert.equal(state.history.length, 1, "CE is not a history action");
  assert.equal(calc.press("=").display, "0", "a bare equals stays a no-op");
  assert.equal(calc.getState().history.length, 1);
});

test("C clears the current calculation but preserves session history", () => {
  const calc = createCalculator();
  enter(calc, ["2", "+", "3", "="]);
  const state = calc.press("C");
  assert.equal(state.display, "0");
  assert.equal(state.expression, "");
  assert.equal(state.pendingOperator, null);
  assert.equal(state.history.length, 1, "C keeps completed history");
  assert.equal(enter(calc, ["1", "2", "+", "3", "4", "C", "5", "+", "5", "="]).display, "10", "C abandons the pending calculation");
  assert.equal(calc.getState().history.length, 2);
  calc.clearHistory();
  assert.deepEqual(calc.getState().history, []);
});

test("backspace edits only an in-progress entry", () => {
  const calc = createCalculator();
  assert.equal(enter(calc, ["1", "2", "3", "backspace"]).display, "12");
  assert.equal(enter(calc, ["backspace", "backspace", "backspace"]).display, "0");
  calc.press("C");
  assert.equal(enter(calc, ["1", ".", "5", "backspace"]).display, "1.");
  assert.equal(calc.press("backspace").display, "1");
  assert.equal(calc.press("backspace").display, "0");
  calc.press("C");
  assert.equal(enter(calc, ["2", "+", "backspace"]).display, "2", "nothing to delete after an operator");
  assert.equal(enter(calc, ["3", "="]).display, "5");
  assert.equal(calc.press("backspace").display, "5", "results are not editable by backspace");
});

test("division by zero reports an error and C recovers", () => {
  const calc = createCalculator();
  const state = enter(calc, ["5", "/", "0", "="]);
  assert.equal(state.display, "Error");
  assert.equal(state.error.code, "DIVIDE_BY_ZERO");
  assert.equal(state.error.message, "Cannot divide by zero");
  assert.equal(state.pendingOperator, null);
  assert.deepEqual(state.history, [], "failed calculations are not history");
  assert.equal(calc.press("+").display, "Error", "operators are ignored while in error");
  assert.equal(calc.press("=").display, "Error", "equals is ignored while in error");
  assert.equal(calc.press("backspace").display, "Error", "backspace is ignored while in error");
  const recovered = calc.press("C");
  assert.equal(recovered.display, "0");
  assert.equal(recovered.error, null);
  assert.equal(enter(calc, ["7", "+", "1", "="]).display, "8");
});

test("a digit recovers from an error by starting a new calculation", () => {
  const calc = createCalculator();
  enter(calc, ["9", "/", "0", "="]);
  let state = calc.press("4");
  assert.equal(state.display, "4");
  assert.equal(state.error, null);
  assert.equal(state.expression, "");
  state = enter(calc, ["+", "1", "="]);
  assert.equal(state.display, "5");
  assert.deepEqual(state.history, [{ expression: "4 + 1", result: "5" }]);
});

test("division by zero on an operator boundary also errors, and CE recovers", () => {
  const calc = createCalculator();
  const state = enter(calc, ["5", "/", "0", "+"]);
  assert.equal(state.display, "Error");
  assert.equal(state.error.code, "DIVIDE_BY_ZERO");
  assert.equal(state.pendingOperator, null);
  const recovered = calc.press("CE");
  assert.equal(recovered.display, "0");
  assert.equal(recovered.error, null);
});

test("overflow reports an error instead of Infinity", () => {
  const calc = createCalculator();
  enter(calc, [...Array(15).fill("9"), "*", "="]);
  let sawError = false;
  for (let i = 0; i < 10 && !sawError; i++) {
    calc.press("*");
    sawError = calc.press("=").error !== null;
  }
  assert.equal(sawError, true);
  assert.equal(calc.getState().error.code, "OVERFLOW");
  assert.equal(calc.getState().display, "Error");
  assert.equal(calc.press("C").error, null);
});

test("fixed-point integers keep their trailing zeroes, including negative results", () => {
  const calc = createCalculator();
  let state = enter(calc, [...Array(11).fill("9"), "+", "1", "="]);
  assert.equal(state.display, "100000000000");
  assert.equal(state.history[0].result, "100000000000");
  calc.press("C");
  state = enter(calc, ["0", "-", "5", ...Array(11).fill("0"), "="]);
  assert.equal(state.display, "-500000000000");
  assert.equal(state.history[0].result, "-500000000000");
});

test("integers on both sides of the scientific-notation threshold stay readable", () => {
  const calc = createCalculator();
  assert.equal(enter(calc, [...Array(12).fill("9"), "+", "1", "="]).display, "1e+12");
  calc.press("C");
  enter(calc, [...Array(12).fill("9"), "+", "1", "="]);
  assert.equal(enter(calc, ["-", "1", "="]).display, "999999999999", "just below the threshold stays fixed-point");
});

test("display switches to compact exponential notation outside the readable range", () => {
  const calc = createCalculator();
  assert.equal(enter(calc, ["1", "0", "0", "0", "0", "0", "0", "*", "1", "0", "0", "0", "0", "0", "0", "="]).display, "1e+12");
  calc.press("C");
  assert.equal(enter(calc, ["1", "/", "1", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "="]).display, "1e-10");
  calc.press("C");
  assert.equal(enter(calc, ["1", "/", "1", "0", "0", "0", "0", "0", "0", "0", "="]).display, "0.0000001", "small-but-readable values stay decimal");
  calc.press("C");
  assert.equal(enter(calc, ["0", ".", "0", "0", "0", "0", "0", "0", "5", "+", "0", ".", "0", "0", "0", "0", "0", "0", "5", "="]).display, "0.000001");
});

test("session history is newest-first, bounded and immutable", () => {
  const calc = createCalculator({ maxHistory: 2 });
  enter(calc, ["1", "+", "1", "="]);
  enter(calc, ["2", "+", "2", "="]);
  const state = enter(calc, ["3", "+", "3", "="]);
  assert.equal(state.history.length, 2, "oldest entries fall off");
  assert.equal(state.history[0].result, "6");
  assert.equal(state.history[1].result, "4");
  assert.ok(Object.isFrozen(state.history));
  assert.ok(Object.isFrozen(state.history[0]));
  assert.throws(() => {
    state.history[0].result = "tampered";
  }, TypeError);
});

test("unknown tokens are rejected instead of silently ignored", () => {
  const calc = createCalculator();
  for (const token of ["x", "Enter", "", "**", null, 5]) {
    assert.throws(() => calc.press(token), RangeError, `token ${String(token)} must be rejected`);
  }
  assert.equal(calc.getState().display, "0", "rejected tokens do not mutate state");
});
