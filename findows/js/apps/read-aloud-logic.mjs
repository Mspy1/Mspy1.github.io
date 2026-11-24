/* Pure reasoning for Read Aloud. Kept free of DOM, speech API calls and
   dependencies so every decision can be tested in plain Node. The browser
   module owns all side effects (utterances, timers and listeners). */

export const RATE_MIN = 0.1;
export const RATE_MAX = 10;
export const RATE_DEFAULT = 1;
export const PITCH_MIN = 0;
export const PITCH_MAX = 2;
export const PITCH_DEFAULT = 1;
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 1;
export const VOLUME_DEFAULT = 1;

/** Coerce numeric strings from range inputs; fall back instead of guessing. */
export function clampOption(value, min, max, fallback) {
  let number;
  if (typeof value === "number") number = value;
  else if (typeof value === "string" && value.trim() !== "") number = Number(value);
  else return fallback;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function clampRate(value) {
  return clampOption(value, RATE_MIN, RATE_MAX, RATE_DEFAULT);
}

export function clampPitch(value) {
  return clampOption(value, PITCH_MIN, PITCH_MAX, PITCH_DEFAULT);
}

export function clampVolume(value) {
  return clampOption(value, VOLUME_MIN, VOLUME_MAX, VOLUME_DEFAULT);
}

/** One utterance receives one clean string; whitespace is not spoken. */
export function prepareText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

/** Truthful capability report: never claim speech when speak() is absent. */
export function describeSupport({ speechSynthesis, SpeechSynthesisUtterance } = {}) {
  const available = Boolean(
    speechSynthesis &&
      typeof speechSynthesis.speak === "function" &&
      typeof SpeechSynthesisUtterance === "function",
  );
  return available
    ? { available: true, reason: "" }
    : {
        available: false,
        reason: "Speech playback is not available in this browser. Your text stays here and is not sent anywhere.",
      };
}

/** Remote/network voices are never offered; this app must stay offline. */
export function isLocalVoice(voice) {
  return Boolean(voice && typeof voice === "object" && voice.localService === true);
}

export function voiceKey(voice) {
  if (!voice || typeof voice !== "object") return "";
  return `${voice.lang || ""}|${voice.name || ""}|${voice.voiceURI || ""}`;
}

export function voiceLabel(voice) {
  if (!voice || typeof voice !== "object") return "System default voice";
  const name = String(voice.name || "Unnamed voice").trim() || "Unnamed voice";
  const lang = String(voice.lang || "").trim();
  return lang ? `${name} (${lang})` : name;
}

/** Dedupe local voices, sort by language then name, return a frozen snapshot. */
export function localVoices(voices) {
  if (!Array.isArray(voices)) return Object.freeze([]);
  const seen = new Set();
  const result = [];
  for (const voice of voices) {
    if (!isLocalVoice(voice)) continue;
    const key = voiceKey(voice);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(voice);
  }
  result.sort((a, b) => {
    const byLang = String(a.lang || "").localeCompare(String(b.lang || ""));
    return byLang || String(a.name || "").localeCompare(String(b.name || ""));
  });
  return Object.freeze(result);
}

/** Truthful wording for a control the browser refused. Keeps the engine's
    detail instead of replacing it with a success-sounding announcement. */
export function controlFailureMessage(action, cause) {
  const prefix = action === "pause"
    ? "Reading could not be paused."
    : action === "resume"
      ? "Reading could not be resumed."
      : "Playback could not be controlled.";
  const detail = typeof cause === "string"
    ? cause
    : (cause && cause.message ? String(cause.message) : "");
  return detail ? `${prefix} ${detail}` : `${prefix} The browser did not accept the request.`;
}

export function createSpeechState() {
  return Object.freeze({ status: "idle", error: null });
}

/** Small, pure playback state machine; the module mirrors these states to UI. */
export function reduceSpeech(state = createSpeechState(), action = {}) {
  const type = action && action.type;
  if (type === "unavailable") return Object.freeze({ status: "unavailable", error: null });
  if (type === "ready") return Object.freeze({ status: "idle", error: null });

  if (type === "play") {
    if (state.status === "unavailable") return state;
    if (!prepareText(action.text)) {
      return Object.freeze({ status: "idle", error: "Type or paste text to read first." });
    }
    return Object.freeze({ status: "speaking", error: null });
  }
  if (type === "pause") {
    if (state.status !== "speaking") return state;
    return Object.freeze({ status: "paused", error: null });
  }
  if (type === "resume") {
    if (state.status !== "paused") return state;
    return Object.freeze({ status: "speaking", error: null });
  }
  if (type === "stop" || type === "end") {
    if (state.status === "unavailable") return state;
    return Object.freeze({ status: "idle", error: null });
  }
  if (type === "error") {
    if (state.status === "unavailable") return state;
    return Object.freeze({
      status: "idle",
      error: String((action && action.message) || "Reading stopped before it finished."),
    });
  }
  if (type === "failure") {
    // A refused pause/resume must not advance the state: the engine never
    // reached the state the UI would otherwise claim. Keep it and show why.
    if (state.status === "unavailable") return state;
    return Object.freeze({
      status: state.status,
      error: String((action && action.message) || "The browser did not accept the request."),
    });
  }
  return state;
}
