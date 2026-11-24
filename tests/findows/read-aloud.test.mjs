/* Pure Read Aloud reasoning. Written before the implementation existed:
   option bounds, text preparation, local-only voices, capability reporting
   and the playback state machine. No DOM, no speech API, no dependencies. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  PITCH_DEFAULT,
  PITCH_MAX,
  PITCH_MIN,
  RATE_DEFAULT,
  RATE_MAX,
  RATE_MIN,
  VOLUME_DEFAULT,
  VOLUME_MAX,
  VOLUME_MIN,
  clampOption,
  clampPitch,
  clampRate,
  clampVolume,
  controlFailureMessage,
  createSpeechState,
  describeSupport,
  isLocalVoice,
  localVoices,
  prepareText,
  reduceSpeech,
  voiceKey,
  voiceLabel,
} from "../../findows/js/apps/read-aloud-logic.mjs";

/* ---------- acceptance examples ---------- */

test("prepareText collapses whitespace so speech receives one clean string", () => {
  assert.equal(prepareText("  Hello   world\nfrom  Findows\t"), "Hello world from Findows");
  assert.equal(prepareText("Already clean."), "Already clean.");
  assert.equal(prepareText(""), "");
});

test("option clamps keep speech values inside the Web Speech ranges", () => {
  assert.equal(RATE_MIN, 0.1);
  assert.equal(RATE_MAX, 10);
  assert.equal(RATE_DEFAULT, 1);
  assert.equal(PITCH_MIN, 0);
  assert.equal(PITCH_MAX, 2);
  assert.equal(PITCH_DEFAULT, 1);
  assert.equal(VOLUME_MIN, 0);
  assert.equal(VOLUME_MAX, 1);
  assert.equal(VOLUME_DEFAULT, 1);

  assert.equal(clampRate("1.5"), 1.5); // numeric strings come from range inputs
  assert.equal(clampRate(0), RATE_MIN);
  assert.equal(clampRate(99), RATE_MAX);
  assert.equal(clampPitch(-4), PITCH_MIN);
  assert.equal(clampPitch(7), PITCH_MAX);
  assert.equal(clampVolume(0.5), 0.5);
  assert.equal(clampOption(2, 0, 1, 0.5), 1);
});

test("describeSupport is truthful: real speak() and constructor required, no fallback claim", () => {
  const synth = { speak() {} };
  class Utterance {}
  assert.deepEqual(describeSupport({ speechSynthesis: synth, SpeechSynthesisUtterance: Utterance }),
    { available: true, reason: "" });
  const missing = describeSupport({});
  assert.equal(missing.available, false);
  assert.match(missing.reason, /not available/i);
  assert.equal(describeSupport({ speechSynthesis: {}, SpeechSynthesisUtterance: Utterance }).available, false);
  assert.equal(describeSupport({ speechSynthesis: synth, SpeechSynthesisUtterance: null }).available, false);
});

test("only local voices are offered, deduplicated and sorted by language then name", () => {
  const remote = { name: "Cloud English", lang: "en-US", localService: false, voiceURI: "remote" };
  const localA = { name: "Zoe", lang: "en-GB", localService: true, voiceURI: "zoe" };
  const localB = { name: "Amir", lang: "en-US", localService: true, voiceURI: "amir" };
  const dup = { ...localB };
  assert.equal(isLocalVoice(remote), false);
  assert.equal(isLocalVoice(localB), true);

  const list = localVoices([remote, localA, dup, localB, null, { name: "Unknown" }]);
  // en-GB sorts before en-US, so Zoe (GB) precedes Amir (US) despite the name.
  assert.deepEqual(list.map((v) => v.name), ["Zoe", "Amir"]);
  assert.deepEqual(localVoices(undefined), []);
  assert.equal(Object.isFrozen(list), true);
});

