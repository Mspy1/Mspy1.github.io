/* Tone Generator: a small Web Audio oscillator. Nothing is created, resumed or
   started until the user presses Start; all sound stops on Stop or dispose. */
import {
  audioFailureMessage,
  FREQUENCY_PRESETS,
  WAVEFORMS,
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
} from "./tone-generator-audio.mjs";

let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className, label, dataset = {}) {
  const node = el("button", className, label);
  node.type = "button";
  for (const [key, value] of Object.entries(dataset)) node.dataset[key] = value;
  return node;
}

export async function mount({ container, windowId, fileId, mode, draftId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Tone Generator needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Tone Generator window was closed while loading", "AbortError");
  }

  /* The shell may inject a factory; otherwise use the browser's own Web Audio. */
  const injectedFactory = typeof services?.createAudioContext === "function" ? services.createAudioContext : null;
  const capability = webAudioSupport(globalThis);
  const supported = Boolean(injectedFactory) || capability.supported;
  const factory = injectedFactory || (capability.supported
    ? () => new (globalThis.AudioContext || globalThis.webkitAudioContext)()
    : null);

  const uid = `tone-${++instanceCount}`;
  let state = createToneState();
  let disposed = false;
  let context = null;
  let voice = null;
  let starting = false; // blocks a second gesture while resume() is pending

  const root = el("div", "tone-app");
  root.dataset.windowId = windowId || "";
  root.dataset.support = supported ? "supported" : "unavailable";
  root.dataset.playing = "false";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Tone Generator");

  const header = el("header", "tone-header");
  const heading = el("h1", "tone-title", "Tone Generator");
  heading.tabIndex = -1;
  heading.id = `${uid}-title`;
  const subtitle = el("p", "tone-subtitle", "A tone you control. Sound starts only when you press Start.");
  const badge = el("span", "tone-badge", supported ? "Ready" : "Unavailable");
  badge.dataset.state = supported ? "ready" : "unavailable";
  badge.setAttribute("role", "status");
  badge.setAttribute("aria-live", "polite");
  header.append(heading, subtitle, badge);

  const visual = el("div", "tone-visual");
  visual.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 9; index += 1) visual.append(el("span", "tone-bar"));

  const readout = el("div", "tone-readout");
  readout.setAttribute("role", "group");
  readout.setAttribute("aria-label", "Current tone");
  const readoutValue = el("output", "tone-readout-value", formatFrequency(state.frequency));
  const readoutLabel = el("span", "tone-readout-label");
  readoutLabel.textContent = `${WAVEFORMS[0].label} · ${formatVolume(state.volume)}`;
  readout.append(readoutValue, readoutLabel);

  const frequencyPanel = el("section", "tone-panel tone-panel-frequency");
  frequencyPanel.setAttribute("aria-label", "Frequency");
  frequencyPanel.append(el("h2", "tone-section-title", "Frequency"));
  const frequencyRow = el("div", "tone-frequency-row");
  const frequencyField = el("label", "tone-field");
  frequencyField.append(el("span", "tone-field-label", "Hertz"));
  const frequencyInput = el("input", "tone-frequency-input");
  frequencyInput.type = "number";
  frequencyInput.inputMode = "numeric";
  frequencyInput.min = "20";
  frequencyInput.max = "20000";
  frequencyInput.step = "1";
  frequencyInput.value = String(state.frequency);
  frequencyInput.setAttribute("aria-describedby", `${uid}-validation`);
  frequencyField.append(frequencyInput);
  const presets = el("div", "tone-presets");
  presets.setAttribute("role", "group");
  presets.setAttribute("aria-label", "Quick pitches");
  for (const preset of FREQUENCY_PRESETS) {
    const item = button("tone-preset", "", { frequency: String(preset.value) });
    item.append(el("span", "tone-preset-note", preset.label));
    item.append(el("span", "tone-preset-hz", `${preset.value} Hz`));
    presets.append(item);
  }
  frequencyRow.append(frequencyField, presets);
  const validation = el("p", "tone-validation");
  validation.id = `${uid}-validation`;
  validation.setAttribute("role", "alert");
  validation.hidden = true;
  frequencyPanel.append(frequencyRow, validation);

  const wavePanel = el("section", "tone-panel tone-panel-wave");
  wavePanel.setAttribute("aria-label", "Waveform");
  wavePanel.append(el("h2", "tone-section-title", "Waveform"));
  const waves = el("div", "tone-waves");
  waves.setAttribute("role", "group");
  waves.setAttribute("aria-label", "Waveform shape");
  const waveButtons = new Map();
  for (const wave of WAVEFORMS) {
    const item = button("tone-wave", wave.label, { wave: wave.id });
    item.setAttribute("aria-pressed", "false");
    waveButtons.set(wave.id, item);
    waves.append(item);
  }
  wavePanel.append(waves);

  const volumePanel = el("section", "tone-panel tone-panel-volume");
  volumePanel.setAttribute("aria-label", "Volume");
  volumePanel.append(el("h2", "tone-section-title", "Volume"));
  const volumeField = el("label", "tone-volume-field");
  volumeField.append(el("span", "tone-field-label", "Level"));
  const volumeRange = el("input", "tone-volume-range");
  volumeRange.type = "range";
  volumeRange.min = "0";
  volumeRange.max = "100";
  volumeRange.step = "1";
  volumeRange.value = String(state.volume);
  const volumeValue = el("output", "tone-volume-value", formatVolume(state.volume));
  volumeField.append(volumeRange, volumeValue);
  volumePanel.append(volumeField);

  const actions = el("div", "tone-actions");
  const startButton = button("tone-start", "Start tone");
  const stopButton = button("tone-stop", "Stop tone");
  actions.append(startButton, stopButton);

  const note = el("p", "tone-note", "The tone plays only while it is on. Lower the volume before you start if you are wearing headphones.");
  const unavailable = el("p", "tone-unavailable", supported ? "" : capability.reason);
  unavailable.setAttribute("role", "status");
  unavailable.hidden = supported;
  const error = el("p", "tone-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const status = el("p", "tone-sr-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  root.append(header, visual, readout, frequencyPanel, wavePanel, volumePanel, actions, note, unavailable, error, status);
  container.replaceChildren(root);

  function announce(message) {
    status.textContent = message;
  }

  function time() {
    return context && Number.isFinite(context.currentTime) ? context.currentTime : 0;
  }

  function showValidation(message) {
    validation.textContent = message;
    validation.hidden = false;
    frequencyInput.setAttribute("aria-invalid", "true");
  }

  function clearValidation() {
    validation.textContent = "";
    validation.hidden = true;
    frequencyInput.removeAttribute("aria-invalid");
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
    announce(message);
  }

  function render() {
    const wave = WAVEFORMS.find((item) => item.id === state.waveform) || WAVEFORMS[0];
    const badgeState = !supported ? "unavailable" : state.playing ? "playing" : "ready";
    badge.textContent = badgeState === "unavailable" ? "Unavailable" : badgeState === "playing" ? "Playing" : "Ready";
    badge.dataset.state = badgeState;
    readoutValue.textContent = formatFrequency(state.frequency);
    readoutLabel.textContent = `${wave.label} · ${formatVolume(state.volume)}`;
    volumeValue.textContent = formatVolume(state.volume);
    root.dataset.playing = String(state.playing);
    startButton.disabled = !supported || state.playing || starting;
    stopButton.disabled = !supported || !state.playing;
    for (const [id, item] of waveButtons) item.setAttribute("aria-pressed", String(id === state.waveform));
  }

  function applyFrequencyToVoice() {
    if (!voice) return;
    const param = voice.oscillator.frequency;
    if (param && typeof param.setValueAtTime === "function") param.setValueAtTime(state.frequency, time());
    else if (param) param.value = state.frequency;
  }

  function setFrequency(raw) {
    const parsed = parseFrequency(raw);
    if (!parsed.ok) {
      showValidation(parsed.message);
      return false;
    }
    clearValidation();
    state = reduceTone(state, "frequency", parsed.value);
    applyFrequencyToVoice();
    render();
    announce(`${toneSummary(state)}.${state.playing ? " Tone retuned." : ""}`);
    return true;
  }

  function setWaveform(id) {
    if (!isWaveform(id)) return;
    state = reduceTone(state, "waveform", id);
    if (voice) voice.oscillator.type = state.waveform;
    render();
    announce(`${toneSummary(state)}.${state.playing ? " Waveform changed." : ""}`);
  }

  function setVolume(raw) {
    const parsed = parseVolume(raw);
    if (!parsed.ok) return;
    state = reduceTone(state, "volume", parsed.value);
    if (voice) {
      const gainParam = voice.gain.gain;
      const level = gainForVolume(state.volume);
      if (gainParam && typeof gainParam.setValueAtTime === "function") gainParam.setValueAtTime(level, time());
      else if (gainParam) gainParam.value = level;
    }
    render();
    announce(`${toneSummary(state)}.${state.playing ? " Volume changed." : ""}`);
  }

  function ensureContext() {
    if (context && context.state !== "closed") return context;
    if (!factory) throw new Error("Web Audio is not available in this browser.");
    context = factory();
    if (!context || typeof context.createOscillator !== "function" || typeof context.createGain !== "function") {
      throw new Error("The audio context could not be created.");
    }
    return context;
  }

  function teardown(closeContext) {
    const current = voice;
    voice = null;
    if (current) {
      try {
        const gainParam = current.gain.gain;
        if (gainParam && typeof gainParam.setValueAtTime === "function") gainParam.setValueAtTime(0, time());
        else if (gainParam) gainParam.value = 0;
      } catch { /* the context may already be gone */ }
      try { current.oscillator.stop(time()); } catch { /* already stopped */ }
      try { current.oscillator.disconnect(); } catch { /* already disconnected */ }
      try { current.gain.disconnect(); } catch { /* already disconnected */ }
    }
    if (context) {
      if (context.state !== "closed" && typeof context.suspend === "function") {
        try { context.suspend()?.catch?.(() => {}); } catch { /* nothing to suspend */ }
      }
      if (closeContext && context.state !== "closed" && typeof context.close === "function") {
        try { context.close()?.catch?.(() => {}); } catch { /* already closed */ }
      }
    }
  }

  async function startTone() {
    if (disposed || !supported || state.playing || starting) return;
    starting = true;
    render();
    let ctx;
    try {
      ctx = ensureContext();
    } catch (caught) {
      starting = false;
      showError(audioFailureMessage("start", caught));
      render();
      return;
    }
    try {
      error.hidden = true;
      error.textContent = "";
      /* The context must really resume before a tone can be heard. A missing
         or rejected resume() is a failure, never a "Playing" announcement. */
      if (ctx.state === "suspended") {
        if (typeof ctx.resume !== "function") {
          throw new Error("resuming is not supported in this browser");
        }
        await ctx.resume();
      }
      if (disposed) return;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = state.waveform;
      const frequencyParam = oscillator.frequency;
      if (frequencyParam && typeof frequencyParam.setValueAtTime === "function") frequencyParam.setValueAtTime(state.frequency, time());
      else if (frequencyParam) frequencyParam.value = state.frequency;
      const gainParam = gain.gain;
      const level = gainForVolume(state.volume);
      if (gainParam && typeof gainParam.setValueAtTime === "function") gainParam.setValueAtTime(level, time());
      else if (gainParam) gainParam.value = level;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(time());
      voice = { oscillator, gain };
      state = reduceTone(state, "start");
    } catch (caught) {
      try { voice?.oscillator.stop(time()); } catch { /* not started */ }
      voice = null;
      /* Do not leave a context created for a failed gesture running. */
      try {
        if (context && context.state !== "closed" && typeof context.close === "function") {
          context.close()?.catch?.(() => {});
        }
      } catch { /* already gone */ }
      context = null;
      showError(audioFailureMessage("start", caught));
      return;
    } finally {
      starting = false;
      render();
    }
    announce(`${toneSummary(state)}. Tone started.`);
  }

  function stopTone() {
    if (disposed || !state.playing) return;
    teardown(false);
    state = reduceTone(state, "stop");
    render();
    announce("Tone stopped. No sound is playing.");
  }

  for (const preset of presets.querySelectorAll("[data-frequency]")) {
    preset.addEventListener("click", () => {
      if (setFrequency(preset.dataset.frequency)) frequencyInput.value = String(state.frequency);
    });
  }
  for (const [id, item] of waveButtons) item.addEventListener("click", () => setWaveform(id));
  frequencyInput.addEventListener("input", () => setFrequency(frequencyInput.value));
  volumeRange.addEventListener("input", () => setVolume(volumeRange.value));
  startButton.addEventListener("click", startTone);
  stopButton.addEventListener("click", stopTone);

  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  render();
  if (!supported) announce("Web Audio is not available. No sound will play.");

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    teardown(true);
    if (state.playing) state = reduceTone(state, "stop");
    render();
    root.remove();
  }

  return {
    canClose: () => true,
    focus() {
      const target = startButton.disabled ? heading : startButton;
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    },
    dispose,
  };
}

export default { mount };
