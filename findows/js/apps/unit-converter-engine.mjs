/**
 * Unit Converter pure logic. No DOM, no persistence, no dependencies.
 *
 * Conversions use an exact factor table (SI-derived where possible) and an
 * affine table for temperature, so 1 mi = 1.609344 km and 0 C = 32 F exactly.
 * The stateful machine owns input text, unit selection, swapping, precision and
 * user-facing validation errors; the UI layer only renders its frozen snapshots.
 */

export const DEFAULT_PRECISION = 6;
export const MIN_PRECISION = 0;
export const MAX_PRECISION = 12;

const INVALID_INPUT = Object.freeze({
  code: "INVALID_INPUT",
  message: "Enter a valid number",
});

/** Linear conversion through a base unit (value * factor -> base -> value / factor). */
function linear(factor) {
  return Object.freeze({
    toBase: (value) => value * factor,
    fromBase: (base) => base / factor,
  });
}

const TEMPERATURE = Object.freeze({
  c: Object.freeze({ toBase: (value) => value, fromBase: (base) => base }),
  f: Object.freeze({
    toBase: (value) => (value - 32) * (5 / 9),
    fromBase: (base) => base * (9 / 5) + 32,
  }),
  k: Object.freeze({
    toBase: (value) => value - 273.15,
    fromBase: (base) => base + 273.15,
  }),
});

/* [id, label, symbol, factor-to-base]. Temperature overrides the factor table. */
const DEFINITIONS = [
  {
    id: "length",
    label: "Length",
    defaultFrom: "mi",
    defaultTo: "km",
    units: [
      ["mi", "Mile", "mi", 1609.344],
      ["km", "Kilometre", "km", 1000],
      ["m", "Metre", "m", 1],
      ["cm", "Centimetre", "cm", 0.01],
      ["mm", "Millimetre", "mm", 0.001],
      ["in", "Inch", "in", 0.0254],
      ["ft", "Foot", "ft", 0.3048],
      ["yd", "Yard", "yd", 0.9144],
      ["nmi", "Nautical mile", "nmi", 1852],
    ],
  },
  {
    id: "mass",
    label: "Mass",
    defaultFrom: "kg",
    defaultTo: "lb",
    units: [
      ["kg", "Kilogram", "kg", 1],
      ["g", "Gram", "g", 0.001],
      ["mg", "Milligram", "mg", 0.000001],
      ["t", "Tonne", "t", 1000],
      ["lb", "Pound", "lb", 0.45359237],
      ["oz", "Ounce", "oz", 0.028349523125],
      ["st", "Stone", "st", 6.35029318],
    ],
  },
  {
    id: "temperature",
    label: "Temperature",
    defaultFrom: "c",
    defaultTo: "f",
    temperature: true,
    units: [
      ["c", "Celsius", "°C"],
      ["f", "Fahrenheit", "°F"],
      ["k", "Kelvin", "K"],
    ],
  },
  {
    id: "area",
    label: "Area",
    defaultFrom: "m2",
    defaultTo: "ft2",
    units: [
      ["m2", "Square metre", "m²", 1],
      ["km2", "Square kilometre", "km²", 1000000],
      ["cm2", "Square centimetre", "cm²", 0.0001],
      ["ha", "Hectare", "ha", 10000],
      ["acre", "Acre", "acre", 4046.8564224],
      ["ft2", "Square foot", "ft²", 0.09290304],
      ["in2", "Square inch", "in²", 0.00064516],
    ],
  },
  {
    id: "volume",
    label: "Volume",
    defaultFrom: "l",
    defaultTo: "gal",
    units: [
      ["l", "Litre", "L", 1],
      ["ml", "Millilitre", "mL", 0.001],
      ["m3", "Cubic metre", "m³", 1000],
      ["tsp", "Teaspoon (US)", "tsp", 0.00492892159375],
      ["tbsp", "Tablespoon (US)", "tbsp", 0.01478676478125],
      ["floz", "Fluid ounce (US)", "fl oz", 0.0295735295625],
      ["cup", "Cup (US)", "cup", 0.2365882365],
      ["qt", "Quart (US)", "qt", 0.946352946],
      ["gal", "Gallon (US)", "gal", 3.785411784],
    ],
  },
  {
    id: "data",
    label: "Data",
    defaultFrom: "b",
    defaultTo: "kib",
    units: [
      ["b", "Byte", "B", 1],
      ["bit", "Bit", "bit", 0.125],
      ["kb", "Kilobyte (1000)", "kB", 1000],
      ["mb", "Megabyte (1000)", "MB", 1000000],
      ["gb", "Gigabyte (1000)", "GB", 1000000000],
      ["tb", "Terabyte (1000)", "TB", 1000000000000],
      ["kib", "Kibibyte (1024)", "KiB", 1024],
      ["mib", "Mebibyte (1024)", "MiB", 1048576],
      ["gib", "Gibibyte (1024)", "GiB", 1073741824],
    ],
  },
  {
    id: "time",
    label: "Time",
    defaultFrom: "h",
    defaultTo: "min",
    units: [
      ["s", "Second", "s", 1],
      ["ms", "Millisecond", "ms", 0.001],
      ["min", "Minute", "min", 60],
      ["h", "Hour", "h", 3600],
      ["day", "Day", "day", 86400],
      ["week", "Week", "week", 604800],
    ],
  },
];

