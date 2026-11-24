/* Gate: Character Map pure catalog/search logic. No DOM, no network, no markup. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SEARCH_RESULTS,
  formatCode,
  listBlocks,
  getBlock,
  glyphsInBlock,
  findByCode,
  labelFor,
  search,
} from "../../findows/js/apps/character-map-engine.mjs";

test("blocks are a frozen, non-empty catalog with truthful counts", () => {
  const blocks = listBlocks();
  assert.ok(Array.isArray(blocks) && blocks.length >= 12, "at least twelve blocks are offered");
  assert.ok(Object.isFrozen(blocks));
  const ids = blocks.map((block) => block.id);
  assert.equal(new Set(ids).size, ids.length, "block ids are unique");
  for (const block of blocks) {
    assert.ok(Object.isFrozen(block), `${block.id} is frozen`);
    assert.equal(typeof block.id, "string");
    assert.equal(typeof block.label, "string");
    assert.match(block.range, /^U\+[0-9A-F]{4,6}\u2013U\+[0-9A-F]{4,6}$/);
    assert.ok(block.count > 0, `${block.id} has glyphs`);
    assert.equal(block.count, glyphsInBlock(block.id).length, "count matches the real glyph list");
  }
  const emoticons = getBlock("emoticons");
  assert.equal(emoticons.label, "Emoticons");
  assert.equal(getBlock("no-such-block"), null);
  assert.equal(glyphsInBlock("no-such-block"), null);
});

test("glyph records are frozen, ordered and carry the real character and code", () => {
  const glyphs = glyphsInBlock("emoticons");
  assert.ok(Object.isFrozen(glyphs));
  const grin = glyphs.find((glyph) => glyph.code === 0x1f600);
  assert.deepEqual(
    { char: grin.char, name: grin.name, hex: grin.hex, blockId: grin.blockId },
    { char: "\u{1F600}", name: "GRINNING FACE", hex: "U+1F600", blockId: "emoticons" },
  );
  assert.ok(Object.isFrozen(grin));
  for (let index = 1; index < glyphs.length; index += 1) {
    assert.ok(glyphs[index - 1].code < glyphs[index].code, "block glyphs are codepoint ordered");
  }
  assert.equal(findByCode(0x1f600), grin, "findByCode returns the catalog record");
  assert.equal(findByCode(0x10ffff), null, "unlisted codepoints are absent, not invented");
  assert.equal(labelFor(grin), "GRINNING FACE, U+1F600");
});

test("formatCode pads short codes, uppercases hex and rejects invalid codepoints", () => {
  assert.equal(formatCode(0x41), "U+0041");
  assert.equal(formatCode(0x3b1), "U+03B1");
  assert.equal(formatCode(0x1f600), "U+1F600");
  for (const bad of [-1, 0x110000, 0xd800, 0xdfff, 1.5, NaN, "65", null]) {
    assert.throws(() => formatCode(bad), RangeError, `formatCode(${String(bad)}) must be rejected`);
  }
});

test("search finds a glyph by human name and returns a bounded report", () => {
  const result = search("grinning");
  assert.equal(result.query, "grinning");
  assert.ok(result.results.some((glyph) => glyph.code === 0x1f600));
  assert.equal(result.truncated, false);
  assert.ok(result.totalMatches >= result.results.length);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.results));
});

test("search accepts U+ notation, bare hex, decimal and the literal glyph", () => {
  assert.equal(search("U+03B1").results[0].code, 0x3b1, "U+ notation resolves the exact glyph first");
  assert.equal(search("0x03B1").results[0].name, "GREEK SMALL LETTER ALPHA");
  assert.equal(search("03b1").results[0].code, 0x3b1, "bare hex resolves too");
  assert.equal(search("128512").results[0].code, 0x1f600, "decimal codepoint resolves");
  assert.equal(search("\u{03B1}").results[0].code, 0x3b1, "typing the glyph itself resolves");
  assert.equal(search("U+FFFF").results.length, 0, "a valid but uncatalogued codepoint returns nothing");
});

test("search is case-insensitive, trimmed and honest about truncation", () => {
  assert.ok(search("  GRINNING  ").results.some((glyph) => glyph.code === 0x1f600));
  const broad = search("a");
  assert.equal(broad.results.length, MAX_SEARCH_RESULTS);
  assert.equal(broad.truncated, true);
  assert.ok(broad.totalMatches > broad.results.length, "the hidden remainder is counted, not silently dropped");
});

test("empty and invalid queries are inert: no results, no mutation, no throw on text", () => {
  for (const query of ["", "   "]) {
    const result = search(query);
    assert.deepEqual(Array.from(result.results), []);
    assert.equal(result.query, "");
    assert.equal(result.totalMatches, 0);
    assert.equal(result.truncated, false);
  }
  assert.equal(search("<img src=x onerror=alert(1)>").results.length, 0, "markup is treated as inert text");
  assert.equal(search("javascript:alert(1)").results.length, 0);
  for (const bad of [42, null, undefined, {}, ["a"]]) {
    assert.throws(() => search(bad), TypeError, `search(${String(bad)}) must be rejected`);
  }
  assert.equal(listBlocks().length >= 12, true, "rejected queries leave the catalog intact");
});

test("catalog data is inert plain text: one scalar per glyph and no markup characters", () => {
  let total = 0;
  for (const block of listBlocks()) {
    for (const glyph of glyphsInBlock(block.id)) {
      total += 1;
      assert.equal(Array.from(glyph.char).length, 1, `${glyph.hex} is a single Unicode scalar`);
      assert.ok(glyph.code >= 0x20 && glyph.code !== 0x7f, `${glyph.hex} is not a control or blank character`);
      assert.equal(glyph.hex, formatCode(glyph.code));
      assert.equal(glyph.blockId, block.id);
      assert.ok(!/[<>&"'`]/.test(glyph.name), `${glyph.hex} has a plain-text name`);
      assert.ok(!/javascript:|https?:|onerror=/i.test(glyph.name), `${glyph.hex} name has no active content`);
      assert.ok(glyph.name.trim().length > 0);
    }
  }
  assert.ok(total >= 300, `the catalog is substantial (${total} glyphs)`);
});
