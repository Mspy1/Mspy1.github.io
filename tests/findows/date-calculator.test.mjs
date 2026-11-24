/* Pure date-calculator logic. Written before the engine existed (RED first).
   Dates are calendar dates supplied as YYYY-MM-DD; no device timezone is used
   to decide which day a value means. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLocalDate,
  isValidLocalDate,
  formatLocalDate,
  todayLocalDate,
  daysBetween,
  addDays,
  addMonths,
  shiftDate,
  describeSpan,
} from "../../findows/js/apps/date-calculator-engine.mjs";

test("parseLocalDate reads a calendar date and accepts a real leap day", () => {
  assert.deepEqual(parseLocalDate("2024-02-29"), { ok: true, year: 2024, month: 2, day: 29 });
  assert.deepEqual(parseLocalDate("2026-01-01"), { ok: true, year: 2026, month: 1, day: 1 });
  assert.equal(parseLocalDate("0003-12-31").ok, true);
});

test("parseLocalDate rejects impossible dates and malformed input", () => {
  const invalid = [
    "2025-02-29", // not a leap year
    "1900-02-29", // century rule
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-02-30",
    "2026-1-01",
    "01/01/2026",
    "",
    null,
    undefined,
    20260101,
  ];
  for (const value of invalid) {
    const result = parseLocalDate(value);
    assert.equal(result.ok, false, `${String(value)} should be rejected`);
    assert.equal(typeof result.message, "string");
    assert.ok(result.message.length > 0);
  }
  assert.equal(isValidLocalDate("2024-02-29"), true);
  assert.equal(isValidLocalDate("2025-02-29"), false);
});

test("formatLocalDate round-trips parsed values", () => {
  assert.equal(formatLocalDate({ year: 2026, month: 1, day: 1 }), "2026-01-01");
  assert.equal(formatLocalDate(parseLocalDate("2024-02-29")), "2024-02-29");
  assert.throws(() => formatLocalDate({ year: 2026, month: 2, day: 30 }), RangeError);
});

test("todayLocalDate uses local calendar fields from the supplied instant", () => {
  // 10:00 UTC on 2026-11-24 is already the 25th in UTC+14 (840 minutes).
  assert.equal(todayLocalDate(new Date("2026-11-24T10:00:00Z"), 14 * 60), "2026-11-25");
  assert.equal(todayLocalDate(new Date("2026-11-24T23:30:00Z"), 0), "2026-11-24");
  assert.match(todayLocalDate(), /^\d{4}-\d{2}-\d{2}$/);
});

test("daysBetween counts a leap-year span exactly and is signed", () => {
  assert.equal(daysBetween("2024-02-28", "2024-03-01"), 2); // 29 Feb is counted
  assert.equal(daysBetween("2023-02-28", "2023-03-01"), 1);
  assert.equal(daysBetween("2024-01-01", "2025-01-01"), 366);
  assert.equal(daysBetween("2025-01-01", "2026-01-01"), 365);
  assert.equal(daysBetween("2026-01-01", "2026-01-01"), 0);
  assert.equal(daysBetween("2026-01-31", "2026-01-01"), -30);
  assert.throws(() => daysBetween("2025-02-29", "2026-01-01"), RangeError);
  assert.throws(() => daysBetween("2026-01-01", "not-a-date"), RangeError);
});

test("addDays shifts calendar days, including the 2026-01-01 +30 acceptance case", () => {
  assert.equal(addDays("2026-01-01", 30), "2026-01-31");
  assert.equal(addDays("2026-01-31", -30), "2026-01-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2023-02-28", 1), "2023-03-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-01-01", 0), "2026-01-01");
  assert.throws(() => addDays("2026-02-30", 1), RangeError);
  assert.throws(() => addDays("2026-01-01", 1.5), RangeError);
  assert.throws(() => addDays("2026-01-01", "30"), RangeError);
});

test("addMonths clamps to the last valid day of the target month", () => {
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2024-01-31", 2), "2024-03-31");
  assert.equal(addMonths("2023-01-31", 1), "2023-02-28");
  assert.equal(addMonths("2024-03-31", -1), "2024-02-29");
  assert.equal(addMonths("2026-01-31", -1), "2025-12-31");
  assert.equal(addMonths("2026-01-15", 12), "2027-01-15");
  assert.throws(() => addMonths("2025-02-29", 1), RangeError);
  assert.throws(() => addMonths("2026-01-01", 2.5), RangeError);
});

test("shiftDate dispatches units and rejects unknown units", () => {
  assert.equal(shiftDate("2026-01-01", 30, "days"), "2026-01-31");
  assert.equal(shiftDate("2026-01-01", 30, "day"), "2026-01-31");
  assert.equal(shiftDate("2024-01-31", 1, "months"), "2024-02-29");
  assert.equal(shiftDate("2024-01-31", 1, "month"), "2024-02-29");
  assert.equal(shiftDate("2026-01-01", -30, "days"), "2025-12-02");
  assert.throws(() => shiftDate("2026-01-01", 1, "years"), RangeError);
});

test("describeSpan pluralizes counted days", () => {
  assert.equal(describeSpan(0), "0 days");
  assert.equal(describeSpan(1), "1 day");
  assert.equal(describeSpan(30), "30 days");
  assert.equal(describeSpan(-1), "-1 day");
  assert.equal(describeSpan(-30), "-30 days");
});