const CATEGORIES_FROZEN = Object.freeze(
  DEFINITIONS.map((definition) =>
    Object.freeze({
      id: definition.id,
      label: definition.label,
      defaultFrom: definition.defaultFrom,
      defaultTo: definition.defaultTo,
      units: Object.freeze(
        definition.units.map(([id, label, symbol]) =>
          Object.freeze({ id, label, symbol })),
      ),
    }),
  ),
);

export const CATEGORIES = CATEGORIES_FROZEN;

const CATEGORY_BY_ID = new Map(DEFINITIONS.map((definition) => [definition.id, definition]));
const CATEGORY_META_BY_ID = new Map(CATEGORIES_FROZEN.map((entry) => [entry.id, entry]));

/** Public metadata array of category ids, in display order. */
export const CATEGORY_IDS = Object.freeze(CATEGORIES_FROZEN.map((entry) => entry.id));

function getCategory(categoryId) {
  const definition = CATEGORY_BY_ID.get(categoryId);
  if (!definition) throw new RangeError(`Unknown conversion category: ${String(categoryId)}`);
  return definition;
}

function getConverter(definition, unitId) {
  if (definition.temperature) {
    const converter = TEMPERATURE[unitId];
    if (!converter) throw new RangeError(`Unknown unit ${String(unitId)} in ${definition.id}`);
    return converter;
  }
  const row = definition.units.find(([id]) => id === unitId);
  if (!row) throw new RangeError(`Unknown unit ${String(unitId)} in ${definition.id}`);
  return linear(row[3]);
}

export function normalizePrecision(precision) {
  if (!Number.isInteger(precision) || precision < MIN_PRECISION || precision > MAX_PRECISION) {
    throw new RangeError(`Precision must be an integer from ${MIN_PRECISION} to ${MAX_PRECISION}`);
  }
  return precision;
}

/**
 * Convert a finite numeric value between two units of one category.
 * Throws RangeError for unknown ids and TypeError for a non-finite value.
 */
export function convert(value, categoryId, fromId, toId) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Conversion value must be a finite number");
  }
  const definition = getCategory(categoryId);
  const from = getConverter(definition, fromId);
  const to = getConverter(definition, toId);
  const result = to.fromBase(from.toBase(value));
  return result === 0 ? 0 : result;
}

/** Render a number with a fixed number of decimals, trimming trailing zeroes. */
export function formatResult(value, precision = DEFAULT_PRECISION) {
  const places = normalizePrecision(precision);
  if (!Number.isFinite(value)) return "";
  let text = value.toFixed(places);
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  if (text === "" || text === "-0") text = "0";
  return text;
}

const VALID_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function parseInput(text) {
  if (typeof text !== "string") throw new TypeError("Converter input must be text");
  if (text === "") return { empty: true };
  const trimmed = text.trim();
  if (trimmed === "" || !VALID_NUMBER.test(trimmed)) return { error: INVALID_INPUT };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { error: INVALID_INPUT };
  return { value };
}

/**
 * Stateful, immutable-snapshot converter machine used by the UI.
 * `options` accepts `{ category, precision }`; both are validated.
 */
export function createUnitConverter(options = {}) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("Converter options must be an object");
  }
  let categoryId = options.category === undefined ? "length" : getCategory(options.category).id;
  let precision = options.precision === undefined ? DEFAULT_PRECISION : normalizePrecision(options.precision);
  const definition = () => getCategory(categoryId);
  let fromId = definition().defaultFrom;
  let toId = definition().defaultTo;
  let input = "1";
  let error = null;
  let result = "";

  function recompute() {
    const parsed = parseInput(input);
    if (parsed.error) {
      error = { code: parsed.error.code, message: parsed.error.message };
      result = "";
      return;
    }
    error = null;
    result = parsed.empty ? "" : formatResult(convert(parsed.value, categoryId, fromId, toId), precision);
  }

  function snapshot() {
    return Object.freeze({
      category: categoryId,
      categories: CATEGORY_IDS,
      units: CATEGORY_META_BY_ID.get(categoryId).units,
      from: fromId,
      to: toId,
      input,
      precision,
      result,
      error: error ? Object.freeze({ ...error }) : null,
    });
  }

  recompute();

  return Object.freeze({
    getState: snapshot,
    setInput(text) {
      input = text;
      recompute();
      return snapshot();
    },
    setCategory(next) {
      const def = getCategory(next);
      categoryId = def.id;
      fromId = def.defaultFrom;
      toId = def.defaultTo;
      recompute();
      return snapshot();
    },
    setFrom(next) {
      getConverter(definition(), next);
      fromId = next;
      recompute();
      return snapshot();
    },
    setTo(next) {
      getConverter(definition(), next);
      toId = next;
      recompute();
      return snapshot();
    },
    swap() {
      const previous = fromId;
      fromId = toId;
      toId = previous;
      recompute();
      return snapshot();
    },
    setPrecision(next) {
      precision = normalizePrecision(next);
      recompute();
      return snapshot();
    },
  });
}

export default { CATEGORIES, CATEGORY_IDS, convert, formatResult, createUnitConverter };
