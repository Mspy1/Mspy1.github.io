/**
 * Paint drawing model — fixed 1024×768 logical Canvas 2D document.
 *
 * This module owns the raster document, tool geometry, undo/redo history and PNG
 * export. It owns no DOM chrome, no input listeners, no storage, no image
 * decoding/validation and no CSS. A designer mounts `engine.canvas`, forwards
 * pointer/keyboard input into the documented methods and renders its own controls.
 *
 * Unit: logical pixels. A point is an integer pixel index in [0, width-1] ×
 * [0, height-1]. Rendering centers strokes on the pixel (adds 0.5 internally), so
 * the pixel a visitor points at is the pixel that changes. The canvas is not a
 * semantic image editor: it stores RGBA raster pixels only.
 *
 * Display scaling: the backing canvas stays width×height; the designer sizes it
 * with CSS (zoom-to-fit). `pointFromEvent(event, rect?)` converts client
 * coordinates through the element's bounding box, so touch and mouse agree at any
 * display scale. `scalePointerFromRect` is the pure form of that conversion.
 *
 * Tools: "brush" | "eraser" | "line" | "rect" | "ellipse". The eraser paints the
 * document background color (the exported PNG stays opaque); it does not punch
 * transparency. Shapes are outline-only. A gesture is explicit:
 *   beginStroke(point) → extendStroke(point)* → endStroke()
 * `cancelStroke()` restores the pre-gesture pixels and records no history.
 *
 * History: each committed gesture/clear/loadImage stores one full ImageData
 * snapshot, accounted by its actual `data.byteLength`. The oldest snapshots are
 * discarded once the total exceeds `maxUndoBytes` (default 32 MiB), but at least
 * two states — the current state and one previous state — are always retained so
 * one normal undo stays available even with an artificially tiny budget.
 *
 * Import: `initializeFromImage(decodedSource)` resets the document to an already
 * decoded and validated image (HTMLImageElement/ImageBitmap/canvas), contained
 * and centered without stretching or upscaling, and makes it the new history
 * baseline. `loadImage(decodedSource)` does the same fit as an undoable edit.
 * Decoding, signature/dimension validation, originals and persistence belong to
 * the caller. Cross-origin sources must not be passed: they taint the canvas and
 * make history snapshots/export impossible.
 *
 * Lifecycle: call `dispose()` when the window closes. It is idempotent, releases
 * every snapshot/baseline buffer and makes mutators and export reject. The engine
 * owns no timers, listeners or Blob URLs.
 */

export const CANVAS_WIDTH = 1024;
export const CANVAS_HEIGHT = 768;
export const DEFAULT_MAX_UNDO_BYTES = 32 * 1024 * 1024;
export const DEFAULT_BACKGROUND = "#ffffff";
export const DEFAULT_COLOR = "#1f2937";
export const DEFAULT_LINE_WIDTH = 4;
export const MIN_LINE_WIDTH = 1;
export const MAX_LINE_WIDTH = 100;
export const TOOLS = Object.freeze(["brush", "eraser", "line", "rect", "ellipse"]);
export const DEFAULT_TOOL = "brush";
export const PNG_MEDIA_TYPE = "image/png";

const TOOL_SET = new Set(TOOLS);
const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const MIN_HISTORY_STATES = 2;
const TAU = Math.PI * 2;

