/* Markdown Preview pure tokenizer.
   Produces a frozen block/inline AST from plain text. It never parses HTML,
   never creates DOM nodes, never resolves or activates URLs, and touches no
   globals. The renderer turns this AST into elements using only textContent.

   Block nodes: { type:"heading", level, inline } | { type:"paragraph", inline }
                | { type:"list", ordered, items:[[inline], ...] } | { type:"rule" }
   Inline nodes: { type:"text", value } | { type:"strong", inline }
                 | { type:"em", inline } | { type:"code", value }
                 | { type:"link", href, safe, reason, inline }

   Only http:, https: and mailto: (plus relative paths) are marked safe; every
   other scheme yields href:null so the renderer has nothing to activate. */

const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const ESCAPABLE = new Set(["\\", "`", "*", "_", "[", "]", "(", ")", "<", ">"]);

/** Hard bound shared with the app so a huge paste can never start a parse. */
export const MAX_SOURCE_CHARS = 20_000;

const isWordChar = (ch) => ch != null && /[A-Za-z0-9]/.test(ch);

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/** Concatenate the visible text of an inline node list (used by renderer/tests). */
export function inlineText(nodes) {
  let out = "";
  for (const node of nodes || []) {
    if (node.type === "text" || node.type === "code") out += node.value;
    else if (node.inline) out += inlineText(node.inline);
  }
  return out;
}

/** Decide whether a raw link target may be displayed as a link. */
export function sanitizeHref(raw) {
  if (typeof raw !== "string") return { href: null, safe: false, reason: "invalid target" };
  let value = raw.trim();
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  if (!value) return { href: null, safe: false, reason: "empty target" };
  // Reject whitespace, control characters and backslashes: these enable
  // scheme obfuscation and are never needed in a safe preview link.
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return { href: null, safe: false, reason: "unsafe characters" };
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value);
  if (scheme) {
    const name = `${scheme[1].toLowerCase()}:`;
    if (!ALLOWED_SCHEMES.has(name)) return { href: null, safe: false, reason: "blocked scheme" };
  }
  // Protocol-relative and ordinary relative targets contain no scheme to
  // activate; they are rendered as inert, labelled text like all links.
  return { href: value, safe: true, reason: "" };
}

/** Find the next unescaped closing delimiter at or after `from`. */
function findClosing(text, from, delim, { wordBounded = false } = {}) {
  let i = from;
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    // A single-emphasis closer must not consume the first half of a ** pair.
    if (delim.length === 1 && text.startsWith(delim + delim, i)) { i += 2; continue; }
    if (text.startsWith(delim, i)) {
      if (wordBounded && isWordChar(text[i + delim.length])) { i += delim.length; continue; }
      return i;
    }
    i += 1;
  }
  return -1;
}

function parseLink(text, start) {
  let depth = 0;
  let i = start + 1;
  const labelStart = i;
  for (; i < text.length; i += 1) {
    if (text[i] === "\\") { i += 1; continue; }
    if (text[i] === "[") depth += 1;
    else if (text[i] === "]") {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  if (i >= text.length || text[i + 1] !== "(") return null;
  const label = text.slice(labelStart, i);

  let urlDepth = 0;
  let k = i + 2;
  for (; k < text.length; k += 1) {
    if (text[k] === "\\") { k += 1; continue; }
    if (text[k] === "(") urlDepth += 1;
    else if (text[k] === ")") {
      if (urlDepth === 0) break;
      urlDepth -= 1;
    }
  }
  if (k >= text.length) return null;

  const { href, safe, reason } = sanitizeHref(text.slice(i + 2, k));
  return {
    next: k + 1,
    node: { type: "link", href, safe, reason, inline: parseInline(label) },
  };
}

function parseInline(text) {
  const nodes = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      nodes.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\" && i + 1 < text.length && ESCAPABLE.has(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (text.startsWith("**", i)) {
      const end = findClosing(text, i + 2, "**");
      if (end > i + 2) {
        flush();
        nodes.push({ type: "strong", inline: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      const wordBounded = ch === "_";
      if (wordBounded && isWordChar(text[i - 1])) {
        buffer += ch;
        i += 1;
        continue;
      }
      const end = findClosing(text, i + 1, ch, { wordBounded });
      if (end > i + 1) {
        flush();
        nodes.push({ type: "em", inline: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    if (ch === "`") {
      const end = findClosing(text, i + 1, "`");
      if (end > i + 1) {
        flush();
        nodes.push({ type: "code", value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === "[") {
      const link = parseLink(text, i);
      if (link) {
        flush();
        nodes.push(link.node);
        i = link.next;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }
  flush();
  return nodes;
}

const stripClosingHashes = (value) => value.replace(/\s+#+\s*$/, "");

/** Parse markdown source into a deeply frozen block AST. */
export function parseMarkdown(source) {
  if (typeof source !== "string") throw new TypeError("Markdown source must be a string");
  // Reject before any splitting, scanning or allocation so the caller can keep
  // the UI responsive even when the textarea holds a multi-megabyte paste.
  if (source.length > MAX_SOURCE_CHARS) {
    const error = new RangeError(
      `Input has ${source.length.toLocaleString("en-US")} characters; the limit is ${MAX_SOURCE_CHARS.toLocaleString("en-US")}.`,
    );
    error.code = "INPUT_TOO_LONG";
    error.actual = source.length;
    error.max = MAX_SOURCE_CHARS;
    throw error;
  }

  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  const flushAll = () => { flushParagraph(); flushList(); };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { flushAll(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      blocks.push({
        type: "heading",
        level: heading[1].length,
        inline: parseInline(stripClosingHashes(heading[2])),
      });
      continue;
    }

    if (/^([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      blocks.push({ type: "rule" });
      continue;
    }

    const unordered = /^[-+*]\s+(.+)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      flushParagraph();
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(parseInline((unordered || ordered)[1]));
      continue;
    }

    flushList();
    paragraph.push(line);
  }
  flushAll();

  return deepFreeze({ blocks });
}

export default { MAX_SOURCE_CHARS, parseMarkdown, sanitizeHref, inlineText };
