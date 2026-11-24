/**
 * Color Tools pure engine.
 *
 * No DOM, no clipboard, no persistence, no timers and no network. Every public
 * function takes local strings or plain {r,g,b} / {h,s,l} values and returns
 * plain data the UI can render. Invalid input is reported as a typed ColorError
 * with a stable code so the surface can show a recoverable message.
 *
 * Colour policy: RGB channels are integers 0..255, HSL hue is an integer in
 * [0,360), saturation/lightness are percentages rounded to one decimal. WCAG
 * contrast follows the relative-luminance formula and is reported to two
 * decimals (black on white is exactly 21:1).
 */

export class ColorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ColorError";
    this.code = code;
  }
}

const invalid = (input) => new ColorError(
  "INVALID_COLOR",
  `“${String(input).slice(0, 40)}” is not a valid colour. Try #336699, rgb(51, 102, 153) or hsl(210, 50%, 40%).`,
);

const round1 = (value) => Math.round(value * 10) / 10;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const HARMONY_KINDS = Object.freeze([
  { id: "complementary", label: "Complementary", description: "The colour opposite the base on the wheel." },
  { id: "analogous", label: "Analogous", description: "Neighbours within 30° of the base." },
  { id: "triadic", label: "Triadic", description: "Three colours spaced evenly at 120°." },
  { id: "tetradic", label: "Tetradic", description: "A balanced square with 90° steps." },
  { id: "split-complementary", label: "Split complement", description: "Two colours beside the complement." },
  { id: "monochromatic", label: "Monochromatic", description: "One hue at five lightness levels." },
]);

const ROTATIONS = Object.freeze({
  complementary: { offsets: [0, 180], labels: ["Base", "Complement"] },
  analogous: { offsets: [0, -30, 30], labels: ["Base", "Analog −30°", "Analog +30°"] },
  triadic: { offsets: [0, 120, 240], labels: ["Base", "Triad +120°", "Triad +240°"] },
  tetradic: { offsets: [0, 90, 180, 270], labels: ["Base", "Square +90°", "Square +180°", "Square +270°"] },
  "split-complementary": { offsets: [0, 150, 210], labels: ["Base", "Split +150°", "Split +210°"] },
});

const MONO_OFFSETS = [-24, -12, 0, 12, 24];

/** Accept hex, rgb()/hsl() notation or an already-parsed {r,g,b} value. */
export function parseColor(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const { r, g, b } = input;
    if ([r, g, b].every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
      return { r, g, b };
    }
    throw invalid(JSON.stringify(input));
  }
  if (typeof input !== "string") throw invalid(input);

  const text = input.trim();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1].length === 3
      ? hex[1].split("").map((digit) => digit + digit).join("")
      : hex[1];
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
    };
  }

  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(text);
  if (rgb) {
    const channels = rgb.slice(1).map(Number);
    if (!channels.every((channel) => channel >= 0 && channel <= 255)) throw invalid(input);
    return { r: channels[0], g: channels[1], b: channels[2] };
  }

  const hsl = /^hsl\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*\)$/i.exec(text);
  if (hsl) {
    const [h, s, l] = hsl.slice(1).map(Number);
    if (h < 0 || h > 360 || s < 0 || s > 100 || l < 0 || l > 100) throw invalid(input);
    return hslToRgb({ h, s, l });
  }

  throw invalid(input);
}

export function formatHex(color, options = {}) {
  const { r, g, b } = parseColor(color);
  const hex = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  return options.uppercase ? hex.toUpperCase() : hex;
}

export function formatRgb(color) {
  const { r, g, b } = parseColor(color);
  return `rgb(${r}, ${g}, ${b})`;
}

export function formatHsl(color) {
  const hsl = color && typeof color === "object" && "h" in color
    ? color
    : rgbToHsl(parseColor(color));
  const h = ((Math.round(hsl.h) % 360) + 360) % 360;
  return `hsl(${h}, ${round1(clamp(hsl.s, 0, 100))}%, ${round1(clamp(hsl.l, 0, 100))}%)`;
}

export function rgbToHsl(color) {
  const { r, g, b } = parseColor(color);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
    if (h < 0) h += 360;
  }
  return { h: Math.round(h) % 360, s: round1(s * 100), l: round1(l * 100) };
}

export function hslToRgb(color) {
  if (!color || typeof color !== "object") throw invalid(color);
  const { h, s, l } = color;
  if (![h, s, l].every((part) => typeof part === "number" && Number.isFinite(part))) throw invalid(color);
  if (h < 0 || h > 360 || s < 0 || s > 100 || l < 0 || l > 100) throw invalid(color);

  const hue = (((h % 360) + 360) % 360) / 60;
  const saturation = s / 100;
  const lightness = l / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = lightness - c / 2;

  let parts;
  if (hue < 1) parts = [c, x, 0];
  else if (hue < 2) parts = [x, c, 0];
  else if (hue < 3) parts = [0, c, x];
  else if (hue < 4) parts = [0, x, c];
  else if (hue < 5) parts = [x, 0, c];
  else parts = [c, 0, x];

  return {
    r: Math.round((parts[0] + m) * 255),
    g: Math.round((parts[1] + m) * 255),
    b: Math.round((parts[2] + m) * 255),
  };
}

/** WCAG 2.x relative luminance; black is 0, white is 1. */
export function relativeLuminance(color) {
  const { r, g, b } = parseColor(color);
  const linear = (channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, rounded to two decimals and always in [1, 21]. */
export function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

export function wcagLevels(ratio) {
  const value = Number(ratio);
  const normalAA = value >= 4.5;
  const normalAAA = value >= 7;
  const largeAA = value >= 3;
  const largeAAA = value >= 4.5;
  const level = normalAAA ? "AAA" : normalAA ? "AA" : largeAA ? "AA Large" : "Fail";
  return { normalAA, normalAAA, largeAA, largeAAA, level };
}

/** A copy-ready description of any supported input. */
export function describeColor(input) {
  const rgb = parseColor(input);
  const hsl = rgbToHsl(rgb);
  return { ...rgb, hex: formatHex(rgb), rgb: formatRgb(rgb), hsl };
}

/** Hue-rotation and lightness harmonies. The base colour is always first. */
export function harmonies(input, kind) {
  const base = describeColor(input);
  const definition = ROTATIONS[kind];

  if (definition) {
    return definition.offsets.map((offset, index) => {
      const hsl = {
        h: (base.hsl.h + offset + 360) % 360,
        s: base.hsl.s,
        l: base.hsl.l,
      };
      const rgb = hslToRgb(hsl);
      return {
        ...rgb,
        hex: formatHex(rgb),
        rgb: formatRgb(rgb),
        hsl,
        offset,
        label: definition.labels[index],
      };
    });
  }

  if (kind === "monochromatic") {
    return MONO_OFFSETS.map((offset) => {
      const hsl = { h: base.hsl.h, s: base.hsl.s, l: clamp(base.hsl.l + offset, 6, 94) };
      const rgb = hslToRgb(hsl);
      return {
        ...rgb,
        hex: formatHex(rgb),
        rgb: formatRgb(rgb),
        hsl,
        offset,
        label: offset === 0 ? "Base" : offset < 0 ? `Shade ${offset}` : `Tint +${offset}`,
      };
    });
  }

  throw new ColorError("UNKNOWN_HARMONY", `Unknown harmony “${String(kind)}”.`);
}
