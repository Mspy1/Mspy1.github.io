/* Clock app: local time, lap stopwatch and countdown. All elapsed values come
   from timestamps through clock-timing.mjs; interval ticks only repaint. */
import {
  createCountdownState,
  countdownComplete,
  countdownRemainingMs,
  countdownRunning,
  formatCountdown,
  formatStopwatch,
  localISODate,
  parseDuration,
  reduceCountdown,
  reduceStopwatch,
  stopwatchElapsedMs,
  stopwatchRunning,
  createStopwatchState,
} from "./clock-timing.mjs";

const MODES = new Set(["clock", "stopwatch", "countdown"]);
let instanceCount = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(className, label, dataset = {}) {
  const node = el("button", `clock-btn ${className}`, label);
  node.type = "button";
  for (const [key, value] of Object.entries(dataset)) node.dataset[key] = value;
  return node;
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
});

export async function mount({ container, windowId, fileId, mode, draftId, services, signal } = {}) {
  if (!container || typeof container.replaceChildren !== "function") {
    throw new TypeError("Clock needs a DOM container");
  }
  if (signal?.aborted) {
    throw new DOMException("Clock window was closed while loading", "AbortError");
  }

  const uid = `clock-${++instanceCount}`;
  let activeMode = MODES.has(mode) ? mode : "clock";
  let disposed = false;
  let wallTimer = null;
  let tickTimer = null;

  let stopwatch = createStopwatchState();
  let countdown = createCountdownState(60_000);

  const root = el("div", "clock-app");
  root.dataset.windowId = windowId || "";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Clock");

  const switcher = el("div", "clock-switch");
  switcher.setAttribute("role", "group");
  switcher.setAttribute("aria-label", "Clock modes");
  const tabs = new Map();
  for (const [value, label] of [["clock", "Time"], ["stopwatch", "Stopwatch"], ["countdown", "Countdown"]]) {
    const tab = button("clock-tab", label, { mode: value });
    tab.classList.remove("clock-btn");
    tab.setAttribute("aria-pressed", "false");
    tabs.set(value, tab);
    switcher.append(tab);
  }

  const panels = new Map();
  function panel(name, title) {
    const section = el("section", `clock-panel clock-panel-${name}`);
    section.dataset.panel = name;
    section.setAttribute("aria-label", `${title} panel`);
    const heading = el("h1", "clock-panel-title", title);
    heading.tabIndex = -1;
    heading.id = `${uid}-${name}-title`;
    section.append(heading);
    panels.set(name, section);
    return section;
  }

  /* Local time panel */
  const clockPanel = panel("clock", "Local time");
  const timeValue = el("time", "clock-current-time");
  timeValue.setAttribute("aria-label", "Local time");
  const dateValue = el("time", "clock-current-date");
  dateValue.setAttribute("aria-label", "Local date");
  const zone = el("p", "clock-zone");
  const zoneName = Intl.DateTimeFormat().resolvedOptions?.().timeZone || "this device";
  zone.textContent = `Local time · ${zoneName}`;
  const clockNote = el("p", "clock-note", "This clock follows your device. It does not contact a time service.");
  clockPanel.append(timeValue, dateValue, zone, clockNote);

  /* Stopwatch panel */
  const stopwatchPanel = panel("stopwatch", "Stopwatch");
  const swDisplay = el("output", "clock-stopwatch-display", "00:00.00");
  swDisplay.setAttribute("role", "timer");
  swDisplay.setAttribute("aria-label", "Stopwatch elapsed time");
  const swControls = el("div", "clock-controls");
  const swStart = button("clock-start", "Start");
  const swLap = button("clock-lap-button", "Lap", { action: "lap" });
  const swReset = button("clock-reset", "Reset", { action: "reset" });
  swControls.append(swStart, swLap, swReset);
  const swLapsLabel = el("h2", "clock-subtitle", "Laps");
  const lapsList = el("ol", "clock-laps");
  lapsList.setAttribute("aria-label", "Lap times, newest first");
  const emptyLap = el("li", "clock-lap-empty", "No laps yet.");
  lapsList.append(emptyLap);
  stopwatchPanel.append(swDisplay, swControls, swLapsLabel, lapsList);

  /* Countdown panel */
  const countdownPanel = panel("countdown", "Countdown");
  const inputs = el("div", "clock-inputs");
  inputs.setAttribute("role", "group");
  inputs.setAttribute("aria-label", "Countdown duration");
  const cdInputs = new Map();
  for (const [unit, label, max] of [["hours", "Hours", "23"], ["minutes", "Minutes", "59"], ["seconds", "Seconds", "59"]]) {
    const field = el("label", "clock-field");
    field.append(el("span", "clock-field-label", label));
    const input = el("input", "clock-input");
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "0";
    input.max = max;
    input.step = "1";
    input.value = "0";
    input.dataset.unit = unit;
    input.setAttribute("aria-describedby", `${uid}-countdown-help`);
    field.append(input);
    inputs.append(field);
    cdInputs.set(unit, input);
  }
  const presets = el("div", "clock-presets");
  presets.setAttribute("role", "group");
  presets.setAttribute("aria-label", "Quick durations");
  for (const [seconds, label] of [[60, "1 min"], [300, "5 min"], [600, "10 min"]]) {
    const preset = button("clock-preset", label, { seconds: String(seconds) });
    preset.classList.remove("clock-btn");
    presets.append(preset);
  }
  const validation = el("p", "clock-validation");
  validation.setAttribute("role", "alert");
  validation.hidden = true;
  validation.id = `${uid}-validation-help`;
  const cdDisplay = el("output", "clock-countdown-display", "00:00");
  cdDisplay.setAttribute("role", "timer");
  cdDisplay.setAttribute("aria-label", "Time remaining");
  const cdControls = el("div", "clock-controls");
  const cdStart = button("clock-start", "Start");
  const cdReset = button("clock-reset", "Reset", { action: "reset" });
  cdControls.append(cdStart, cdReset);
  const finished = el("p", "clock-finished", "Time's up.");
  finished.setAttribute("role", "alert");
  finished.hidden = true;
  const cdHelp = el("p", "clock-help", "Enter a time up to 23:59:59, or choose a preset.");
  cdHelp.id = `${uid}-countdown-help`;
  const cdNote = el("p", "clock-note", "Findows cannot alert you in the background. Keep this window open to see the finish.");
  countdownPanel.append(inputs, presets, validation, cdDisplay, cdControls, finished, cdHelp, cdNote);

  const status = el("p", "clock-sr-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");

  root.append(switcher, clockPanel, stopwatchPanel, countdownPanel, status);
  container.replaceChildren(root);

  function announce(message) {
    status.textContent = message;
  }

  function setMode(next) {
    if (!MODES.has(next)) return;
    activeMode = next;
    for (const [value, tab] of tabs) {
      tab.setAttribute("aria-pressed", String(value === next));
      tab.classList.toggle("is-active", value === next);
    }
    for (const [value, section] of panels) section.hidden = value !== next;
  }

  function renderWallClock() {
    const date = new Date();
    const timeText = timeFormatter.format(date);
    const dateText = dateFormatter.format(date);
    timeValue.textContent = timeText;
    timeValue.dateTime = date.toISOString();
    timeValue.setAttribute("aria-label", `Local time ${timeText}`);
    dateValue.textContent = dateText;
    dateValue.dateTime = localISODate(date);
    dateValue.setAttribute("aria-label", `Local date ${dateText}`);
  }

  function renderLaps() {
    lapsList.replaceChildren();
    if (!stopwatch.laps.length) {
      lapsList.append(emptyLap);
      return;
    }
    for (const [index, lap] of stopwatch.laps.entries()) {
      const item = el("li", "clock-lap");
      item.append(el("span", "clock-lap-number", `#${stopwatch.laps.length - index}`));
      item.append(el("span", "clock-lap-time", formatStopwatch(lap.lapMs)));
      item.append(el("span", "clock-lap-total", formatStopwatch(lap.totalMs)));
      lapsList.append(item);
    }
  }

  function renderStopwatch(time = performance.now()) {
    swDisplay.textContent = formatStopwatch(stopwatchElapsedMs(stopwatch, time));
    const running = stopwatchRunning(stopwatch);
    swStart.textContent = running ? "Pause" : "Start";
    swLap.disabled = !running;
  }

  function clearFinished() {
    finished.hidden = true;
    finished.classList.remove("is-complete");
  }

  function readInputs() {
    return parseDuration({
      hours: cdInputs.get("hours").value,
      minutes: cdInputs.get("minutes").value,
      seconds: cdInputs.get("seconds").value,
    });
  }

  function showValidation(result) {
    validation.hidden = result.ok;
    validation.textContent = result.ok ? "" : result.message;
    for (const input of cdInputs.values()) input.removeAttribute("aria-invalid");
    if (!result.ok && result.field) {
      cdInputs.get(result.field)?.setAttribute("aria-invalid", "true");
    }
    return result.ok;
  }

  function renderCountdown(time = performance.now()) {
    if (countdownRunning(countdown) && countdownComplete(countdown, time)) {
      countdown = reduceCountdown(countdown, "complete", time);
      finished.hidden = false;
      finished.classList.add("is-complete");
      announce("Countdown finished.");
    }
    const running = countdownRunning(countdown);
    const paused = !running && countdown.accumulatedMs > 0 && !countdown.completed;
    const idle = !running && !paused && !countdown.completed;
    cdDisplay.textContent = idle || countdown.completed
      ? "00:00"
      : formatCountdown(countdownRemainingMs(countdown, time));
    cdStart.textContent = running ? "Pause" : paused ? "Resume" : "Start";
    const locked = running || paused || countdown.completed;
    for (const input of cdInputs.values()) input.disabled = locked;
  }

  function syncTick() {
    const needed = stopwatchRunning(stopwatch) || countdownRunning(countdown);
    if (needed && tickTimer === null) {
      tickTimer = window.setInterval(tick, 50);
    } else if (!needed && tickTimer !== null) {
      window.clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function tick() {
    const time = performance.now();
    if (stopwatchRunning(stopwatch)) renderStopwatch(time);
    if (countdownRunning(countdown)) renderCountdown(time);
    syncTick();
  }

  function stopwatchAction(action) {
    const wasRunning = stopwatchRunning(stopwatch);
    const time = performance.now();
    stopwatch = reduceStopwatch(stopwatch, action, time);
    if (action === "lap" || action === "reset") renderLaps();
    renderStopwatch(time);
    syncTick();
    const messages = {
      start: wasRunning ? "Stopwatch paused." : "Stopwatch started.",
      pause: "Stopwatch paused.",
      lap: "Lap recorded.",
      reset: "Stopwatch reset.",
    };
    if (messages[action]) announce(messages[action]);
  }

  function countdownAction(action) {
    const time = performance.now();
    if (action === "start") {
      const idle = !countdownRunning(countdown) && countdown.accumulatedMs === 0;
      if (idle || countdown.completed) {
        if (!showValidation(readInputs())) return;
        countdown = createCountdownState(readInputs().ms);
        clearFinished();
      }
      countdown = reduceCountdown(countdown, "start", time);
      announce("Countdown started.");
    } else if (action === "pause") {
      countdown = reduceCountdown(countdown, "pause", time);
      announce("Countdown paused.");
    } else if (action === "reset") {
      countdown = reduceCountdown(countdown, "reset", time);
      clearFinished();
      announce("Countdown reset.");
    }
    renderCountdown(time);
    syncTick();
  }

  for (const [value, tab] of tabs) {
    tab.addEventListener("click", () => setMode(value));
  }
  swStart.addEventListener("click", () => stopwatchAction(stopwatchRunning(stopwatch) ? "pause" : "start"));
  swLap.addEventListener("click", () => stopwatchAction("lap"));
  swReset.addEventListener("click", () => stopwatchAction("reset"));
  cdStart.addEventListener("click", () => countdownAction(countdownRunning(countdown) ? "pause" : "start"));
  cdReset.addEventListener("click", () => countdownAction("reset"));
  for (const preset of presets.querySelectorAll("[data-seconds]")) {
    preset.addEventListener("click", () => {
      const total = Number(preset.dataset.seconds);
      cdInputs.get("hours").value = String(Math.floor(total / 3600));
      cdInputs.get("minutes").value = String(Math.floor((total % 3600) / 60));
      cdInputs.get("seconds").value = String(total % 60);
      showValidation(readInputs());
    });
  }
  for (const input of cdInputs.values()) {
    input.addEventListener("input", () => {
      validation.hidden = true;
      validation.textContent = "";
      input.removeAttribute("aria-invalid");
    });
  }

  const onAbort = () => dispose();
  signal?.addEventListener?.("abort", onAbort, { once: true });

  setMode(activeMode);
  renderWallClock();
  renderStopwatch();
  renderCountdown();
  wallTimer = window.setInterval(renderWallClock, 1000);
  syncTick();

  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener?.("abort", onAbort);
    if (wallTimer !== null) { window.clearInterval(wallTimer); wallTimer = null; }
    if (tickTimer !== null) { window.clearInterval(tickTimer); tickTimer = null; }
    root.remove();
  }

  return {
    canClose: () => true,
    focus() {
      const heading = panels.get(activeMode)?.querySelector(".clock-panel-title");
      try { heading?.focus({ preventScroll: true }); } catch { heading?.focus(); }
    },
    dispose,
  };
}

export default { mount };
