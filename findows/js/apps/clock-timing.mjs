/* Pure timing reasoning for the Clock app. No DOM, no timers, no locale state.
   All elapsed values are derived from timestamps supplied by the caller. */

export const MAX_DURATION_MS = 86_399_000; // 23:59:59

const pad2 = (value) => String(value).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD; never derived from the UTC day. */
export function localISODate(date) {
  const value = date instanceof Date ? date : new Date(date);
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

export function formatStopwatch(ms) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const hundredths = Math.floor(total / 10) % 100;
  const secondsTotal = Math.floor(total / 1000);
  const seconds = secondsTotal % 60;
  const minutes = Math.floor(secondsTotal / 60) % 60;
  const hours = Math.floor(secondsTotal / 3600);
  const tail = `${pad2(minutes)}:${pad2(seconds)}.${pad2(hundredths)}`;
  return hours > 0 ? `${pad2(hours)}:${tail}` : tail;
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(Number(ms) || 0));
  if (total === 0) return "00:00";
  const secondsTotal = Math.ceil(total / 1000);
  const seconds = secondsTotal % 60;
  const minutes = Math.floor(secondsTotal / 60) % 60;
  const hours = Math.floor(secondsTotal / 3600);
  const tail = `${pad2(minutes)}:${pad2(seconds)}`;
  return hours > 0 ? `${pad2(hours)}:${tail}` : tail;
}

export function parseDuration(input = {}) {
  const fields = ["hours", "minutes", "seconds"];
  const values = {};
  let blanks = 0;
  for (const field of fields) {
    const raw = input?.[field];
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      blanks += 1;
      values[field] = 0;
      continue;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, field, message: `Enter a whole number of ${field} from 0 or more.` };
    }
    values[field] = value;
  }
  if (blanks === fields.length) {
    return { ok: false, field: null, message: "Enter a time greater than zero." };
  }
  if (values.hours > 23) {
    return { ok: false, field: "hours", message: "Hours must be from 0 to 23." };
  }
  if (values.minutes > 59) {
    return { ok: false, field: "minutes", message: "Minutes must be from 0 to 59." };
  }
  if (values.seconds > 59) {
    return { ok: false, field: "seconds", message: "Seconds must be from 0 to 59." };
  }
  const ms = (values.hours * 3600 + values.minutes * 60 + values.seconds) * 1000;
  if (ms <= 0 || ms > MAX_DURATION_MS) {
    return { ok: false, field: null, message: "Enter a time between 1 second and 23:59:59." };
  }
  return { ok: true, ms };
}

export function createStopwatchState() {
  return Object.freeze({
    accumulatedMs: 0,
    startedAt: null,
    laps: Object.freeze([]),
  });
}

export function stopwatchRunning(state) {
  return state.startedAt !== null;
}

export function stopwatchElapsedMs(state, now) {
  const delta = state.startedAt === null ? 0 : Math.max(0, now - state.startedAt);
  return state.accumulatedMs + delta;
}

export function reduceStopwatch(state, action, now) {
  switch (action) {
    case "start":
      if (stopwatchRunning(state)) return state;
      return Object.freeze({ ...state, startedAt: now });
    case "pause":
      if (!stopwatchRunning(state)) return state;
      return Object.freeze({
        accumulatedMs: stopwatchElapsedMs(state, now),
        startedAt: null,
        laps: state.laps,
      });
    case "lap": {
      if (!stopwatchRunning(state)) return state;
      const totalMs = stopwatchElapsedMs(state, now);
      const previousTotal = state.laps.length ? state.laps[0].totalMs : 0;
      const lap = Object.freeze({ lapMs: Math.max(0, totalMs - previousTotal), totalMs });
      return Object.freeze({ ...state, laps: Object.freeze([lap, ...state.laps]) });
    }
    case "reset":
      return createStopwatchState();
    default:
      throw new RangeError(`Unknown stopwatch action: ${String(action)}`);
  }
}

export function createCountdownState(durationMs) {
  if (!Number.isInteger(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS) {
    throw new RangeError("Countdown duration must be between 1 ms and the 23:59:59 limit");
  }
  return Object.freeze({
    durationMs,
    accumulatedMs: 0,
    startedAt: null,
    completed: false,
  });
}

export function countdownRunning(state) {
  return state.startedAt !== null;
}

export function countdownElapsedMs(state, now) {
  const delta = state.startedAt === null ? 0 : Math.max(0, now - state.startedAt);
  return state.accumulatedMs + delta;
}

export function countdownRemainingMs(state, now) {
  return Math.max(0, state.durationMs - countdownElapsedMs(state, now));
}

export function countdownComplete(state, now) {
  return countdownRemainingMs(state, now) <= 0;
}

export function reduceCountdown(state, action, now) {
  switch (action) {
    case "start":
    case "resume":
      if (countdownRunning(state) || state.completed) return state;
      return Object.freeze({ ...state, startedAt: now });
    case "pause":
      if (!countdownRunning(state)) return state;
      return Object.freeze({
        ...state,
        accumulatedMs: countdownElapsedMs(state, now),
        startedAt: null,
      });
    case "complete":
      return Object.freeze({
        ...state,
        accumulatedMs: state.durationMs,
        startedAt: null,
        completed: true,
      });
    case "reset":
      return createCountdownState(state.durationMs);
    default:
      throw new RangeError(`Unknown countdown action: ${String(action)}`);
  }
}

export default {
  localISODate,
  formatStopwatch,
  formatCountdown,
  parseDuration,
  createStopwatchState,
  reduceStopwatch,
  createCountdownState,
  reduceCountdown,
};
