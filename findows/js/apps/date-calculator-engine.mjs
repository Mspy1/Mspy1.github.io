/* Pure calendar reasoning for the Date Calculator app.
 *
 * Dates are calendar values written as YYYY-MM-DD. Arithmetic uses only their
 * year/month/day fields, so "2026-01-01" means the same day on every device
 * regardless of its timezone or daylight-saving rules. No DOM, no persistence,
 * no locale-dependent formatting lives here.
 */

const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const DAY_UNITS = new Set(["day", "days"]);
const MONTH_UNITS = new Set(["month", "months"]);

export function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year, month) {
  return month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
}

function validYear(year) {
  return Number.isInteger(year) && year >= 1 && year <= 9999;
}

const failure = (message) => Object.freeze({ ok: false, message });

export function parseLocalDate(value) {
  if (typeof value !== "string") {
    return failure("Enter a date as YYYY-MM-DD.");
  }
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return failure("Enter a date as YYYY-MM-DD.");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!validYear(year)) {
    return failure("Year must be from 0001 to 9999.");
  }
  if (month < 1 || month > 12) {
    return failure("Month must be from 01 to 12.");
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return failure(`Day must be from 01 to ${String(daysInMonth(year, month)).padStart(2, "0")} for that month.`);
  }
  return Object.freeze({ ok: true, year, month, day });
}

export function isValidLocalDate(value) {
  return parseLocalDate(value).ok;
}

function requireDate(value, label = "date") {
  const parsed = parseLocalDate(value);
  if (!parsed.ok) {
    throw new RangeError(`Invalid ${label}: ${parsed.message}`);
  }
  return parsed;
}

function requireInteger(value, label) {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be a whole number.`);
  }
  return value;
}

const pad = (value, width) => String(value).padStart(width, "0");

export function formatLocalDate({ year, month, day } = {}) {
  if (!validYear(year) || !Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError("Cannot format an invalid calendar date.");
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/* The supplied instant is read in the device's local calendar. Pass an explicit
   UTC offset (in minutes) to read it in a fixed zone instead. */
export function todayLocalDate(now = new Date(), utcOffsetMinutes = null) {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("Cannot read a date from an invalid instant.");
  }
  const source = utcOffsetMinutes === null
    ? instant
    : new Date(instant.getTime() + utcOffsetMinutes * 60_000);
  const year = utcOffsetMinutes === null ? source.getFullYear() : source.getUTCFullYear();
  const month = (utcOffsetMinutes === null ? source.getMonth() : source.getUTCMonth()) + 1;
  const day = utcOffsetMinutes === null ? source.getDate() : source.getUTCDate();
  return formatLocalDate({ year, month, day });
}

/* A pure day number for a calendar date. UTC getters are used only as a stable
   counting device; the fields themselves came from the local calendar value. */
function dayNumber(date) {
  const epoch = new Date(0);
  epoch.setUTCFullYear(date.year, date.month - 1, date.day);
  epoch.setUTCHours(0, 0, 0, 0);
  return epoch.getTime() / MS_PER_DAY;
}

function fromDayNumber(number) {
  const value = new Date(number * MS_PER_DAY);
  const result = {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
  if (!validYear(result.year)) {
    throw new RangeError("Result is outside the supported year range (0001-9999).");
  }
  return result;
}

export function daysBetween(from, to) {
  const start = requireDate(from, "start date");
  const end = requireDate(to, "end date");
  return Math.round(dayNumber(end) - dayNumber(start));
}

export function addDays(date, amount) {
  const parsed = requireDate(date);
  requireInteger(amount, "Number of days");
  return formatLocalDate(fromDayNumber(dayNumber(parsed) + amount));
}

export function addMonths(date, amount) {
  const parsed = requireDate(date);
  requireInteger(amount, "Number of months");
  const index = parsed.year * 12 + (parsed.month - 1) + amount;
  const year = Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12 + 1;
  if (!validYear(year)) {
    throw new RangeError("Result is outside the supported year range (0001-9999).");
  }
  const day = Math.min(parsed.day, daysInMonth(year, month));
  return formatLocalDate({ year, month, day });
}

export function shiftDate(date, amount, unit) {
  if (DAY_UNITS.has(unit)) return addDays(date, amount);
  if (MONTH_UNITS.has(unit)) return addMonths(date, amount);
  throw new RangeError(`Unsupported date unit: ${String(unit)}`);
}

export function describeSpan(days) {
  requireInteger(days, "Day count");
  return `${days} ${days === 1 || days === -1 ? "day" : "days"}`;
}

export default {
  isLeapYear,
  daysInMonth,
  parseLocalDate,
  isValidLocalDate,
  formatLocalDate,
  todayLocalDate,
  daysBetween,
  addDays,
  addMonths,
  shiftDate,
  describeSpan,
};
