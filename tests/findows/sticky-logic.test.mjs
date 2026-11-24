/* Pure Sticky Notes helpers. Red first: the helper does not exist yet. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  NOTE_COLORS,
  NOTE_LIMITS,
  buildNote,
  matchesSearch,
  nextRevision,
  notePreview,
  sanitizeColor,
  sanitizeText,
  sortNotes,
} from "../../findows/js/apps/sticky-logic.mjs";

test("note text is bounded by code points and keeps line breaks", () => {
  assert.equal(NOTE_LIMITS.MAX_TEXT, 2000);
  assert.equal(sanitizeText("a\nb"), "a\nb");
  assert.equal(sanitizeText(null), "");
  assert.equal(sanitizeText(123), "");
  const long = "😀".repeat(2100);
  assert.equal([...sanitizeText(long)].length, 2000, "emoji count as one character each");
  assert.equal(sanitizeText("  spaced  "), "  spaced  ", "ordinary spacing is preserved");
});

test("colors are restricted to the four original note colors", () => {
  assert.deepEqual([...NOTE_COLORS], ["sun", "mint", "sky", "lilac"]);
  assert.equal(sanitizeColor("mint"), "mint");
  assert.equal(sanitizeColor("SKY"), "sky");
  assert.equal(sanitizeColor("<script>"), "sun");
});

test("buildNote normalizes a new record and starts at revision 1", () => {
  const note = buildNote({ id: "n1", text: "hi", color: "mint", pinned: true, createdAt: 100, updatedAt: 200, revision: 9 });
  assert.deepEqual(note, { id: "n1", text: "hi", color: "mint", pinned: true, createdAt: 100, updatedAt: 200, revision: 9 });
  const fresh = buildNote({ id: "n2" });
  assert.equal(fresh.text, "");
  assert.equal(fresh.color, "sun");
  assert.equal(fresh.pinned, false);
  assert.equal(fresh.revision, 1);
  assert.ok(fresh.createdAt > 0 && fresh.updatedAt > 0);
});

test("sort puts pinned notes first, then newest updates, then id", () => {
  const notes = [
    { id: "a", pinned: false, updatedAt: 30 },
    { id: "b", pinned: true, updatedAt: 10 },
    { id: "c", pinned: false, updatedAt: 40 },
    { id: "d", pinned: true, updatedAt: 20 },
    { id: "e", pinned: false, updatedAt: 40 },
  ];
  assert.deepEqual(sortNotes(notes).map((note) => note.id), ["d", "b", "c", "e", "a"]);
  assert.equal(nextRevision({ revision: 4 }), 5);
});

test("search matches note text only, case-insensitively", () => {
  const note = { text: "Buy MILK tomorrow", color: "mint", pinned: true };
  assert.equal(matchesSearch(note, "milk"), true);
  assert.equal(matchesSearch(note, "MILK"), true);
  assert.equal(matchesSearch(note, "tomorrow"), true);
  assert.equal(matchesSearch(note, "mint"), false);
  assert.equal(matchesSearch(note, ""), true);
  assert.equal(matchesSearch(note, "  "), true);
  assert.equal(matchesSearch(note, "not here"), false);
});

test("preview is a short single-line summary for the note list", () => {
  assert.equal(notePreview({ text: "first\nsecond" }), "first second");
  assert.equal(notePreview({ text: "a".repeat(60) }), `${"a".repeat(47)}…`);
  assert.equal(notePreview({ text: "" }), "Empty note");
});
