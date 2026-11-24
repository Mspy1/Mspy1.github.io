/* Pure Notepad helpers. No DOM, no storage, no application state.
   These are the parts that can be proven without a browser; the module in
   notepad.mjs owns all DOM interaction and storage calls. */

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** One-based line/column for a caret offset. Columns count Unicode code points. */
export function lineColumn(text, index) {
  const value = String(text ?? "");
  const offset = Number.isFinite(index) ? Math.max(0, Math.min(index, value.length)) : 0;
  const before = value.slice(0, offset);
  const line = before.split("\n").length;
  const lastBreak = before.lastIndexOf("\n");
  const column = [...before.slice(lastBreak + 1)].length + 1;
  return { line, column };
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Literal (never regex-interpreted) matches, in document order. */
export function findMatches(text, query, { caseSensitive = false } = {}) {
  const needle = String(query ?? "");
  if (!needle) return [];
  const pattern = new RegExp(escapeRegExp(needle), caseSensitive ? "g" : "gi");
  const matches = [];
  const value = String(text ?? "");
  for (const match of value.matchAll(pattern)) {
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (matches.length >= 20000) break; // keep a 2 MiB document responsive
  }
  return matches;
}

/**
 * Next match after `caret`, wrapping to the first one when the end is reached.
 * A caret inside a match advances to the following match (normal Find-next).
 */
export function nextMatch(matches, caret, { wrap = true } = {}) {
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const position = Number.isFinite(caret) ? caret : 0;
  let index = matches.findIndex((match) => match.end > position);
  let wrapped = false;
  if (index === -1 && wrap) {
    index = 0;
    wrapped = true;
  }
  if (index === -1) return null;
  return { match: matches[index], ordinal: index + 1, total: matches.length, wrapped };
}

/** A suggested download name cannot escape a folder or inject markup. */
export function safeDownloadName(name, fallback = "Untitled.txt") {
  let value = String(name ?? "").trim();
  value = value.replace(/^[.\\/]+/, "_");
  value = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/\s+/g, " ").slice(0, 116);
  if (!value) return fallback;
  if (!/\.txt$/i.test(value)) value = `${value}.txt`;
  return value;
}

/** Reject unsupported or oversized local files before reading their bytes. */
export function validateTextImport({ name, size, type } = {}) {
  const fileName = String(name ?? "");
  const mediaType = String(type ?? "").trim().toLowerCase();
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0 || bytes > MAX_IMPORT_BYTES) {
    return "That file is larger than 2 MiB. Notepad imports UTF-8 text up to 2 MiB.";
  }
  const looksText = /\.txt$/i.test(fileName) || mediaType === "text/plain";
  const active = /^(text\/html|application\/(javascript|json|xml)|image\/svg\+xml)/.test(mediaType);
  if (!looksText || active) return "Choose a plain UTF-8 .txt text file. Active content is not opened.";
  return null;
}

/** Strict UTF-8 decode: malformed bytes are reported, never replaced silently. */
export async function decodeText(buffer) {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return { ok: true, text: decoder.decode(buffer) };
  } catch {
    return { ok: false, error: "That file is not valid UTF-8 text. Nothing was imported." };
  }
}

/** Human-readable recovery guidance for the storage failures Notepad can hit. */
export function describeError(error) {
  switch (error?.code) {
    case "REVISION_CONFLICT":
      return "The saved file changed since you opened it. Nothing was overwritten. Review both versions, save a copy or download a copy.";
    case "QUOTA":
      return "Browser storage is full. Nothing was saved; download a copy to keep your work.";
    case "UNAVAILABLE":
      return "Not saved — download a copy. Local storage is unavailable in this browser.";
    case "NAME_CONFLICT":
    case "EXISTS":
      return "That name is already used in this folder. Choose another name.";
    case "MISSING":
    case "TRASHED":
      return "That file is no longer available. Save a copy or download a copy instead.";
    case "INVALID_NAME":
      return "That name cannot be used. Try a shorter, ordinary file name.";
    default:
      return `Could not save: ${error?.message || "an unknown problem"}. Download a copy to keep your work.`;
  }
}
