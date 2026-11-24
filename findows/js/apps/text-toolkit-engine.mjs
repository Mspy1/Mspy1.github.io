/**
 * Text Toolkit pure logic.
 *
 * No DOM, no persistence, no timers, no eval, no requests. The UI layer sends a
 * text string plus one operation id and renders the frozen result. All output is
 * plain text; markup in the input is never interpreted.
 *
 * Character counts and the input bound use Unicode code points (so an emoji is
 * one character), while line operations normalize CRLF/CR to LF.
 */

export const MAX_INPUT_CHARS = 20_000;
export const DEFAULT_TAB_SIZE = 2;
export const MIN_TAB_SIZE = 1;
export const MAX_TAB_SIZE = 8;

export const OPERATIONS = Object.freeze([
  Object.freeze({ id: "upper", label: "UPPERCASE", hint: "Every letter uppercase", group: "case" }),
  Object.freeze({ id: "lower", label: "lowercase", hint: "Every letter lowercase", group: "case" }),
  Object.freeze({ id: "title", label: "Title Case", hint: "Capitalize each word", group: "case" }),
  Object.freeze({ id: "sentence", label: "Sentence case", hint: "Capitalize each sentence", group: "case" }),
  Object.freeze({ id: "camel", label: "camelCase", hint: "Join words, first one lowercase", group: "case" }),
  Object.freeze({ id: "pascal", label: "PascalCase", hint: "Join words, all capitalized", group: "case" }),
  Object.freeze({ id: "snake", label: "snake_case", hint: "Join words with underscores", group: "case" }),
  Object.freeze({ id: "kebab", label: "kebab-case", hint: "Join words with hyphens", group: "case" }),
  Object.freeze({ id: "constant", label: "CONSTANT_CASE", hint: "Uppercase words with underscores", group: "case" }),
  Object.freeze({ id: "trim", label: "Trim edges", hint: "Strip leading and trailing whitespace", group: "whitespace" }),
  Object.freeze({ id: "collapse", label: "Collapse spaces", hint: "One space between words, keep lines", group: "whitespace" }),
  Object.freeze({ id: "no-blank-lines", label: "Remove blank lines", hint: "Drop empty and whitespace-only lines", group: "whitespace" }),
  Object.freeze({ id: "tabs-to-spaces", label: "Tabs to spaces", hint: "Expand each tab (1–8 spaces)", group: "whitespace" }),
  Object.freeze({ id: "sort-asc", label: "Sort lines A→Z", hint: "Lexicographic ascending", group: "lines" }),
  Object.freeze({ id: "sort-desc", label: "Sort lines Z→A", hint: "Lexicographic descending", group: "lines" }),
  Object.freeze({ id: "reverse-lines", label: "Reverse lines", hint: "Flip line order", group: "lines" }),
  Object.freeze({ id: "unique", label: "Remove duplicates", hint: "Keep the first of each identical line", group: "lines" }),
  Object.freeze({ id: "unique-ignore-case", label: "Unique (ignore case)", hint: "Case-insensitive duplicate removal", group: "lines" }),
  Object.freeze({ id: "count", label: "Count text", hint: "Words, characters and lines", group: "inspect" }),
]);

export const OPERATION_GROUPS = Object.freeze([
  Object.freeze({ id: "case", label: "Case transforms" }),
  Object.freeze({ id: "whitespace", label: "Whitespace" }),
  Object.freeze({ id: "lines", label: "Line tools" }),
  Object.freeze({ id: "inspect", label: "Inspect" }),
]);

const OPERATION_IDS = new Set(OPERATIONS.map((operation) => operation.id));

function fail(code, message, Base = Error) {
  const error = new Base(message);
  error.name = "TextToolkitError";
  error.code = code;
  return error;
}

function countChars(text) {
  return [...text].length;
}

function countWords(text) {
  return text.split(/\s+/u).filter(Boolean).length;
}

function countLines(text) {
  if (text.length === 0) return 0;
  const normalized = text.replace(/\r\n?/g, "\n");
  const parts = normalized.split("\n");
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts.length;
}

function countsFor(text) {
  return Object.freeze({
    words: countWords(text),
    chars: countChars(text),
    lines: countLines(text),
  });
}

