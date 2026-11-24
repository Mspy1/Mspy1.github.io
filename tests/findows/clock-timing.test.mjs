/* Pure Clock timing reasoning. Written before the implementation existed. */
process.env.TZ = "Pacific/Kiritimati";
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DURATION_MS,
  localISODate,
  formatStopwatch,
  formatCountdown,
  parseDuration,
  createStopwatchState,
  stopwatchRunning,
  stopwatchElapsedMs,
  reduceStopwatch,
  createCountdownState,
  countdownRunning,
  countdownRemainingMs,
  countdownComplete,
  reduceCountdown,
} from "../../findows/js/apps/clock-timing.mjs";

test("local ISO date follows local calendar fields, not the UTC day", () => {
  // Run with TZ=Pacific/Kiritimati: 10:00Z is already the next local day.
  const nearMidnight = new Date("2026-11-24T10:00:00Z");
  assert.equal(nearMidnight.toISOString().slice(0, 10), "2026-11-24");
  assert.equal(localISODate(nearMidnight), "2026-11-25");
  assert.equal(localISODate(new Date(2026, 0, 2, 23, 30)), "2026-01-02");
});

test("stopwatch formatting uses hundredths and adds hours only when needed", () => {
  assert.equal(formatStopwatch(0), "00:00.00");
  assert.equal(formatStopwatch(9_999), "00:09.99");
  assert.equal(formatStopwatch(59_999), "00:59.99");
  assert.equal(formatStopwatch(3_600_000), "01:00:00.00");
});

test("countdown formatting rounds up whole seconds until it reaches zero", () => {
  assert.equal(formatCountdown(0), "00:00");
  assert.equal(formatCountdown(1), "00:01");
  assert.equal(formatCountdown(61_000), "01:01");
  assert.equal(formatCountdown(3_600_000), "01:00:00");
});

test("duration parsing accepts padded numeric strings", () => {
  assert.deepEqual(parseDuration({ hours: "1", minutes: "02", seconds: "3" }), { ok: true, ms: 3_723_000 });
  assert.deepEqual(parseDuration({ hours: "", minutes: "5", seconds: "" }), { ok: true, ms: 300_000 });
});

test("duration parsing rejects empty, fractional, negative and out-of-range values", () => {
  assert.equal(parseDuration({ hours: "", minutes: "", seconds: "" }).ok, false);
  assert.equal(parseDuration({ hours: "", minutes: "", seconds: "" }).field, null);
  assert.equal(parseDuration({ seconds: "60" }).field, "seconds");
  assert.equal(parseDuration({ minutes: "-1" }).field, "minutes");
  assert.equal(parseDuration({ hours: "24" }).field, "hours");
  assert.equal(parseDuration({ seconds: "1.5" }).ok, false);
  assert.equal(parseDuration({ seconds: "abc" }).ok, false);
  assert.equal(MAX_DURATION_MS, 86_399_000);
});

test("stopwatch elapsed time comes from timestamps, not from tick counts", () => {
  let state = createStopwatchState();
  assert.equal(stopwatchRunning(state), false);
  assert.equal(stopwatchElapsedMs(state, 50_000), 0);

  state = reduceStopwatch(state, "start", 1_000);
  assert.equal(stopwatchRunning(state), true);
  assert.equal(stopwatchElapsedMs(state, 1_250), 250);
  // A long jump in `now` is reflected immediately without any intermediate tick.
  assert.equal(stopwatchElapsedMs(state, 61_000), 60_000);

  state = reduceStopwatch(state, "pause", 61_500);
  assert.equal(stopwatchRunning(state), false);
  assert.equal(stopwatchElapsedMs(state, 999_999), 60_500);

  state = reduceStopwatch(state, "start", 1_000_000);
  assert.equal(stopwatchElapsedMs(state, 1_000_750), 61_250);
});

test("stopwatch laps are split from cumulative timestamps and newest comes first", () => {
  let state = reduceStopwatch(createStopwatchState(), "start", 0);
  state = reduceStopwatch(state, "lap", 1_000);
  state = reduceStopwatch(state, "lap", 2_500);
  assert.equal(state.laps.length, 2);
  assert.equal(state.laps[0].lapMs, 1_500);
  assert.equal(state.laps[0].totalMs, 2_500);
  assert.equal(state.laps[1].lapMs, 1_000);
  assert.equal(state.laps[1].totalMs, 1_000);

  const paused = reduceStopwatch(state, "pause", 3_000);
  assert.strictEqual(reduceStopwatch(paused, "lap", 4_000), paused);
  const reset = reduceStopwatch(paused, "reset", 5_000);
  assert.equal(reset.accumulatedMs, 0);
  assert.equal(reset.startedAt, null);
  assert.equal(reset.laps.length, 0);
});

test("starting a running stopwatch is a no-op", () => {
  const running = reduceStopwatch(createStopwatchState(), "start", 100);
  assert.strictEqual(reduceStopwatch(running, "start", 200), running);
});

test("countdown remaining time is clamped and pause/resume preserves it", () => {
  let state = createCountdownState(2_000);
  assert.equal(countdownRemainingMs(state, 9_000), 2_000);

  state = reduceCountdown(state, "start", 500);
  assert.equal(countdownRunning(state), true);
  assert.equal(countdownRemainingMs(state, 1_200), 1_300);
  assert.equal(countdownComplete(state, 2_499), false);

  state = reduceCountdown(state, "pause", 1_000);
  assert.equal(countdownRunning(state), false);
  assert.equal(countdownRemainingMs(state, 9_000), 1_500);

  state = reduceCountdown(state, "start", 10_000);
  assert.equal(countdownRemainingMs(state, 11_000), 500);
  assert.equal(countdownComplete(state, 11_500), true);
  assert.equal(countdownRemainingMs(state, 99_000), 0);
});

test("countdown completes once and reset restores the same duration", () => {
  let state = reduceCountdown(createCountdownState(1_000), "start", 0);
  assert.equal(countdownComplete(state, 1_000), true);
  const finished = reduceCountdown(state, "complete", 1_000);
  assert.equal(finished.completed, true);
  assert.equal(finished.startedAt, null);
  assert.strictEqual(reduceCountdown(finished, "start", 5_000), finished);
  assert.strictEqual(reduceCountdown(finished, "resume", 5_000), finished);
  assert.equal(countdownRemainingMs(finished, 50_000), 0);

  const reset = reduceCountdown(finished, "reset", 50_000);
  assert.equal(reset.durationMs, 1_000);
  assert.equal(reset.completed, false);
  assert.equal(countdownRunning(reset), false);
  assert.equal(countdownRemainingMs(reset, 50_000), 1_000);
});

test("unknown timer actions are rejected", () => {
  assert.throws(() => reduceStopwatch(createStopwatchState(), "nope", 0), RangeError);
  assert.throws(() => reduceCountdown(createCountdownState(1_000), "nope", 0), RangeError);
});
