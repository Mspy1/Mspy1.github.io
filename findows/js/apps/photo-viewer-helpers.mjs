/* Pure helpers for Photo Viewer. No DOM, no decoding, no storage. */

export const ZOOM_STEPS = Object.freeze([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]);

const EXTENSIONS = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
});
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Download name derived from the displayed name and the validated media type. */
export function safeImageFilename(name, mediaType) {
  const extension = EXTENSIONS[String(mediaType ?? "").trim().toLowerCase()] || "";
  let base = String(name ?? "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g, "_")
    .trim()
    .replace(/^[._]+/, "")
    .replace(/\s+/g, "_")
    .slice(0, 180)
    .replace(/[. ]+$/, "");
  if (!base) base = "image";
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
  const aliases = extension === "jpg" ? ["jpg", "jpeg"] : [extension];
  if (extension && !aliases.some((suffix) => new RegExp(`\\.${suffix}$`, "i").test(base))) {
    base = `${base}.${extension}`;
  }
  return base.slice(0, 200);
}

/** Typed validation/storage codes stay visible to the reader. */
export function formatImageError(error) {
  if (error == null) return "Something went wrong.";
  const message = typeof error.message === "string" && error.message ? error.message : "Something went wrong.";
  const code = typeof error.code === "string" ? error.code.trim() : "";
  return code ? `${code}: ${message}` : message;
}

/** Scale that fits real pixel dimensions into the available stage size. */
export function fitScale(width, height, availableWidth, availableHeight) {
  const w = Number(width);
  const h = Number(height);
  const aw = Number(availableWidth);
  const ah = Number(availableHeight);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return 1;
  if (!Number.isFinite(aw) || !Number.isFinite(ah) || aw < 1 || ah < 1) return 1;
  const scale = Math.min(aw / w, ah / h);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Keep the canvas backing store inside a pixel budget at any zoom level. */
export function clampScale(scale, width, height, dpr = 1, maxPixels = 16_000_000) {
  const wanted = Number.isFinite(scale) && scale > 0 ? scale : 0.25;
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const ratio = Math.max(1, Number(dpr) || 1);
  const limit = Math.sqrt(Math.max(1, maxPixels) / (w * h * ratio * ratio));
  return Math.max(0.05, Math.min(wanted, limit));
}

export function formatDimensions(width, height) {
  return `${width} × ${height}`;
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 bytes";
  if (value < 1024) return `${Math.round(value)} bytes`;
  let scaled = value / 1024;
  let unit = 0;
  const units = ["KB", "MB", "GB"];
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(1)} ${units[unit]}`;
}
