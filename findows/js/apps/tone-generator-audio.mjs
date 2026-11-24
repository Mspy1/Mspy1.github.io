/* Pure Tone Generator reasoning: parsing, formatting, state transitions and
   capability detection. No DOM, no AudioContext and no timers live in here. */

export const WAVEFORMS = Object.freeze([
  Object.freeze({ id: "sine", label: "Sine" }),
  Object.freeze({ id: "triangle", label: "Triangle" }),
  Object.freeze({ id: "square", label: "Square" }),
  Object.freeze({ id: "sawtooth", label: "Sawtooth" }),
]);

export const FREQUENCY_PRESETS = Object.freeze([
  Object.freeze({ label: "A2", value: 110 }),
  Object.freeze({ label: "A3", value: 220 }),
  Object.freeze({ label: "A4", value: 440 }),
  Object.freeze({ label: "A5", value: 880 }),
]);

export const MIN_FREQUENCY = 20;
export const MAX_FREQUENCY = 20_000;
export const DEFAULT_FREQUENCY = 440;
export const MIN_VOLUME = 0;
export const MAX_VOLUME = 100;
export const DEFAULT_VOLUME = 35;
export const DEFAULT_WAVEFORM = "sine";
/* Keep the output gentle: a full UI volume is still only a quarter of unity. */
export const MAX_GAIN = 0.25;

function toNumber(input) {
  if (typeof input === "number") return input;
  if (typeof input !== "string" || !input.trim()) return NaN;
  return Number(input.trim());
}

export function parseFrequency(input) {
  const value = toNumber(input);
  if (!Number.isFinite(value) || value < MIN_FREQUENCY || value > MAX_FREQUENCY) {
    return { ok: false, message: `Frequency must be a number between ${MIN_FREQUENCY} and ${MAX_FREQUENCY} Hz.` };
  }
  return { ok: true, value };
}

export function parseVolume(input) {
  const value = toNumber(input);
  if (!Number.isInteger(value) || value < MIN_VOLUME || value > MAX_VOLUME) {
    return { ok: false, message: `Volume must be a whole number between ${MIN_VOLUME} and ${MAX_VOLUME}%.` };
  }
  return { ok: true, value };
}

export function gainForVolume(percent) {
  const parsed = parseVolume(percent);
  if (!parsed.ok) throw new RangeError(parsed.message);
  return MAX_GAIN * (parsed.value / MAX_VOLUME);
}

function trimNumber(value) {
  return String(Math.round(value * 10) / 10);
}

export function formatFrequency(hertz) {
  const parsed = parseFrequency(hertz);
  if (!parsed.ok) throw new RangeError(parsed.message);
  return parsed.value >= 1000 ? `${trimNumber(parsed.value / 1000)} kHz` : `${trimNumber(parsed.value)} Hz`;
}

export function formatVolume(percent) {
  const parsed = parseVolume(percent);
  if (!parsed.ok) throw new RangeError(parsed.message);
  return `${parsed.value}%`;
}

export function isWaveform(id) {
  return WAVEFORMS.some((wave) => wave.id === id);
}

/** Truthful wording when the audio engine refuses a gesture, for example a
    rejected AudioContext.resume(). Never announce success after this. */
export function audioFailureMessage(action, cause) {
  const prefix = action === "start"
    ? "Audio could not start."
    : action === "suspend"
      ? "Audio could not be suspended."
      : "Audio could not be controlled.";
  const detail = typeof cause === "string"
    ? cause
    : (cause && cause.message ? String(cause.message) : "");
  return detail ? `${prefix} ${detail}` : `${prefix} The browser did not accept the request.`;
}

export function createToneState() {
  return { frequency: DEFAULT_FREQUENCY, waveform: DEFAULT_WAVEFORM, volume: DEFAULT_VOLUME, playing: false };
}

export function reduceTone(state, action, payload) {
  switch (action) {
    case "start":
      return { ...state, playing: true };
    case "stop":
      return { ...state, playing: false };
    case "frequency": {
      const parsed = parseFrequency(payload);
      if (!parsed.ok) throw new RangeError(parsed.message);
      return { ...state, frequency: parsed.value };
    }
    case "volume": {
      const parsed = parseVolume(payload);
      if (!parsed.ok) throw new RangeError(parsed.message);
      return { ...state, volume: parsed.value };
    }
    case "waveform":
      if (!isWaveform(payload)) throw new RangeError("Unknown waveform.");
      return { ...state, waveform: payload };
    default:
      throw new RangeError(`Unknown tone action: ${String(action)}`);
  }
}

export function toneSummary(state) {
  const wave = WAVEFORMS.find((item) => item.id === state.waveform);
  return `${wave ? wave.label : "Tone"} wave at ${formatFrequency(state.frequency)}, ${formatVolume(state.volume)} volume`;
}

export function webAudioSupport(globalObject = globalThis) {
  if (typeof globalObject?.AudioContext === "function" ||
      typeof globalObject?.webkitAudioContext === "function") {
    return { supported: true, reason: "" };
  }
  return { supported: false, reason: "Web Audio is not available in this browser. No sound will play." };
}