test("voice labels and keys are human-readable and stable", () => {
  const voice = { name: "Amir", lang: "en-US", voiceURI: "amir" };
  assert.equal(voiceLabel(voice), "Amir (en-US)");
  assert.equal(voiceLabel(null), "System default voice");
  assert.equal(voiceKey(voice), "en-US|Amir|amir");
  assert.equal(voiceKey(null), "");
});

test("playback state machine follows play → pause → resume → stop → natural end", () => {
  let state = createSpeechState();
  assert.deepEqual(state, { status: "idle", error: null });

  state = reduceSpeech(state, { type: "play", text: "Hello world" });
  assert.equal(state.status, "speaking");
  state = reduceSpeech(state, { type: "pause" });
  assert.equal(state.status, "paused");
  state = reduceSpeech(state, { type: "resume" });
  assert.equal(state.status, "speaking");
  state = reduceSpeech(state, { type: "stop" });
  assert.equal(state.status, "idle");
  state = reduceSpeech(state, { type: "play", text: "Again" });
  state = reduceSpeech(state, { type: "end" });
  assert.equal(state.status, "idle");
  assert.equal(state.error, null);
});

/* ---------- invalid / error cases ---------- */

test("play with empty or whitespace-only text is refused with an error, not a silent start", () => {
  let state = reduceSpeech(createSpeechState(), { type: "play", text: "   \n  " });
  assert.equal(state.status, "idle");
  assert.match(state.error, /type or paste/i);
  state = reduceSpeech(state, { type: "play" });
  assert.equal(state.status, "idle");
  assert.ok(state.error);
});

test("unavailable capability blocks playback until a ready action, and errors clear on stop", () => {
  let state = reduceSpeech(createSpeechState(), { type: "unavailable" });
  assert.equal(state.status, "unavailable");
  const blocked = reduceSpeech(state, { type: "play", text: "Hello" });
  assert.strictEqual(blocked, state);

  state = reduceSpeech(state, { type: "play", text: "x" });
  assert.equal(state.status, "unavailable");
  state = reduceSpeech(state, { type: "error", message: "Voice failed" });
  assert.equal(state.status, "unavailable");
  state = reduceSpeech(state, { type: "ready" });
  assert.equal(state.status, "idle");
  state = reduceSpeech(state, { type: "play", text: "x" });
  state = reduceSpeech(state, { type: "error", message: "Voice failed" });
  assert.equal(state.status, "idle");
  assert.equal(state.error, "Voice failed");
  state = reduceSpeech(state, { type: "stop" });
  assert.equal(state.error, null);
});

test("unknown actions leave state untouched", () => {
  const state = createSpeechState();
  assert.strictEqual(reduceSpeech(state, { type: "nonsense" }), state);
  assert.strictEqual(reduceSpeech(state), state);
});

test("a failed control reports the error without claiming the new playback state", () => {
  let state = reduceSpeech(createSpeechState(), { type: "play", text: "Hello" });
  state = reduceSpeech(state, { type: "failure", message: "Reading could not be paused." });
  assert.equal(state.status, "speaking"); // the engine was never paused
  assert.equal(state.error, "Reading could not be paused.");

  state = reduceSpeech(state, { type: "pause" });
  assert.equal(state.status, "paused");
  state = reduceSpeech(state, { type: "failure", message: "Reading could not be resumed." });
  assert.equal(state.status, "paused"); // the engine was never resumed
  assert.equal(state.error, "Reading could not be resumed.");

  // A later successful control clears the truthful error.
  state = reduceSpeech(state, { type: "resume" });
  assert.equal(state.status, "speaking");
  assert.equal(state.error, null);
});

test("controlFailureMessage names the exact failed control and keeps engine detail", () => {
  assert.equal(controlFailureMessage("pause", new Error("pause was rejected")),
    "Reading could not be paused. pause was rejected");
  assert.equal(controlFailureMessage("resume", "resuming is not supported in this browser"),
    "Reading could not be resumed. resuming is not supported in this browser");
  assert.equal(controlFailureMessage("pause"),
    "Reading could not be paused. The browser did not accept the request.");
});
