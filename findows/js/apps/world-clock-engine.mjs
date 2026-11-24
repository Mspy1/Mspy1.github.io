/* Pure World Clock reasoning. No DOM, no timers, no network, no host-locale
   dependence: every Intl formatter is built with an explicit IANA timeZone so
   one instant maps to the correct wall time in every zone, including DST. */

export const CURATED_ZONES = Object.freeze([
  Object.freeze({ id: "UTC", label: "UTC", region: "World" }),
  Object.freeze({ id: "Europe/London", label: "London", region: "Europe" }),
  Object.freeze({ id: "Europe/Paris", label: "Paris", region: "Europe" }),
  Object.freeze({ id: "Europe/Berlin", label: "Berlin", region: "Europe" }),
  Object.freeze({ id: "America/New_York", label: "New York", region: "Americas" }),
  Object.freeze({ id: "America/Chicago", label: "Chicago", region: "Americas" }),
  Object.freeze({ id: "America/Denver", label: "Denver", region: "Americas" }),
  Object.freeze({ id: "America/Los_Angeles", label: "Los Angeles", region: "Americas" }),
  Object.freeze({ id: "America/Sao_Paulo", label: "São Paulo", region: "Americas" }),
  Object.freeze({ id: "Asia/Tokyo", label: "Tokyo", region: "Asia" }),
  Object.freeze({ id: "Asia/Shanghai", label: "Shanghai", region: "Asia" }),
  Object.freeze({ id: "Asia/Kolkata", label: "Kolkata", region: "Asia" }),
  Object.freeze({ id: "Asia/Dubai", label: "Dubai", region: "Asia" }),
  Object.freeze({ id: "Australia/Sydney", label: "Sydney", region: "Oceania" }),
  Object.freeze({ id: "Pacific/Auckland", label: "Auckland", region: "Oceania" }),
  Object.freeze({ id: "Pacific/Honolulu", label: "Honolulu", region: "Oceania" }),
  Object.freeze({ id: "Africa/Cairo", label: "Cairo", region: "Africa" }),
]);

export const DEFAULT_ZONES = Object.freeze([
  "UTC",
  "Europe/London",
  "America/New_York",
  "Asia/Tokyo",
]);

const zoneByLabel = new Map(CURATED_ZONES.map((zone) => [zone.id, zone.label]));

export function isValidZone(zone) {
  if (typeof zone !== "string" || zone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function zoneLabel(zone) {
  if (zoneByLabel.has(zone)) return zoneByLabel.get(zone);
  const tail = String(zone).split("/").pop().replace(/_/g, " ").trim();
  return tail || String(zone);
}

const timeFormatters = new Map();
const dateFormatters = new Map();
const keyFormatters = new Map();
const offsetFormatters = new Map();

function formatter(cache, zone, build) {
  let found = cache.get(zone);
  if (!found) {
    found = build();
    cache.set(zone, found);
  }
  return found;
}

function timeFormatter(zone) {
  return formatter(timeFormatters, zone, () => new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }));
}

function dateFormatter(zone) {
  return formatter(dateFormatters, zone, () => new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  }));
}

function keyFormatter(zone) {
  return formatter(keyFormatters, zone, () => new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }));
}

function part(formats, type) {
  const found = formats.find((entry) => entry.type === type);
  return found ? found.value : "0";
}

export function zoneOffsetMinutes(zone, date) {
  const parts = keyFormatter(zone).formatToParts(date);
  const wall = Date.UTC(
    Number(part(parts, "year")),
    Number(part(parts, "month")) - 1,
    Number(part(parts, "day")),
    Number(part(parts, "hour")),
    Number(part(parts, "minute")),
    Number(part(parts, "second")),
  );
  const instant = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((wall - instant) / 60_000);
}

export function formatOffset(minutes) {
  const total = Number.isFinite(minutes) ? Math.round(minutes) : 0;
  const sign = total < 0 ? "-" : "+";
  const absolute = Math.abs(total);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const mins = String(absolute % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${mins}`;
}

export function formatZoneTime(zone, date) {
  if (!isValidZone(zone) || !(date instanceof Date) || Number.isNaN(date.getTime())) {
    return { ok: false, message: `Unknown time zone: ${String(zone)}` };
  }
  try {
    const parts = keyFormatter(zone).formatToParts(date);
    const dateKey = `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
    const offsetMinutes = zoneOffsetMinutes(zone, date);
    return Object.freeze({
      ok: true,
      zone,
      label: zoneLabel(zone),
      time: timeFormatter(zone).format(date),
      dateKey,
      dateLabel: dateFormatter(zone).format(date),
      offsetMinutes,
      offsetLabel: formatOffset(offsetMinutes),
    });
  } catch {
    return { ok: false, message: `Could not read the time in ${String(zone)}` };
  }
}

export function createZoneState(initialZones) {
  const seen = new Set();
  const zones = [];
  const source = Array.isArray(initialZones) ? initialZones : [];
  for (const zone of source) {
    if (isValidZone(zone) && !seen.has(zone)) {
      seen.add(zone);
      zones.push(zone);
    }
  }
  return Object.freeze(zones);
}

export function addZone(state, zone) {
  if (!isValidZone(zone)) {
    return { ok: false, state, message: `"${String(zone)}" is not a recognised time zone.` };
  }
  if (state.includes(zone)) {
    return { ok: false, state, message: `${zoneLabel(zone)} is already on the clock.` };
  }
  return { ok: true, state: Object.freeze([...state, zone]) };
}

export function removeZone(state, zone) {
  if (!state.includes(zone)) {
    return { ok: false, state, message: `${zoneLabel(zone)} is not on the clock.` };
  }
  return { ok: true, state: Object.freeze(state.filter((entry) => entry !== zone)) };
}

export default {
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
};
