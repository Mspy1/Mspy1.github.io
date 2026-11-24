/**
 * Calculator standard-mode state machine.
 *
 * Pure model: no DOM, no persistence, no eval/expression parsing. The UI layer
 * sends canonical button tokens and renders the snapshot it gets back.
 *
 * Tokens: "0".."9", ".", "+", "-", "*", "/", "=", "sign", "backspace", "C", "CE".
 * Operators use the immediate-execution model: pressing an operator completes
 * the pending operation before storing the next one.
 *
 * Numeric policy: binary floating-point arithmetic is normalized to 12
 * significant digits after every operation, so 0.1 + 0.2 displays 0.3.
 */

export const DEFAULT_MAX_DIGITS = 15;
export const DEFAULT_MAX_HISTORY = 50;
export const RESULT_PRECISION = 12;

const VALID_TOKENS = new Set([
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  ".", "+", "-", "*", "/", "=", "sign", "backspace", "C", "CE",
]);

const SYMBOLS = Object.freeze({ "+": "+", "-": "-", "*": "×", "/": "÷" });

const DIVIDE_BY_ZERO = Object.freeze({
  code: "DIVIDE_BY_ZERO",
  message: "Cannot divide by zero",
});
const OVERFLOW = Object.freeze({
  code: "OVERFLOW",
  message: "Result is out of range",
});

