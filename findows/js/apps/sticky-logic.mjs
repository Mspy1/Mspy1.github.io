/* Pure Sticky Notes helpers: bounded text, four colors, ordering and search.
   No DOM, no storage, no timers. */

export const NOTE_LIMITS = Object.freeze({ MAX_TEXT: 2000, MAX_NOTES: 50, UNDO_MS: 8000 });
export const NOTE_COLORS = Object.freeze(["sun", "mint", "sky", "lilac"]);

export function sanitizeText(value) {
  if (typeof value !== "string") return "";
  return [...value].slice(0, NOTE_LIMITS.MAX_TEXT).join("");
}

export function sanitizeColor(value) {
  const color = String(value ?? "").trim().toLowerCase();
  return NOTE_COLORS.includes(color) ? color : NOTE_COLORS[0];
}

export function buildNote(input = {}) {
  const timestamp = Number.isFinite(input.createdAt) ? input.createdAt : Date.now();
  const updatedAt = Number.isFinite(input.updatedAt) ? input.updatedAt : timestamp;
  return {
    id: typeof input.id === "string" && input.id ? input.id : `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text: sanitizeText(input.text),
    color: sanitizeColor(input.color),
    pinned: Boolean(input.pinned),
    createdAt: timestamp,
    updatedAt,
    revision: Number.isInteger(input.revision) && input.revision >= 1 ? input.revision : 1,
  };
}

/** Pinned first, most recently updated next, id as a deterministic tie-break. */
export function sortNotes(notes) {
  return [...(Array.isArray(notes) ? notes : [])].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function matchesSearch(note, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return true;
  return String(note?.text ?? "").toLowerCase().includes(needle);
}

export function notePreview(note, limit = 48) {
  const flat = String(note?.text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "Empty note";
  const chars = [...flat];
  return chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : flat;
}

export function nextRevision(note) {
  return (Number.isInteger(note?.revision) ? note.revision : 0) + 1;
}
