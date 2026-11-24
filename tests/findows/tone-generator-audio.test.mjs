/* Pure Tone Generator reasoning. Written before the helper existed. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FREQUENCY,
  DEFAULT_VOLUME,
  DEFAULT_WAVEFORM,
  FREQUENCY_PRESETS,
  MAX_FREQUENCY,
  MAX_GAIN,
  MAX_VOLUME,
  MIN_FREQUENCY,
  WAVEFORMS,
  audioFailureMessage,
  createToneState,
  formatFrequency,
  formatVolume,
  gainForVolume,
  isWaveform,
  parseFrequency,
  parseVolume,
  reduceTone,
  toneSummary,
  webAudioSupport,
} from "../../findows/js/apps/tone-generator-audio.mjs";

test("audioFailureMessage reports the rejected engine call instead of success", () => {
  assert.equal(audioFailureMessage("start", new Error("resume was rejected by the browser")),
    "Audio could not start. resume was rejected by the browser");
  assert.equal(audioFailureMessage("start", "resuming is not supported in this browser"),
    "Audio could not start. resuming is not supported in this browser");
  assert.equal(audioFailureMessage("start"),
    "Audio could not start. The browser did not accept the request.");
});

test("frequency parsing accepts numeric values inside the audible range", () => {
  assert.deepEqual(parseFrequency(440), { ok: true, value: 440 });
  assert.deepEqual(parseFrequency("880"), { ok: true, value: 880 });
  assert.deepEqual(parseFrequency("20"), { ok: true, value: MIN_FREQUENCY });
  assert.deepEqual(parseFrequency(String(MAX_FREQUENCY)), { ok: true, value: MAX_FREQUENCY });
  assert.deepEqual(parseFrequency(" 523.25 "), { ok: true, value: 523.25 });
});

test("frequency parsing rejects empty, non-numeric and out-of-range values", () => {
  for (const bad of ["", "   ", "abc", NaN, Infinity, -Infinity, null, undefined, 19, 20_001, -220, "1e9"]) {
    const result = parseFrequency(bad);
    assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
    assert.match(result.message, /frequency/i);
  }
});

test("volume parsing accepts whole percentages and rejects invalid values", () => {
  assert.deepEqual(parseVolume(35), { ok: true, value: 35 });
  assert.deepEqual(parseVolume("0"), { ok: true, value: 0 });
  assert.deepEqual(parseVolume("100"), { ok: true, value: MAX_VOLUME });
  for (const bad of ["", "loud", NaN, Infinity, -1, 101, 12.5, null]) {
    const result = parseVolume(bad);
    assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
    assert.match(result.message, /volume/i);
  }
});

test("volume maps to a conservative gain and never exceeds the ceiling", () => {
  assert.equal(gainForVolume(0), 0);
  assert.equal(gainForVolume(100), MAX_GAIN);
  assert.ok(MAX_GAIN <= 0.25);
  assert.ok(gainForVolume(50) > gainForVolume(20));
  assert.ok(gainForVolume(50) < gainForVolume(100));
});

test("frequency and volume formatting stays readable", () => {
  assert.equal(formatFrequency(440), "440 Hz");
  assert.equal(formatFrequency(20), "20 Hz");
  assert.equal(formatFrequency(1000), "1 kHz");
  assert.equal(formatFrequency(1234), "1.2 kHz");
  assert.equal(formatVolume(35), "35%");
});

test("waveform ids are constrained to the four Web Audio primitives", () => {
  assert.deepEqual(WAVEFORMS.map((wave) => wave.id), ["sine", "triangle", "square", "sawtooth"]);
  assert.equal(isWaveform("sine"), true);
  assert.equal(isWaveform("triangle"), true);
  assert.equal(isWaveform("noise"), false);
  assert.equal(isWaveform(""), false);
});

test("presets are distinct, labelled and inside the accepted range", () => {
  assert.equal(FREQUENCY_PRESETS.length, 4);
  assert.deepEqual(FREQUENCY_PRESETS.map((preset) => preset.value), [110, 220, 440, 880]);
  assert.ok(FREQUENCY_PRESETS.every((preset) => preset.label && parseFrequency(preset.value).ok));
});

test("tone state starts silent at A4 and reducer transitions keep state immutable", () => {
  const initial = createToneState();
  assert.deepEqual(initial, { frequency: DEFAULT_FREQUENCY, waveform: DEFAULT_WAVEFORM, volume: DEFAULT_VOLUME, playing: false });
  assert.equal(initial.playing, false, "opening the app must never start a tone");

  const started = reduceTone(initial, "start");
  assert.equal(started.playing, true);
  assert.equal(initial.playing, false, "the previous state object is not mutated");
  const louder = reduceTone(started, "volume", 60);
  assert.equal(louder.volume, 60);
  assert.equal(louder.playing, true);
  const changed = reduceTone(louder, "frequency", 660);
  assert.equal(changed.frequency, 660);
  const waved = reduceTone(changed, "waveform", "square");
  assert.equal(waved.waveform, "square");
  const stopped = reduceTone(waved, "stop");
  assert.equal(stopped.playing, false);
  assert.equal(stopped.frequency, 660, "stopping preserves the chosen sound settings");
  assert.equal(toneSummary(stopped), "Square wave at 660 Hz, 60% volume");
});

test("reducer rejects unknown actions and invalid payloads", () => {
  const state = createToneState();
  assert.throws(() => reduceTone(state, "explode"), RangeError);
  assert.throws(() => reduceTone(state, "frequency", 0), RangeError);
  assert.throws(() => reduceTone(state, "frequency", NaN), RangeError);
  assert.throws(() => reduceTone(state, "volume", 101), RangeError);
  assert.throws(() => reduceTone(state, "waveform", "white-noise"), RangeError);
});

test("Web Audio support detection is truthful for missing constructors", () => {
  assert.deepEqual(webAudioSupport({ AudioContext: function Fake() {} }), { supported: true, reason: "" });
  assert.deepEqual(webAudioSupport({ webkitAudioContext: function Legacy() {} }), { supported: true, reason: "" });
  const absent = webAudioSupport({});
  assert.equal(absent.supported, false);
  assert.match(absent.reason, /not available/i);
});