function splitLines(text) {
  if (text.length === 0) return [];
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function capitalizeWord(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Split camel/Pascal boundaries and non-alphanumerics into lowercase words. */
function splitWords(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function uniqueLines(parts, ignoreCase) {
  const seen = new Set();
  const result = [];
  for (const line of parts) {
    const key = ignoreCase ? line.toLowerCase() : line;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line);
  }
  return result;
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function transform(text, operation, options) {
  switch (operation) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "title":
      return text.toLowerCase().replace(/(^|\s)(\S)/gu, (_match, before, char) => before + char.toUpperCase());
    case "sentence":
      return text.toLowerCase().replace(/(^|[.!?]\s+)(\S)/gu, (_match, before, char) => before + char.toUpperCase());
    case "camel": {
      const words = splitWords(text);
      return words.map((word, index) => (index === 0 ? word : capitalizeWord(word))).join("");
    }
    case "pascal":
      return splitWords(text).map(capitalizeWord).join("");
    case "snake":
      return splitWords(text).join("_");
    case "kebab":
      return splitWords(text).join("-");
    case "constant":
      return splitWords(text).join("_").toUpperCase();
    case "trim":
      return text.trim();
    case "collapse":
      return text.replace(/[ \t]+/g, " ").replace(/^ +/gm, "").replace(/ +$/gm, "");
    case "no-blank-lines":
      return splitLines(text).filter((line) => line.trim() !== "").join("\n");
    case "tabs-to-spaces":
      return text.replace(/\t/g, " ".repeat(options.tabSize));
    case "sort-asc":
      return splitLines(text).sort(compareText).join("\n");
    case "sort-desc":
      return splitLines(text).sort((a, b) => -compareText(a, b)).join("\n");
    case "reverse-lines":
      return splitLines(text).reverse().join("\n");
    case "unique":
      return uniqueLines(splitLines(text), false).join("\n");
    case "unique-ignore-case":
      return uniqueLines(splitLines(text), true).join("\n");
    case "count": {
      const counts = countsFor(text);
      return `Words: ${counts.words}\nCharacters: ${counts.chars}\nLines: ${counts.lines}`;
    }
    default:
      throw fail("UNKNOWN_OPERATION", `Unknown operation: ${String(operation)}`);
  }
}

/**
 * Apply one operation to text.
 * @param {string} text source text
 * @param {string} operation id from OPERATIONS
 * @param {{ tabSize?: number }} [options]
 * @returns {Readonly<{operation: string, output: string, counts: object, outputCounts: object, inputChars: number}>}
 */
export function runToolkit(text, operation, options = {}) {
  if (typeof text !== "string") {
    throw fail("INVALID_INPUT", "Text Toolkit needs a text string as input.", TypeError);
  }
  if (options === null || typeof options !== "object") {
    throw fail("INVALID_OPTIONS", "Text Toolkit options must be an object.", TypeError);
  }
  if (typeof operation !== "string" || !OPERATION_IDS.has(operation)) {
    throw fail("UNKNOWN_OPERATION", `Unknown operation: ${String(operation)}`);
  }

  const tabSize = options.tabSize === undefined ? DEFAULT_TAB_SIZE : options.tabSize;
  if (!Number.isInteger(tabSize) || tabSize < MIN_TAB_SIZE || tabSize > MAX_TAB_SIZE) {
    throw fail("INVALID_TAB_SIZE", "tabSize must be an integer from 1 to 8.", RangeError);
  }

  const inputChars = countChars(text);
  if (inputChars > MAX_INPUT_CHARS) {
    throw fail(
      "INPUT_TOO_LONG",
      `Input has ${inputChars.toLocaleString("en-US")} characters; the limit is ${MAX_INPUT_CHARS.toLocaleString("en-US")}.`,
      RangeError,
    );
  }

  const output = transform(text, operation, Object.freeze({ tabSize }));
  return Object.freeze({
    operation,
    output,
    counts: countsFor(text),
    outputCounts: countsFor(output),
    inputChars,
  });
}

export default { MAX_INPUT_CHARS, OPERATIONS, OPERATION_GROUPS, runToolkit };
