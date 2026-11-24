/**
 * JSON Formatter pure logic. No DOM, no persistence, no eval, no network.
 *
 * A small recursive-descent parser validates JSON and produces:
 *  - an ordered render tree (so the UI never handles raw markup),
 *  - a precise error with character offset, line and column,
 *  - a serializer that emits inert JSON text via JSON.stringify only.
 *
 * Numbers outside the IEEE-754 finite range are rejected rather than silently
 * turning into null on a second pass. Nesting is capped to keep recursion safe.
 */

export const DEFAULT_INDENT = 2;
export const MAX_DEPTH = 128;

const VALID_INDENTS = new Set([0, 2, 4, "\t"]);
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const HEX4 = /^[0-9a-fA-F]{4}$/;

const ESCAPES = Object.freeze({
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
});

const LITERALS = Object.freeze([
  Object.freeze({ word: "true", value: true, type: "boolean" }),
  Object.freeze({ word: "false", value: false, type: "boolean" }),
  Object.freeze({ word: "null", value: null, type: "null" }),
]);

function describeError(text, position, message) {
  const bounded = Math.max(0, Math.min(position, text.length));
  let line = 1;
  let column = 1;
  for (let i = 0; i < bounded; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  const near = text.slice(Math.max(0, bounded - 12), Math.min(text.length, bounded + 12));
  return Object.freeze({ message, position: bounded, line, column, near });
}

function fail(state, message, at = state.i) {
  const failure = new Error(message);
  failure.jsonFormatterError = describeError(state.text, at, message);
  throw failure;
}

function skipWhitespace(state) {
  const { text } = state;
  while (state.i < text.length) {
    const code = text.charCodeAt(state.i);
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      state.i += 1;
    } else {
      break;
    }
  }
}

function makeNode(type, key, index, path, value, children, start, end) {
  return Object.freeze({ type, key, index, path, value, children, start, end });
}

