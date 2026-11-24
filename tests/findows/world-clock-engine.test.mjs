/* Pure World Clock reasoning. Written before the implementation existed.
   These cases pin the IANA/DST behaviour and the curated-list reducers. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CURATED_ZONES,
  DEFAULT_ZONES,
  isValidZone,
  zoneLabel,
  zoneOffsetMinutes,
  formatOffset,
  formatZoneTime,
  createZoneState,
  addZone,
  removeZone,
} from "../../findows/js/apps/world-clock-engine.mjs";

test("acceptance: one instant renders distinct, correctly dated local times", () => {
  const instant = new Date("2026-07-01T20:00:00Z");
  const utc = formatZoneTime("UTC", instant);
  const tokyo = formatZoneTime("Asia/Tokyo", instant);
  const newYork = formatZoneTime("America/New_York", instant);

  assert.equal(utc.ok, true);
  assert.equal(utc.time, "20:00:00");
  assert.equal(utc.dateKey, "2026-07-01");

  assert.equal(tokyo.ok, true);
  assert.equal(tokyo.time, "05:00:00");
  assert.equal(tokyo.dateKey, "2026-07-02"); // the local day rolls over
  assert.match(tokyo.dateLabel, /2 Jul 2026/);

  assert.equal(newYork.ok, true);
  assert.equal(newYork.time, "16:00:00");
  assert.equal(newYork.dateKey, "2026-07-01");
});

test("DST is derived from the instant and the IANA rule, not a fixed offset", () => {
  const summer = new Date("2026-07-01T12:00:00Z");
  const winter = new Date("2026-01-01T12:00:00Z");

  assert.equal(formatZoneTime("Europe/London", summer).time, "13:00:00");
  assert.equal(formatZoneTime("Europe/London", winter).time, "12:00:00");
  assert.equal(formatZoneTime("America/New_York", summer).time, "08:00:00");
  assert.equal(formatZoneTime("America/New_York", winter).time, "07:00:00");

  assert.equal(zoneOffsetMinutes("Europe/London", summer), 60);
  assert.equal(zoneOffsetMinutes("Europe/London", winter), 0);
  assert.equal(zoneOffsetMinutes("America/New_York", summer), -240);
  assert.equal(zoneOffsetMinutes("America/New_York", winter), -300);
  assert.equal(zoneOffsetMinutes("Asia/Kolkata", summer), 330);
});

test("offsets are labelled with a sign and a padded hour:minute", () => {
  assert.equal(formatOffset(0), "UTC+00:00");
  assert.equal(formatOffset(330), "UTC+05:30");
  assert.equal(formatOffset(60), "UTC+01:00");
  assert.equal(formatOffset(-300), "UTC-05:00");
  assert.equal(formatOffset(-630), "UTC-10:30");
});

test("the curated list is local, unique and entirely valid", () => {
  assert.ok(CURATED_ZONES.length >= 10);
  const ids = CURATED_ZONES.map((zone) => zone.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const zone of CURATED_ZONES) {
    assert.equal(isValidZone(zone.id), true, `${zone.id} should be valid`);
    assert.ok(zone.label && zone.label.length > 0, `${zone.id} needs a label`);
  }
  assert.ok(DEFAULT_ZONES.length >= 3);
  for (const id of DEFAULT_ZONES) assert.ok(ids.includes(id), `${id} should be curated`);
  assert.equal(zoneLabel("Asia/Tokyo"), "Tokyo");
  assert.equal(zoneLabel("UTC"), "UTC");
  // A valid IANA zone outside the curated list still gets a readable label.
  assert.equal(zoneLabel("America/Toronto"), "Toronto");
});

test("invalid zones are rejected without throwing, in validation and rendering", () => {
  for (const bad of ["Mars/Olympus", "", "   ", null, undefined, 42]) {
    assert.equal(isValidZone(bad), false, `${String(bad)} must be invalid`);
  }
  const rendered = formatZoneTime("Mars/Olympus", new Date("2026-07-01T12:00:00Z"));
  assert.equal(rendered.ok, false);
  assert.match(rendered.message, /Mars\/Olympus/);
});

test("creating a zone state filters invalid entries and removes duplicates", () => {
  const state = createZoneState(["UTC", "UTC", "Mars/Olympus", "Asia/Tokyo", ""]);
  assert.deepEqual([...state], ["UTC", "Asia/Tokyo"]);
  assert.deepEqual([...createZoneState(null)], []);
});

test("addZone rejects invalid and duplicate zones and returns a frozen new state", () => {
  const state = createZoneState(["UTC", "Asia/Tokyo"]);
  const invalid = addZone(state, "Mars/Olympus");
  assert.equal(invalid.ok, false);
  assert.strictEqual(invalid.state, state);
  assert.match(invalid.message, /time zone/i);

  const duplicate = addZone(state, "UTC");
  assert.equal(duplicate.ok, false);
  assert.strictEqual(duplicate.state, state);
  assert.match(duplicate.message, /already/i);

  const added = addZone(state, "Europe/Berlin");
  assert.equal(added.ok, true);
  assert.deepEqual([...added.state], ["UTC", "Asia/Tokyo", "Europe/Berlin"]);
  assert.deepEqual([...state], ["UTC", "Asia/Tokyo"]); // original untouched
  assert.equal(Object.isFrozen(added.state), true);
});

test("removeZone removes a present zone and rejects an absent one", () => {
  const state = createZoneState(["UTC", "Asia/Tokyo"]);
  const removed = removeZone(state, "UTC");
  assert.equal(removed.ok, true);
  assert.deepEqual([...removed.state], ["Asia/Tokyo"]);
  assert.deepEqual([...state], ["UTC", "Asia/Tokyo"]);

  const absent = removeZone(state, "Europe/Berlin");
  assert.equal(absent.ok, false);
  assert.strictEqual(absent.state, state);
});
