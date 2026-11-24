/* Read Aloud: speaks typed or pasted text with the browser's own speech
   synthesis engine. Every decision (bounds, text cleanup, local voices,
   capability, state) lives in read-aloud-logic.mjs; this module only owns
   side effects: one utterance at a time, scoped listeners and clearable
   timers. No network requests, no injected markup, no global listeners. */
import {
  clampPitch,
  clampRate,
  clampVolume,
  controlFailureMessage,
  createSpeechState,
  describeSupport,
  localVoices,
  prepareText,
  reduceSpeech,
  voiceKey,
  voiceLabel,
} from "./read-aloud-logic.mjs";

const STATUS_LABELS = Object.freeze({
  idle: "Ready to read",
  speaking: "Reading aloud",
  paused: "Paused",
  unavailable: "Unavailable",
});

let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label, action, className) {
  const node = el("button", `ra-button ${className}`, label);
  node.type = "button";
  node.dataset.action = action;
  return node;
}

export async function mount({ container, windowId, services = {}, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Read Aloud needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Read Aloud window was closed while loading", "AbortError");
  }
  void services; // the app needs no shell services; the standard contract is kept.

  const uid = `ra-${++instanceCount}`;
  const synth = globalThis.speechSynthesis || null;
  const Utterance = globalThis.SpeechSynthesisUtterance || null;
  const support = describeSupport({ speechSynthesis: synth, SpeechSynthesisUtterance: Utterance });

  let disposed = false;
  let current = null;
  let state = support.available
    ? createSpeechState()
    : reduceSpeech(createSpeechState(), { type: "unavailable" });
  const timers = new Set();
  const voicesByKey = new Map();

  const root = el("section", "ra-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Read Aloud");

  const head = el("header", "ra-head");
  const badge = el("span", "ra-badge");
  badge.setAttribute("aria-hidden", "true");
  badge.append(el("span", "ra-badge-core"));
  const heading = el("h1", "ra-title", "Read Aloud");
  heading.id = `${uid}-title`;
  const subtitle = el("p", "ra-subtitle", "Listen to your words on this device. Nothing is sent anywhere.");
  head.append(badge, el("div", "ra-heading", heading, subtitle));

  const bodyWrap = el("div", "ra-body");
  const textField = el("label", "ra-field ra-text-field");
  textField.append(el("span", "ra-label", "Text to read"));
  const textarea = el("textarea", "ra-text");
  textarea.rows = 7;
  textarea.setAttribute("aria-label", "Text to read");
  textarea.setAttribute("aria-describedby", `${uid}-hint`);
  textarea.setAttribute("dir", "auto");
  textarea.setAttribute("autocapitalize", "off");
  textarea.spellcheck = false;
  textField.append(textarea);
  const hint = el("p", "ra-hint", "Type or paste text, then press Play. Ctrl+Enter plays; Escape stops.");
  hint.id = `${uid}-hint`;

  const transport = el("div", "ra-transport");
  transport.setAttribute("role", "group");
  transport.setAttribute("aria-label", "Playback controls");
  const play = button("Play", "play", "ra-play");
  const stop = button("Stop", "stop", "ra-stop");
  const refresh = button("Refresh voices", "refresh", "ra-refresh");
  transport.append(play, stop, refresh);

  const settings = el("div", "ra-settings");
  settings.setAttribute("role", "group");
  settings.setAttribute("aria-label", "Voice and speed");

  const voiceField = el("label", "ra-field");
  voiceField.append(el("span", "ra-label", "Voice"));
  const voice = el("select", "ra-voice");
  voice.setAttribute("aria-label", "Voice");
  voice.append(el("option", "", voiceLabel(null)));
  voice.firstChild.value = "";
  voiceField.append(voice);

  const rateField = el("label", "ra-field");
  const rateRow = el("span", "ra-label-row");
  rateRow.append(el("span", "ra-label", "Speed"));
  const rateValue = el("output", "ra-rate-value", "1.0×");
  rateRow.append(rateValue);
  const rate = el("input", "ra-range ra-rate");
  rate.type = "range";
  rate.min = "0.1";
  rate.max = "2";
  rate.step = "0.1";
  rate.value = "1";
  rate.setAttribute("aria-label", "Speaking speed");
  rateField.append(rateRow, rate);

  const pitchField = el("label", "ra-field");
  const pitchRow = el("span", "ra-label-row");
  pitchRow.append(el("span", "ra-label", "Pitch"));
  const pitchValue = el("output", "ra-pitch-value", "1.0");
  pitchRow.append(pitchValue);
  const pitch = el("input", "ra-range ra-pitch");
  pitch.type = "range";
  pitch.min = "0";
  pitch.max = "2";
  pitch.step = "0.1";
  pitch.value = "1";
  pitch.setAttribute("aria-label", "Speaking pitch");
  pitchField.append(pitchRow, pitch);
  settings.append(voiceField, rateField, pitchField);

  const supportNote = el("p", "ra-support", support.available
    ? "Speech runs locally in this browser. Your text never leaves the device."
    : `${support.reason} You can still select and copy your text.`);
  const errorBox = el("p", "ra-error");
  errorBox.setAttribute("role", "alert");
  errorBox.hidden = true;

  const foot = el("footer", "ra-foot");
  const statusLine = el("span", "ra-status", STATUS_LABELS[state.status]);
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");
  const count = el("span", "ra-count", "0 characters");
  foot.append(statusLine, count);

  const srStatus = el("div", "ra-sr");
  srStatus.setAttribute("role", "status");
  srStatus.setAttribute("aria-live", "polite");
  srStatus.setAttribute("aria-atomic", "true");

  bodyWrap.append(textField, hint, transport, settings, supportNote, errorBox);
  root.append(head, bodyWrap, foot, srStatus);
  container.replaceChildren(root);

  /* ---------- helpers ---------- */

  const announce = (message) => { srStatus.textContent = message || ""; };

  const schedule = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) fn();
    }, ms);
    timers.add(timer);
    return timer;
  };

  function render() {
    if (disposed) return;
    statusLine.textContent = state.error || STATUS_LABELS[state.status] || "Ready to read";
    play.textContent = state.status === "speaking" ? "Pause" : state.status === "paused" ? "Resume" : "Play";
    play.setAttribute("aria-pressed", String(state.status === "speaking"));
    errorBox.textContent = state.error || "";
    errorBox.hidden = !state.error;
    const length = textarea.value.length;
    count.textContent = `${length} character${length === 1 ? "" : "s"}`;
    const locked = !support.available;
    for (const control of [play, stop, refresh, voice, rate, pitch]) control.disabled = locked;
  }

  function dispatch(action) {
    state = reduceSpeech(state, action);
    render();
  }

  function refreshVoices() {
    if (disposed || !support.available) return;
    let list = [];
    try { list = localVoices(synth.getVoices?.() || []); } catch { list = []; }
    voicesByKey.clear();
    const previous = voice.value;
    voice.replaceChildren();
    const defaultOption = el("option", "", voiceLabel(null));
    defaultOption.value = "";
    voice.append(defaultOption);
    for (const item of list) {
      const key = voiceKey(item);
      const option = el("option", "", voiceLabel(item));
      option.value = key;
      voice.append(option);
      voicesByKey.set(key, item);
    }
    voice.value = [...voice.options].some((option) => option.value === previous) ? previous : "";
  }

  function detachCurrent() {
    if (!current) return;
    current.onend = null;
    current.onerror = null;
    current = null;
  }

  /** One engine call, one truthful outcome. Missing methods, thrown errors and
     rejected promises all land in the same rejection path; no state is claimed
     until the engine has actually accepted the request. */
  async function engineCall(name, args = []) {
    const fn = synth && synth[name];
    if (typeof fn !== "function") {
      const action = name === "pause" ? "pausing" : name === "resume" ? "resuming" : "speaking";
      throw new Error(`${action} is not supported in this browser`);
    }
    const outcome = fn.apply(synth, args);
    if (outcome && typeof outcome.then === "function") await outcome;
  }

  function speak() {
    if (disposed || !support.available) return;
    const text = prepareText(textarea.value);
    if (!text) {
      dispatch({ type: "error", message: "Type or paste text to read first." });
      textarea.focus({ preventScroll: true });
      return;
    }
    detachCurrent();
    try { synth.cancel(); } catch { /* a failed cancel must not block speaking */ }

    let utterance;
    try {
      utterance = new Utterance(text);
    } catch {
      dispatch({ type: "error", message: "This browser could not start speech playback." });
      return;
    }
    const selected = voicesByKey.get(voice.value) || null;
    if (selected) utterance.voice = selected;
    utterance.rate = clampRate(rate.value);
    utterance.pitch = clampPitch(pitch.value);
    utterance.volume = clampVolume(1);
    utterance.onend = () => {
      if (disposed || current !== utterance) return;
      detachCurrent();
      dispatch({ type: "end" });
      announce("Finished reading.");
    };
    utterance.onerror = () => {
      if (disposed || current !== utterance) return;
      detachCurrent();
      dispatch({ type: "error", message: "Reading stopped before it finished." });
      announce("Reading stopped.");
    };
    current = utterance;
    try {
      synth.speak(utterance);
    } catch {
      detachCurrent();
      const message = "This browser refused to speak the text.";
      dispatch({ type: "error", message });
      announce(message);
      return;
    }
    if (disposed || current !== utterance) return;
    dispatch({ type: "play", text });
    announce("Reading aloud.");
  }

  function control(kind) {
    engineCall(kind).then(
      () => {
        if (disposed) return;
        dispatch({ type: kind });
        announce(kind === "pause" ? "Reading paused." : "Resuming reading.");
      },
      (caught) => {
        if (disposed) return;
        const message = controlFailureMessage(kind, caught);
        dispatch({ type: "failure", message });
        announce(message);
      },
    );
  }

  function toggle() {
    if (!support.available || disposed) return;
    if (state.status === "paused") {
      control("resume");
      return;
    }
    if (state.status === "speaking") {
      control("pause");
      return;
    }
    speak();
  }

  function stopSpeech() {
    if (!support.available || disposed) return;
    detachCurrent();
    try { synth.cancel(); } catch { /* stopping stays usable */ }
    dispatch({ type: "stop" });
    announce("Reading stopped.");
  }

  /* ---------- scoped listeners ---------- */

  play.addEventListener("click", () => toggle());
  stop.addEventListener("click", () => stopSpeech());
  refresh.addEventListener("click", () => {
    refreshVoices();
    announce("Voice list refreshed.");
  });
  textarea.addEventListener("input", () => {
    if (state.status === "speaking" || state.status === "paused") stopSpeech();
    else render();
  });
  voice.addEventListener("focus", refreshVoices);
  rate.addEventListener("input", () => {
    rateValue.textContent = `${Number(rate.value).toFixed(1)}×`;
  });
  pitch.addEventListener("input", () => {
    pitchValue.textContent = Number(pitch.value).toFixed(1);
  });
  root.addEventListener("keydown", (event) => {
    if (disposed || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const key = String(event.key || "").toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "enter") {
      event.preventDefault();
      toggle();
      return;
    }
    if (event.key === "Escape" && (state.status === "speaking" || state.status === "paused")) {
      event.preventDefault();
      stopSpeech();
    }
  });

  /* ---------- lifetime ---------- */

  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  refreshVoices();
  // Voices can load after mount; this bounded refresh avoids a global
  // voiceschanged listener and is always cleared on dispose.
  schedule(refreshVoices, 500);
  render();

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    detachCurrent();
    if (support.available) {
      try { synth.cancel(); } catch { /* window is going away */ }
    }
    root.remove();
  }

  return {
    canClose: () => true,
    focus: () => {
      try { textarea.focus({ preventScroll: true }); } catch { textarea.focus(); }
    },
    dispose,
  };
}

export default { mount };