function childPath(path, key) {
  return IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function parseStringToken(state) {
  const start = state.i;
  state.i += 1; // opening quote
  let out = "";
  while (state.i < state.text.length) {
    const code = state.text.charCodeAt(state.i);
    if (code === 0x22) {
      state.i += 1;
      return out;
    }
    if (code === 0x5c) {
      state.i += 1;
      if (state.i >= state.text.length) fail(state, "Unterminated string", start);
      const escape = state.text[state.i];
      state.i += 1;
      if (escape === "u") {
        const hex = state.text.slice(state.i, state.i + 4);
        if (!HEX4.test(hex)) fail(state, "Invalid unicode escape", state.i - 1);
        out += String.fromCharCode(parseInt(hex, 16));
        state.i += 4;
      } else if (Object.prototype.hasOwnProperty.call(ESCAPES, escape)) {
        out += ESCAPES[escape];
      } else {
        fail(state, "Invalid escape sequence", state.i - 1);
      }
      continue;
    }
    if (code < 0x20) fail(state, "Unescaped control character in string", state.i);
    out += state.text[state.i];
    state.i += 1;
  }
  fail(state, "Unterminated string", start);
}

function parseObject(state, key, index, path, depth) {
  const start = state.i;
  const children = [];
  state.i += 1; // {
  skipWhitespace(state);
  if (state.text[state.i] === "}") {
    state.i += 1;
    return makeNode("object", key, index, path, null, children, start, state.i);
  }
  while (true) {
    skipWhitespace(state);
    if (state.i >= state.text.length) fail(state, "Unexpected end of input");
    if (state.text[state.i] !== '"') fail(state, "Expected property name");
    const property = parseStringToken(state);
    skipWhitespace(state);
    if (state.i >= state.text.length) fail(state, "Unexpected end of input");
    if (state.text[state.i] !== ":") fail(state, "Expected ':' after property name");
    state.i += 1;
    children.push(parseValue(state, property, null, childPath(path, property), depth + 1));
    skipWhitespace(state);
    if (state.i >= state.text.length) fail(state, "Unexpected end of input");
    if (state.text[state.i] === ",") {
      state.i += 1;
      continue;
    }
    if (state.text[state.i] === "}") {
      state.i += 1;
      break;
    }
    fail(state, "Expected ',' or '}'");
  }
  return makeNode("object", key, index, path, null, children, start, state.i);
}

function parseArray(state, key, index, path, depth) {
  const start = state.i;
  const children = [];
  state.i += 1; // [
  skipWhitespace(state);
  if (state.text[state.i] === "]") {
    state.i += 1;
    return makeNode("array", key, index, path, null, children, start, state.i);
  }
  let next = 0;
  while (true) {
    children.push(parseValue(state, null, next, `${path}[${next}]`, depth + 1));
    next += 1;
    skipWhitespace(state);
    if (state.i >= state.text.length) fail(state, "Unexpected end of input");
    if (state.text[state.i] === ",") {
      state.i += 1;
      continue;
    }
    if (state.text[state.i] === "]") {
      state.i += 1;
      break;
    }
    fail(state, "Expected ',' or ']'");
  }
  return makeNode("array", key, index, path, null, children, start, state.i);
}

function parseValue(state, key, index, path, depth) {
  if (depth > MAX_DEPTH) fail(state, "Nesting is too deep", state.i);
  skipWhitespace(state);
  if (state.i >= state.text.length) fail(state, "Unexpected end of input");
  const ch = state.text[state.i];
  if (ch === "{") return parseObject(state, key, index, path, depth);
  if (ch === "[") return parseArray(state, key, index, path, depth);
  if (ch === '"') {
    const start = state.i;
    const value = parseStringToken(state);
    return makeNode("string", key, index, path, value, null, start, state.i);
  }
  if (ch === "-" || (ch >= "0" && ch <= "9")) {
    const start = state.i;
    const match = NUMBER.exec(state.text.slice(state.i));
    if (!match) fail(state, "Invalid number", start);
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail(state, "Number is out of range", start);
    state.i += match[0].length;
    return makeNode("number", key, index, path, value, null, start, state.i);
  }
  for (const literal of LITERALS) {
    if (state.text.startsWith(literal.word, state.i)) {
      const start = state.i;
      state.i += literal.word.length;
      return makeNode(literal.type, key, index, path, literal.value, null, start, state.i);
    }
  }
  fail(state, "Unexpected token");
}

function toValue(node) {
  if (!node.children) return node.value;
  if (node.type === "array") return node.children.map(toValue);
  const out = {};
  for (const child of node.children) {
    // A plain assignment to "out.__proto__" would invoke the inherited setter
    // and replace the prototype instead of storing the key. Define an own data
    // property so every JSON key survives as ordinary data, including
    // "__proto__", "constructor" and "prototype".
    Object.defineProperty(out, child.key, {
      value: toValue(child),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

function collectStats(root) {
  let nodes = 0;
  let leaves = 0;
  let containers = 0;
  let maxDepth = 0;
  const walk = (node, depth) => {
    nodes += 1;
    if (node.children) {
      containers += 1;
      maxDepth = Math.max(maxDepth, depth);
      for (const child of node.children) walk(child, depth + 1);
    } else {
      leaves += 1;
    }
  };
  walk(root, 1);
  return Object.freeze({ nodes, leaves, containers, maxDepth });
}

export function parseJson(text) {
  if (typeof text !== "string") throw new TypeError("JSON text must be a string");
  const state = { text, i: 0 };
  try {
    skipWhitespace(state);
    if (state.i >= text.length) fail(state, "Unexpected end of input");
    const root = parseValue(state, null, null, "$", 1);
    skipWhitespace(state);
    if (state.i < text.length) fail(state, "Unexpected trailing content");
    return Object.freeze({
      ok: true,
      value: toValue(root),
      root,
      stats: collectStats(root),
      error: null,
    });
  } catch (error) {
    if (error?.jsonFormatterError) {
      return Object.freeze({
        ok: false,
        value: null,
        root: null,
        stats: null,
        error: error.jsonFormatterError,
      });
    }
    throw error;
  }
}

export function serializeJson(root, options = {}) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("Serializer options must be an object");
  }
  const indent = options.indent === undefined ? DEFAULT_INDENT : options.indent;
  if (!VALID_INDENTS.has(indent)) {
    throw new RangeError("indent must be one of 0, 2, 4 or a tab character");
  }
  const sortKeys = options.sortKeys === undefined ? false : options.sortKeys;
  if (typeof sortKeys !== "boolean") throw new TypeError("sortKeys must be a boolean");
  if (!root || typeof root !== "object" || typeof root.type !== "string") {
    throw new TypeError("A parsed root node is required");
  }

  const compact = indent === 0;
  const unit = indent === "\t" ? "\t" : " ".repeat(indent);

  // JSON.stringify already escapes quotes, backslashes and control characters.
  // Escaping <, > and & as well keeps emitted text inert if it is ever placed
  // inside an HTML document; the values still round-trip through the parser.
  const scalarText = (value) => JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  const emit = (node, level) => {
    if (!node.children) return scalarText(node.value);
    const entries = sortKeys && node.type === "object"
      ? node.children.slice().sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      : node.children;
    if (entries.length === 0) return node.type === "array" ? "[]" : "{}";
    const opening = node.type === "array" ? "[" : "{";
    const closing = node.type === "array" ? "]" : "}";
    if (compact) {
      const parts = entries.map((child) => {
        const key = node.type === "object" ? `${scalarText(child.key)}:` : "";
        return `${key}${emit(child, level)}`;
      });
      return `${opening}${parts.join(",")}${closing}`;
    }
    const pad = unit.repeat(level + 1);
    const parts = entries.map((child) => {
      const key = node.type === "object" ? `${scalarText(child.key)}: ` : "";
      return `${pad}${key}${emit(child, level + 1)}`;
    });
    return `${opening}\n${parts.join(",\n")}\n${unit.repeat(level)}${closing}`;
  };

  return emit(root, 0);
}

export function formatJson(text, options = {}) {
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return Object.freeze({ ok: false, text: null, root: null, stats: null, error: parsed.error });
  }
  return Object.freeze({
    ok: true,
    text: serializeJson(parsed.root, options),
    root: parsed.root,
    stats: parsed.stats,
    error: null,
  });
}

export function minifyJson(text) {
  return formatJson(text, { indent: 0 });
}

export function toDownloadName(windowId) {
  const base = typeof windowId === "string" ? windowId : "";
  const safe = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "json";
  return `jsonformatter-${safe}.json`;
}
