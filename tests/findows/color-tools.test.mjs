/* Gate 3: Color Tools pure logic — conversion, harmonies, WCAG contrast, errors.
   No DOM, no clipboard, no global state. Every accepted input is a local string. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ColorError,
  parseColor,
  formatHex,
  formatRgb,
  formatHsl,
  rgbToHsl,
  hslToRgb,
  relativeLuminance,
  contrastRatio,
  wcagLevels,
  harmonies,
  HARMONY_KINDS,
} from "../../findows/js/apps/color-tools-engine.mjs";

test("parses long, short and hashless hex into RGB channels", () => {
  assert.deepEqual(parseColor("#ff0000"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(parseColor("#336699"), { r: 51, g: 102, b: 153 });
  assert.deepEqual(parseColor("336699"), { r: 51, g: 102, b: 153 });
  assert.deepEqual(parseColor("#abc"), { r: 170, g: 187, b: 204 });
  assert.deepEqual(parseColor("#FFF"), { r: 255, g: 255, b: 255 });
});

test("parses rgb() and hsl() function notation", () => {
  assert.deepEqual(parseColor("rgb(51, 102, 153)"), { r: 51, g: 102, b: 153 });
  assert.deepEqual(parseColor("RGB(255,0,0)"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(parseColor("hsl(210, 50%, 40%)"), { r: 51, g: 102, b: 153 });
});

test("formats hex, rgb and hsl values for the copy buttons", () => {
  const red = { r: 255, g: 0, b: 0 };
  assert.equal(formatHex(red), "#ff0000");
  assert.equal(formatHex(red, { uppercase: true }), "#FF0000");
  assert.equal(formatRgb(red), "rgb(255, 0, 0)");
  assert.equal(formatHsl(rgbToHsl(red)), "hsl(0, 100%, 50%)");
  assert.equal(formatHsl(rgbToHsl({ r: 51, g: 102, b: 153 })), "hsl(210, 50%, 40%)");
});

test("converts RGB to HSL and back without drifting", () => {
  assert.deepEqual(rgbToHsl(parseColor("#336699")), { h: 210, s: 50, l: 40 });
  assert.deepEqual(hslToRgb({ h: 210, s: 50, l: 40 }), { r: 51, g: 102, b: 153 });
  assert.deepEqual(rgbToHsl(parseColor("#ff0000")), { h: 0, s: 100, l: 50 });
  assert.deepEqual(hslToRgb({ h: 0, s: 100, l: 50 }), { r: 255, g: 0, b: 0 });
});

test("greys have zero saturation and round-trip through HSL", () => {
  assert.deepEqual(rgbToHsl(parseColor("#ffffff")), { h: 0, s: 0, l: 100 });
  assert.deepEqual(rgbToHsl(parseColor("#000000")), { h: 0, s: 0, l: 0 });
  assert.deepEqual(hslToRgb({ h: 0, s: 0, l: 100 }), { r: 255, g: 255, b: 255 });
  const grey = rgbToHsl(parseColor("#808080"));
  assert.equal(grey.s, 0);
  assert.deepEqual(hslToRgb(grey), { r: 128, g: 128, b: 128 });
});

test("WCAG relative luminance anchors black at 0 and white at 1", () => {
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("#ffffff"), 1);
  assert.ok(Math.abs(relativeLuminance("#ff0000") - 0.2126) < 1e-9);
});

test("WCAG contrast: black on white is exactly 21:1, identical colours are 1:1", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#fff", "#000"), 21);
  assert.equal(contrastRatio("#777777", "#777777"), 1);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
});

test("contrast is symmetric and rounded to two decimals", () => {
  const a = "#4f6df5";
  const b = "#f5f8ff";
  assert.equal(contrastRatio(a, b), contrastRatio(b, a));
  assert.ok(contrastRatio(a, b) > 1 && contrastRatio(a, b) < 21);
  assert.equal(Math.round(contrastRatio(a, b) * 100) / 100, contrastRatio(a, b));
});

test("WCAG levels classify the four common thresholds", () => {
  assert.deepEqual(wcagLevels(contrastRatio("#000000", "#ffffff")), {
    normalAA: true, normalAAA: true, largeAA: true, largeAAA: true, level: "AAA",
  });
  assert.equal(wcagLevels(7).level, "AAA");
  assert.equal(wcagLevels(4.5).level, "AA");
  assert.equal(wcagLevels(3).level, "AA Large");
  assert.equal(wcagLevels(2.9).level, "Fail");
  assert.equal(wcagLevels(4.5).normalAA, true);
  assert.equal(wcagLevels(4.4).normalAA, false);
});

test("harmonies rotate hue and keep the base colour first", () => {
  assert.deepEqual(harmonies("#ff0000", "complementary").map((c) => c.hex),
    ["#ff0000", "#00ffff"]);
  assert.deepEqual(harmonies("#ff0000", "triadic").map((c) => c.hex),
    ["#ff0000", "#00ff00", "#0000ff"]);
  assert.deepEqual(harmonies("#ff0000", "analogous").map((c) => c.hex),
    ["#ff0000", "#ff0080", "#ff8000"]);
  assert.deepEqual(harmonies("#ff0000", "tetradic").map((c) => c.hex),
    ["#ff0000", "#80ff00", "#00ffff", "#8000ff"]);
  assert.deepEqual(harmonies("#ff0000", "split-complementary").map((c) => c.hex),
    ["#ff0000", "#00ff80", "#0080ff"]);
});

test("monochromatic harmony varies lightness at a fixed hue", () => {
  const mono = harmonies("#336699", "monochromatic");
  assert.equal(mono.length, 5);
  assert.ok(mono.every((c) => c.hsl.h === 210 && c.hsl.s === 50));
  assert.ok(mono[0].hsl.l < mono[2].hsl.l && mono[2].hsl.l < mono[4].hsl.l);
  assert.equal(mono[2].hex, "#336699");
});

test("harmony swatches carry copy-ready hex/rgb/hsl and an offset label", () => {
  const [base, complement] = harmonies("#ff0000", "complementary");
  assert.deepEqual(base, {
    r: 255, g: 0, b: 0, hex: "#ff0000", rgb: "rgb(255, 0, 0)",
    hsl: { h: 0, s: 100, l: 50 }, offset: 0, label: "Base",
  });
  assert.equal(complement.label, "Complement");
  assert.equal(complement.offset, 180);
  assert.equal(complement.rgb, "rgb(0, 255, 255)");
  assert.ok(HARMONY_KINDS.some((kind) => kind.id === "triadic"));
});

test("invalid input raises a typed, recoverable ColorError everywhere", () => {
  for (const bad of ["not-a-color", "#12345", "#1234567", "rgb(300, 0, 0)", "hsl(400, 50%, 40%)", ""]) {
    assert.throws(() => parseColor(bad), (error) =>
      error instanceof ColorError && error.code === "INVALID_COLOR" && error.message.length > 0,
      `${JSON.stringify(bad)} is rejected`);
  }
  assert.throws(() => contrastRatio("nope", "#ffffff"), (error) => error.code === "INVALID_COLOR");
  assert.throws(() => harmonies("#fff", "neon"), (error) =>
    error instanceof ColorError && error.code === "UNKNOWN_HARMONY");
  assert.ok(!Object.isFrozen(new ColorError("INVALID_COLOR", "x")), "errors are ordinary throwable values");
});