function requireObject(value, label) {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function requirePositiveInteger(value, fallback, label) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function requireDimension(value, fallback, label) {
  return requirePositiveInteger(value, fallback, label);
}

export function isValidColor(value) {
  return typeof value === "string" && COLOR_PATTERN.test(value);
}

export function normalizeColor(value) {
  if (!isValidColor(value)) {
    throw new RangeError("Color must be a 3, 6 or 8 digit CSS hex value");
  }
  return value.toLowerCase();
}

function normalizeTool(value) {
  if (typeof value !== "string" || !TOOL_SET.has(value)) {
    throw new RangeError(`Tool must be one of: ${TOOLS.join(", ")}`);
  }
  return value;
}

function normalizeLineWidth(value) {
  if (!Number.isInteger(value) || value < MIN_LINE_WIDTH || value > MAX_LINE_WIDTH) {
    throw new RangeError(`Line width must be an integer from ${MIN_LINE_WIDTH} to ${MAX_LINE_WIDTH}`);
  }
  return value;
}

/** Real bytes of one full RGBA snapshot for the given logical canvas. */
export function undoSnapshotBytes(width = CANVAS_WIDTH, height = CANVAS_HEIGHT) {
  const w = requirePositiveInteger(width, CANVAS_WIDTH, "width");
  const h = requirePositiveInteger(height, CANVAS_HEIGHT, "height");
  return w * h * 4;
}

/**
 * Contain a decoded source inside the logical canvas without stretching and
 * without upscaling. Returns the destination rect in logical pixels.
 */
export function computeFitRect(sourceWidth, sourceHeight, targetWidth = CANVAS_WIDTH, targetHeight = CANVAS_HEIGHT) {
  const sw = requireFinite(sourceWidth, "sourceWidth");
  const sh = requireFinite(sourceHeight, "sourceHeight");
  const tw = requireFinite(targetWidth, "targetWidth");
  const th = requireFinite(targetHeight, "targetHeight");
  if (sw <= 0 || sh <= 0) throw new RangeError("Source dimensions must be positive");
  if (tw <= 0 || th <= 0) throw new RangeError("Target dimensions must be positive");
  const scale = Math.min(1, tw / sw, th / sh);
  const width = sw * scale;
  const height = sh * scale;
  return Object.freeze({
    scale,
    x: (tw - width) / 2,
    y: (th - height) / 2,
    width,
    height,
  });
}

/** Round a logical point onto a real pixel index and clamp it into the canvas. */
export function clampCanvasPoint(point, width = CANVAS_WIDTH, height = CANVAS_HEIGHT) {
  const source = requireObject(point, "point");
  const x = requireFinite(source.x, "point.x");
  const y = requireFinite(source.y, "point.y");
  const w = requirePositiveInteger(width, CANVAS_WIDTH, "width");
  const h = requirePositiveInteger(height, CANVAS_HEIGHT, "height");
  return Object.freeze({
    x: Math.min(w - 1, Math.max(0, Math.round(x))),
    y: Math.min(h - 1, Math.max(0, Math.round(y))),
  });
}

/**
 * Convert a pointer (clientX/clientY) through a rendered box (a DOMRect or any
 * { left, top, width, height }) into a clamped logical pixel. Handles CSS zoom.
 */
export function scalePointerFromRect(pointer, rect, width = CANVAS_WIDTH, height = CANVAS_HEIGHT) {
  const source = requireObject(pointer, "pointer");
  const box = requireObject(rect, "rect");
  const clientX = requireFinite(source.clientX, "pointer.clientX");
  const clientY = requireFinite(source.clientY, "pointer.clientY");
  const left = requireFinite(box.left, "rect.left");
  const top = requireFinite(box.top, "rect.top");
  const boxWidth = requireFinite(box.width, "rect.width");
  const boxHeight = requireFinite(box.height, "rect.height");
  const w = requirePositiveInteger(width, CANVAS_WIDTH, "width");
  const h = requirePositiveInteger(height, CANVAS_HEIGHT, "height");
  if (boxWidth <= 0 || boxHeight <= 0) {
    throw new RangeError("rect.width and rect.height must be positive");
  }
  return clampCanvasPoint(
    {
      x: Math.floor(((clientX - left) * w) / boxWidth),
      y: Math.floor(((clientY - top) * h) / boxHeight),
    },
    w,
    h,
  );
}

function resolveCanvas(options) {
  const candidate =
    options.canvas ??
    (typeof options.createCanvas === "function" ? options.createCanvas() : undefined) ??
    (typeof document !== "undefined" && typeof document.createElement === "function"
      ? document.createElement("canvas")
      : undefined);
  if (!candidate || typeof candidate.getContext !== "function") {
    throw new TypeError("Paint engine needs a canvas element or a createCanvas option");
  }
  return candidate;
}

function sourceDimensions(source) {
  const image = requireObject(source, "image");
  const width = image.naturalWidth || image.width || image.videoWidth;
  const height = image.naturalHeight || image.height || image.videoHeight;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new TypeError("Image source needs positive width/height or naturalWidth/naturalHeight");
  }
  return { width, height };
}