function normalizeResult(value) {
  if (!Number.isFinite(value) || value === 0) return value === 0 ? 0 : value;
  return Number(value.toPrecision(RESULT_PRECISION));
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "Error";
  const rounded = normalizeResult(value);
  if (rounded === 0) return "0";
  const magnitude = Math.abs(rounded);
  if (magnitude >= 1e12 || magnitude < 1e-9) {
    const [mantissa, exponent] = rounded
      .toExponential(RESULT_PRECISION - 1)
      .split("e");
    return `${mantissa.replace(/\.?0+$/, "")}e${exponent}`;
  }
  const decimals = Math.max(
    0,
    RESULT_PRECISION - 1 - Math.floor(Math.log10(magnitude)),
  );
  const fixed = rounded.toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

function compute(operator, left, right) {
  let value;
  switch (operator) {
    case "+":
      value = left + right;
      break;
    case "-":
      value = left - right;
      break;
    case "*":
      value = left * right;
      break;
    case "/":
      if (right === 0) return { error: DIVIDE_BY_ZERO };
      value = left / right;
      break;
    default:
      return { error: OVERFLOW };
  }
  if (!Number.isFinite(value)) return { error: OVERFLOW };
  return { value: normalizeResult(value) };
}

function integerOption(value, fallback, min, max, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function countDigits(text) {
  const digits = text.replace(".", "");
  return (digits.startsWith("0") ? digits.slice(1) : digits).length;
}

export function createCalculator(options = {}) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("Calculator options must be an object");
  }
  const maxDigits = integerOption(options.maxDigits, DEFAULT_MAX_DIGITS, 1, 15, "maxDigits");
  const maxHistory = integerOption(options.maxHistory, DEFAULT_MAX_HISTORY, 1, 500, "maxHistory");

  let current = 0;
  let entryText = "0";
  let entryNegative = false;
  let entryDirty = false;
  let entryMode = "computed"; // "typing" while the visitor is entering a number
  let pending = null; // { operator, value }
  let awaitingOperand = false;
  let lastOperation = null; // { operator, operand } for repeated equals
  let error = null;
  let tokens = []; // expression fragments for the current calculation
  let history = []; // frozen { expression, result }, newest first

  const entryValue = () => {
    const value = Number(entryText) * (entryNegative ? -1 : 1);
    return value === 0 ? 0 : value;
  };

  const entryDisplay = () =>
    `${entryNegative && Number(entryText) !== 0 ? "-" : ""}${entryText}`;

  const display = () => {
    if (error) return "Error";
    return entryMode === "typing" ? entryDisplay() : formatNumber(current);
  };

  const resetEntry = () => {
    entryText = "0";
    entryNegative = false;
    entryDirty = false;
  };

  const snapshot = () => Object.freeze({
    display: display(),
    expression: tokens.join(" "),
    error: error ? Object.freeze({ ...error }) : null,
    pendingOperator: pending ? pending.operator : null,
    history: Object.freeze(history.slice()),
  });

  const resetCurrent = () => {
    current = 0;
    entryMode = "computed";
    resetEntry();
    pending = null;
    awaitingOperand = false;
    lastOperation = null;
    error = null;
    tokens = [];
  };

  const raiseError = (failure) => {
    error = { code: failure.code, message: failure.message };
    current = 0;
    entryMode = "computed";
    resetEntry();
    pending = null;
    awaitingOperand = false;
    lastOperation = null;
    tokens = [];
  };

  const record = (expression, value) => {
    history.unshift(Object.freeze({ expression, result: formatNumber(value) }));
    if (history.length > maxHistory) history.length = maxHistory;
  };

  const inheritSign = () =>
    entryNegative && (awaitingOperand || (pending === null && current === 0));

  const typeDigit = (digit) => {
    if (error) resetCurrent();
    if (entryMode !== "typing") {
      const negative = inheritSign();
      if (pending === null) {
        tokens = [];
        lastOperation = null;
      }
      entryMode = "typing";
      entryText = digit;
      entryNegative = negative;
      entryDirty = true;
      awaitingOperand = false;
      return;
    }
    awaitingOperand = false;
    if (!entryDirty) {
      entryText = digit;
      entryDirty = true;
      return;
    }
    if (entryText === "0") {
      if (digit !== "0") entryText = digit;
      return;
    }
    const candidate = entryText + digit;
    if (countDigits(candidate) > maxDigits) return;
    entryText = candidate;
  };

  const typeDecimal = () => {
    if (error) resetCurrent();
    const negative = inheritSign();
    if (entryMode !== "typing") {
      if (pending === null) {
        tokens = [];
        lastOperation = null;
      }
      entryMode = "typing";
      entryText = "0.";
      entryNegative = negative;
      entryDirty = true;
      awaitingOperand = false;
      return;
    }
    awaitingOperand = false;
    if (entryText.includes(".")) return;
    entryDirty = true;
    entryText = entryText === "0" ? "0." : `${entryText}.`;
  };

  const toggleSign = () => {
    if (error) return;
    if (entryMode === "typing" && entryDirty) {
      entryNegative = !entryNegative;
      return;
    }
    if (pending !== null && awaitingOperand) {
      entryNegative = !entryNegative;
      return;
    }
    if (current === 0) {
      entryNegative = !entryNegative;
      return;
    }
    current = normalizeResult(-current);
    entryNegative = false;
  };

  const backspace = () => {
    if (error) return;
    if (entryMode !== "typing" || !entryDirty) return;
    if (entryText.length <= 1) {
      entryText = "0";
      entryDirty = false;
      return;
    }
    const shortened = entryText.slice(0, -1);
    if (shortened === "" || shortened === "0") {
      entryText = "0";
      entryDirty = false;
      return;
    }
    entryText = shortened;
  };

  const clearEntry = () => {
    if (error) {
      resetCurrent();
      return;
    }
    current = 0;
    entryMode = "typing";
    entryText = "0";
    entryNegative = false;
    entryDirty = true; // a cleared entry counts as an explicit 0 operand
    awaitingOperand = false;
    if (pending === null) {
      lastOperation = null;
      tokens = [];
    }
  };

  const applyOperator = (operator) => {
    if (error) return;
    if (awaitingOperand) {
      pending = { operator, value: pending.value };
      if (tokens.length > 0) tokens[tokens.length - 1] = SYMBOLS[operator];
      return;
    }
    const left = entryMode === "typing" ? entryValue() : current;
    let value = left;
    if (pending === null) {
      tokens = [formatNumber(left)];
    } else {
      const outcome = compute(pending.operator, pending.value, left);
      if (outcome.error) {
        raiseError(outcome.error);
        return;
      }
      value = outcome.value;
      tokens.push(formatNumber(left));
    }
    current = value;
    pending = { operator, value };
    entryMode = "computed";
    awaitingOperand = true;
    lastOperation = null;
    resetEntry();
    tokens.push(SYMBOLS[operator]);
  };

  const equals = () => {
    if (error) return;
    if (pending === null) {
      if (lastOperation === null) return;
      const left = current;
      const outcome = compute(lastOperation.operator, left, lastOperation.operand);
      if (outcome.error) {
        raiseError(outcome.error);
        return;
      }
      const expression = `${formatNumber(left)} ${SYMBOLS[lastOperation.operator]} ${formatNumber(lastOperation.operand)}`;
      current = outcome.value;
      entryMode = "computed";
      resetEntry();
      awaitingOperand = false;
      tokens = expression.split(" ");
      record(expression, current);
      return;
    }

    const right = entryMode === "typing" && entryDirty ? entryValue() : pending.value;
    const expressionTokens = [...tokens, formatNumber(right)];
    const outcome = compute(pending.operator, pending.value, right);
    if (outcome.error) {
      raiseError(outcome.error);
      return;
    }
    current = outcome.value;
    lastOperation = { operator: pending.operator, operand: right };
    pending = null;
    awaitingOperand = false;
    entryMode = "computed";
    resetEntry();
    tokens = expressionTokens;
    record(tokens.join(" "), current);
  };

  const press = (token) => {
    if (typeof token !== "string" || !VALID_TOKENS.has(token)) {
      throw new RangeError(`Unknown calculator token: ${String(token)}`);
    }
    if (token.length === 1 && token >= "0" && token <= "9") {
      typeDigit(token);
    } else if (token === ".") {
      typeDecimal();
    } else if (token === "sign") {
      toggleSign();
    } else if (token === "backspace") {
      backspace();
    } else if (token === "C") {
      resetCurrent();
    } else if (token === "CE") {
      clearEntry();
    } else if (token === "=") {
      equals();
    } else {
      applyOperator(token);
    }
    return snapshot();
  };

  return Object.freeze({
    press,
    getState: snapshot,
    clearHistory() {
      history = [];
    },
  });
}
