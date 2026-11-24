/* Unit Converter pure logic: real conversions, formatting, swap, precision, errors. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES,
  convert,
  formatResult,
  createUnitConverter,
} from "../../findows/js/apps/unit-converter-engine.mjs";

const categoryIds = CATEGORIES.map((entry) => entry.id);

test("all seven conversion categories are exposed with units", () => {
  assert.deepEqual(categoryIds, [
    "length", "mass", "temperature", "area", "volume", "data", "time",
  ]);
  for (const entry of CATEGORIES) {
    assert.ok(entry.label, "category has a label");
    assert.ok(entry.units.length >= 2, "category has at least two units");
    for (const unit of entry.units) {
      assert.ok(unit.id && unit.label && unit.symbol, "unit is fully described");
    }
  }
});

test("acceptance: 1 mile is exactly 1.609344 kilometres", () => {
  assert.equal(convert(1, "length", "mi", "km"), 1.609344);
  assert.equal(formatResult(convert(1, "length", "mi", "km"), 6), "1.609344");
  assert.equal(convert(1, "length", "km", "mi"), 1 / 1.609344);
});

test("acceptance: 0 degrees Celsius is exactly 32 degrees Fahrenheit", () => {
  assert.equal(convert(0, "temperature", "c", "f"), 32);
  assert.equal(formatResult(convert(0, "temperature", "c", "f"), 6), "32");
  assert.equal(convert(32, "temperature", "f", "c"), 0);
  assert.equal(convert(100, "temperature", "c", "f"), 212);
  assert.equal(convert(-40, "temperature", "f", "c"), -40);
  assert.equal(convert(0, "temperature", "c", "k"), 273.15);
});

test("mass, area, volume, data and time convert with real factors", () => {
  assert.equal(convert(1, "mass", "lb", "kg"), 0.45359237);
  assert.equal(convert(1, "mass", "kg", "g"), 1000);
  assert.equal(convert(1, "area", "ha", "m2"), 10000);
  assert.equal(convert(1, "area", "acre", "m2"), 4046.8564224);
  assert.equal(convert(1, "volume", "gal", "l"), 3.785411784);
  assert.equal(convert(1, "volume", "l", "ml"), 1000);
  assert.equal(convert(1, "data", "kib", "b"), 1024);
  assert.equal(convert(1, "data", "kb", "b"), 1000);
  assert.equal(convert(1, "time", "h", "s"), 3600);
  assert.equal(convert(1, "time", "day", "min"), 1440);
});

test("conversions are reversible within floating point tolerance", () => {
  for (const entry of CATEGORIES) {
    const first = entry.units[0].id;
    const last = entry.units[entry.units.length - 1].id;
    const there = convert(7.25, entry.id, first, last);
    const back = convert(there, entry.id, last, first);
    assert.ok(Math.abs(back - 7.25) < 1e-9, `${entry.id} round trip`);
  }
});

test("formatResult honours decimal precision and trims trailing zeroes", () => {
  assert.equal(formatResult(1 / 3, 6), "0.333333");
  assert.equal(formatResult(1.609344, 2), "1.61");
  assert.equal(formatResult(1.609344, 0), "2");
  assert.equal(formatResult(32, 6), "32");
  assert.equal(formatResult(-0.0000001, 6), "0");
  assert.equal(formatResult(1000, 12), "1000");
});

test("convert rejects unknown categories/units and non-finite values", () => {
  assert.throws(() => convert(1, "nope", "a", "b"), RangeError);
  assert.throws(() => convert(1, "length", "mi", "nope"), RangeError);
  assert.throws(() => convert(Number.NaN, "length", "mi", "km"), TypeError);
  assert.throws(() => convert(Number.POSITIVE_INFINITY, "length", "mi", "km"), TypeError);
});

const machine = () => createUnitConverter();

test("machine defaults to length, a live result and a frozen snapshot", () => {
  const c = machine();
  const state = c.getState();
  assert.equal(state.category, "length");
  assert.equal(state.from, "mi");
  assert.equal(state.to, "km");
  assert.equal(state.input, "1");
  assert.equal(state.precision, 6);
  assert.equal(state.result, "1.609344");
  assert.equal(state.error, null);
  assert.ok(Object.isFrozen(state));
  assert.deepEqual(state.categories, categoryIds);
  assert.equal(state.units[0].id, "mi", "snapshot units carry public ids for the UI");
  assert.ok(state.units.every((unit) => typeof unit.id === "string" && unit.label && unit.symbol));
});

test("machine setInput recomputes the result from real factors", () => {
  const c = machine();
  assert.equal(c.setInput("2").result, "3.218688");
  assert.equal(c.setInput("-1").result, "-1.609344");
  assert.equal(c.setInput("").result, "");
  assert.equal(c.setInput("").error, null);
});

test("machine rejects invalid input with an error instead of a result", () => {
  const c = machine();
  const bad = c.setInput("abc");
  assert.equal(bad.error?.code, "INVALID_INPUT");
  assert.match(bad.error.message, /number/i);
  assert.equal(bad.result, "");
  const recovered = c.setInput("3");
  assert.equal(recovered.error, null);
  assert.equal(recovered.result, "4.828032");
});

test("machine rejects malformed numbers such as 1.2.3 and stray text", () => {
  const c = machine();
  assert.equal(c.setInput("1.2.3").error?.code, "INVALID_INPUT");
  assert.equal(c.setInput("12abc").error?.code, "INVALID_INPUT");
  assert.equal(c.setInput(" ").error?.code, "INVALID_INPUT");
  assert.equal(c.setInput("1e3").result, "1609.344");
});

test("machine swap exchanges units and reverses the result", () => {
  const c = machine();
  assert.equal(c.getState().result, "1.609344");
  const swapped = c.swap();
  assert.equal(swapped.from, "km");
  assert.equal(swapped.to, "mi");
  assert.equal(formatResult(Number(swapped.result), 6), "0.621371");
  assert.equal(c.swap().from, "mi");
});

test("machine precision control changes displayed decimals", () => {
  const c = machine();
  assert.equal(c.setPrecision(2).result, "1.61");
  assert.equal(c.setPrecision(0).result, "2");
  assert.equal(c.setPrecision(12).result, "1.609344");
  assert.equal(c.getState().precision, 12);
  assert.throws(() => c.setPrecision(13), RangeError);
  assert.throws(() => c.setPrecision(-1), RangeError);
  assert.throws(() => c.setPrecision(1.5), RangeError);
});

test("machine category change picks sensible default units", () => {
  const c = machine();
  const temp = c.setCategory("temperature");
  assert.equal(temp.category, "temperature");
  assert.equal(temp.from, "c");
  assert.equal(temp.to, "f");
  assert.equal(c.setInput("0").result, "32");
  const data = c.setCategory("data");
  assert.equal(data.from, "b");
  assert.equal(data.to, "kib");
  assert.equal(c.setInput("1024").result, "1");
});

test("machine setFrom/setTo reject units outside the active category", () => {
  const c = machine();
  assert.throws(() => c.setFrom("kg"), RangeError);
  assert.equal(c.setFrom("km").from, "km");
  assert.equal(c.setTo("m").to, "m");
  assert.equal(c.getState().result, "1000", "1 km is 1000 m");
  assert.equal(c.setInput("0.001").result, "1", "0.001 km is 1 m");
});

test("machine retains precision and input across swaps", () => {
  const c = machine();
  c.setPrecision(2);
  c.swap();
  assert.equal(c.getState().precision, 2);
  assert.equal(c.getState().input, "1");
});