export function createPaintEngine(options = {}) {
  const settings = requireObject(options, "Paint engine options");
  const width = requireDimension(settings.width, CANVAS_WIDTH, "width");
  const height = requireDimension(settings.height, CANVAS_HEIGHT, "height");
  const maxUndoBytes = requirePositiveInteger(settings.maxUndoBytes, DEFAULT_MAX_UNDO_BYTES, "maxUndoBytes");
  const background = normalizeColor(settings.background === undefined ? DEFAULT_BACKGROUND : settings.background);
  let color = normalizeColor(settings.color === undefined ? DEFAULT_COLOR : settings.color);
  let lineWidth = normalizeLineWidth(settings.lineWidth === undefined ? DEFAULT_LINE_WIDTH : settings.lineWidth);
  let tool = normalizeTool(settings.tool === undefined ? DEFAULT_TOOL : settings.tool);

  const canvas = resolveCanvas(settings);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Paint engine needs a 2D canvas context");

  let cursor = Object.freeze({ x: Math.floor(width / 2), y: Math.floor(height / 2) });
  let stroke = null;
  let disposed = false;
  let states = [];
  let index = 0;

  const ensureActive = () => {
    if (disposed) {
      const error = new Error("Paint engine is disposed");
      error.code = "DISPOSED";
      throw error;
    }
  };

  const capture = () => context.getImageData(0, 0, width, height);

  const storedBytes = () => {
    let total = 0;
    for (const snapshot of states) total += snapshot.data.byteLength;
    return total;
  };

  const restore = () => {
    context.putImageData(states[index], 0, 0);
  };

  const trimHistory = () => {
    while (states.length > MIN_HISTORY_STATES && storedBytes() > maxUndoBytes) {
      states.shift();
      if (index > 0) index -= 1;
    }
  };

  const pushState = () => {
    if (index < states.length - 1) states.length = index + 1;
    states.push(capture());
    index = states.length - 1;
    trimHistory();
  };

  const fillBackground = () => {
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.clearRect(0, 0, width, height);
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.restore();
  };

  const paintColorFor = (settingsAtStroke) => (settingsAtStroke.tool === "eraser" ? background : settingsAtStroke.color);

  const applyStrokeStyle = (settingsAtStroke) => {
    context.lineWidth = settingsAtStroke.lineWidth;
    context.strokeStyle = paintColorFor(settingsAtStroke);
    context.fillStyle = paintColorFor(settingsAtStroke);
    context.lineCap = "round";
    context.lineJoin = "round";
  };

  const drawDot = (settingsAtStroke, point) => {
    context.save();
    applyStrokeStyle(settingsAtStroke);
    context.beginPath();
    context.arc(point.x + 0.5, point.y + 0.5, Math.max(0.5, settingsAtStroke.lineWidth / 2), 0, TAU);
    context.fill();
    context.restore();
  };

  const drawSegment = (settingsAtStroke, from, to) => {
    context.save();
    applyStrokeStyle(settingsAtStroke);
    context.beginPath();
    context.moveTo(from.x + 0.5, from.y + 0.5);
    context.lineTo(to.x + 0.5, to.y + 0.5);
    context.stroke();
    context.restore();
  };

  const drawShape = (settingsAtStroke, from, to) => {
    if (settingsAtStroke.tool === "line") {
      drawSegment(settingsAtStroke, from, to);
      return;
    }
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const shapeWidth = Math.abs(to.x - from.x);
    const shapeHeight = Math.abs(to.y - from.y);
    context.save();
    applyStrokeStyle(settingsAtStroke);
    context.beginPath();
    if (settingsAtStroke.tool === "rect") {
      context.rect(x + 0.5, y + 0.5, shapeWidth, shapeHeight);
    } else {
      context.ellipse(
        x + shapeWidth / 2 + 0.5,
        y + shapeHeight / 2 + 0.5,
        Math.max(0.5, shapeWidth / 2),
        Math.max(0.5, shapeHeight / 2),
        0,
        0,
        TAU,
      );
    }
    context.stroke();
    context.restore();
  };

  const drawImageFitted = (source) => {
    const dimensions = sourceDimensions(source);
    const fit = computeFitRect(dimensions.width, dimensions.height, width, height);
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, fit.x, fit.y, fit.width, fit.height);
    context.restore();
    return fit;
  };

  const getState = () => {
    const canUndo = !disposed && index > 0;
    const canRedo = !disposed && index < states.length - 1;
    return Object.freeze({
      width,
      height,
      background,
      tool,
      color,
      lineWidth,
      cursor: Object.freeze({ x: cursor.x, y: cursor.y }),
      strokeActive: !disposed && stroke !== null,
      canUndo,
      canRedo,
      undoDepth: canUndo ? index : 0,
      redoDepth: canRedo ? states.length - 1 - index : 0,
      historyStates: disposed ? 0 : states.length,
      historyBytes: disposed ? 0 : storedBytes(),
      maxUndoBytes,
      disposed,
    });
  };

  const setTool = (value) => {
    ensureActive();
    tool = normalizeTool(value);
    return getState();
  };

  const setColor = (value) => {
    ensureActive();
    color = normalizeColor(value);
    return getState();
  };

  const setLineWidth = (value) => {
    ensureActive();
    lineWidth = normalizeLineWidth(value);
    return getState();
  };

  const setCursor = (point) => {
    ensureActive();
    cursor = clampCanvasPoint(point, width, height);
    return cursor;
  };

  const moveCursor = (dx, dy) => {
    ensureActive();
    const stepX = requireFinite(dx, "dx");
    const stepY = requireFinite(dy, "dy");
    cursor = clampCanvasPoint({ x: cursor.x + stepX, y: cursor.y + stepY }, width, height);
    return cursor;
  };

  const cancelStroke = () => {
    ensureActive();
    if (!stroke) return false;
    context.putImageData(stroke.baseline, 0, 0);
    stroke = null;
    return true;
  };

  const beginStroke = (point) => {
    ensureActive();
    if (stroke) cancelStroke();
    const start = clampCanvasPoint(point, width, height);
    const settingsAtStroke = Object.freeze({ tool, color, lineWidth });
    const baseline = capture();
    const active = {
      settings: settingsAtStroke,
      anchor: start,
      last: start,
      baseline,
      changed: false,
    };
    stroke = active;
    cursor = start;
    if (tool === "brush" || tool === "eraser") {
      drawDot(settingsAtStroke, start);
      active.changed = true;
    }
    return getState();
  };

  const extendStroke = (point) => {
    ensureActive();
    if (!stroke) return getState();
    const next = clampCanvasPoint(point, width, height);
    const active = stroke;
    if (active.settings.tool === "brush" || active.settings.tool === "eraser") {
      if (next.x !== active.last.x || next.y !== active.last.y) {
        drawSegment(active.settings, active.last, next);
        active.changed = true;
      }
    } else {
      context.putImageData(active.baseline, 0, 0);
      if (active.settings.tool === "line") {
        drawShape(active.settings, active.anchor, next);
        active.changed = true;
      } else if (next.x !== active.anchor.x || next.y !== active.anchor.y) {
        drawShape(active.settings, active.anchor, next);
        active.changed = true;
      }
    }
    active.last = next;
    cursor = next;
    return getState();
  };

  const endStroke = () => {
    ensureActive();
    if (!stroke) return getState();
    const active = stroke;
    if (active.changed) {
      pushState();
    } else {
      context.putImageData(active.baseline, 0, 0);
    }
    stroke = null;
    return getState();
  };

  const undo = () => {
    ensureActive();
    if (stroke) return cancelStroke();
    if (index <= 0) return false;
    index -= 1;
    restore();
    return true;
  };

  const redo = () => {
    ensureActive();
    if (stroke) {
      cancelStroke();
      return false;
    }
    if (index >= states.length - 1) return false;
    index += 1;
    restore();
    return true;
  };

  const clear = () => {
    ensureActive();
    if (stroke) cancelStroke();
    fillBackground();
    pushState();
    return getState();
  };

  const initializeFromImage = (source) => {
    ensureActive();
    if (stroke) cancelStroke();
    fillBackground();
    const fit = drawImageFitted(source);
    states = [capture()];
    index = 0;
    return fit;
  };

  const loadImage = (source) => {
    ensureActive();
    if (stroke) cancelStroke();
    const fit = drawImageFitted(source);
    pushState();
    return fit;
  };

  const stampAtCursor = (stampOptions = {}) => {
    ensureActive();
    const stamp = requireObject(stampOptions, "stamp options");
    if (stroke) cancelStroke();
    const settingsAtStroke = Object.freeze({ tool, color, lineWidth });
    if (tool === "brush" || tool === "eraser" || tool === "line") {
      drawDot(settingsAtStroke, cursor);
    } else {
      const size = stamp.size === undefined ? Math.max(16, lineWidth * 6) : requireFinite(stamp.size, "stamp.size");
      if (size <= 0) throw new RangeError("stamp.size must be positive");
      const half = Math.max(1, Math.floor(size / 2));
      const from = clampCanvasPoint({ x: cursor.x - half, y: cursor.y - half }, width, height);
      const to = clampCanvasPoint({ x: cursor.x + half, y: cursor.y + half }, width, height);
      drawShape(settingsAtStroke, from, to);
    }
    pushState();
    return getState();
  };

  const pointFromEvent = (event, rect) => {
    ensureActive();
    const box =
      rect ??
      (typeof canvas.getBoundingClientRect === "function"
        ? canvas.getBoundingClientRect()
        : undefined);
    if (!box) throw new TypeError("pointFromEvent needs a rect for this canvas");
    return scalePointerFromRect(event, box, width, height);
  };

  const toBlob = async () => {
    ensureActive();
    if (typeof canvas.toBlob === "function") {
      return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("PNG encoding failed"));
        }, PNG_MEDIA_TYPE);
      });
    }
    if (typeof canvas.convertToBlob === "function") {
      return await canvas.convertToBlob({ type: PNG_MEDIA_TYPE });
    }
    throw new Error("This canvas cannot export a Blob");
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stroke = null;
    states = [];
    index = 0;
  };

  fillBackground();
  states = [capture()];
  index = 0;

  return Object.freeze({
    canvas,
    getState,
    setTool,
    setColor,
    setLineWidth,
    setCursor,
    moveCursor,
    beginStroke,
    extendStroke,
    endStroke,
    cancelStroke,
    undo,
    redo,
    clear,
    initializeFromImage,
    loadImage,
    stampAtCursor,
    pointFromEvent,
    toBlob,
    dispose,
  });
}
