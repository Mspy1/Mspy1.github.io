/* Import boundary for file-picker images (plan §4 Import/export).
   Dependency-free, decoder-free header inspection runs first; a real decode is
   a separate, scoped step that re-checks the decoded dimensions.

   Scope: PNG, JPEG and WebP up to 10 MiB and 4096 pixels per side.
   APNG, animated WebP, malformed/truncated containers and active content types
   are rejected before any browser decode. Inspection reads bounded headers and
   chunk metadata, never the whole payload and never an image decoder. */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 4096;

export const SUPPORTED_IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);

export const IMPORT_CODES = Object.freeze({
  EMPTY_FILE: "EMPTY_FILE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  UNSUPPORTED_TYPE: "UNSUPPORTED_TYPE",
  MALFORMED_IMAGE: "MALFORMED_IMAGE",
  TRUNCATED_IMAGE: "TRUNCATED_IMAGE",
  ANIMATED_IMAGE: "ANIMATED_IMAGE",
  DIMENSIONS_TOO_LARGE: "DIMENSIONS_TOO_LARGE",
  INVALID_DIMENSIONS: "INVALID_DIMENSIONS",
  DECODE_FAILED: "DECODE_FAILED",
  DECODE_DIMENSION_MISMATCH: "DECODE_DIMENSION_MISMATCH",
  DECODE_UNAVAILABLE: "DECODE_UNAVAILABLE",
  ABORTED: "ABORTED",
});

const CODES = IMPORT_CODES;
const FORMATS = Object.freeze({
  png: Object.freeze({ mediaType: "image/png", extension: "png" }),
  jpeg: Object.freeze({ mediaType: "image/jpeg", extension: "jpg" }),
  webp: Object.freeze({ mediaType: "image/webp", extension: "webp" }),
});

/* Types that a browser could execute or render actively. They are never
   accepted, even when the bytes happen to look like an image. */
const ACTIVE_MEDIA_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/ecmascript",
  "application/x-shockwave-flash",
]);

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_CHUNKS = 100_000;
const MAX_JPEG_SEGMENTS = 20_000;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export class ImportError extends Error {
  constructor(code, message, { cause, details } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ImportError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const isImportError = (value) => value instanceof ImportError;

const fail = (code, message, extra) => new ImportError(code, message, extra);

const text = (bytes) => String.fromCharCode(...bytes);

const startsWith = (bytes, signature) =>
  bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);

/* CRC32 lookup table, built once; only the 17-byte IHDR needs a checksum. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32Parts(...parts) {
  let value = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

const isBlobLike = (value) =>
  Boolean(
    value &&
      typeof value === "object" &&
      typeof value.size === "number" &&
      typeof value.slice === "function" &&
      typeof value.arrayBuffer === "function",
  );

function sourceSize(source) {
  if (!source || typeof source !== "object") return null;
  if (source instanceof ArrayBuffer) return source.byteLength;
  if (ArrayBuffer.isView(source)) return source.byteLength;
  if (isBlobLike(source)) return source.size;
  return null;
}

/* Reads are explicit slices: Blob sources are sliced, buffers are subarrays.
   No path materializes the full payload. */
function createReader(source) {
  if (isBlobLike(source)) {
    return {
      size: source.size,
      async read(offset, length) {
        const end = Math.min(source.size, offset + length);
        if (offset >= source.size || end <= offset) return new Uint8Array(0);
        const view = await source.slice(offset, end).arrayBuffer();
        return new Uint8Array(view);
      },
    };
  }
  const bytes =
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      const end = Math.min(bytes.byteLength, offset + length);
      if (offset >= bytes.byteLength || end <= offset) return new Uint8Array(0);
      return bytes.subarray(offset, end);
    },
  };
}

function declaredTypeOf(options) {
  if (typeof options === "string") return options.trim().toLowerCase();
  const value = options?.declaredType ?? options?.type;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

const u16 = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1];
const u16le = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
const u32be = (bytes, offset) =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
const u32le = (bytes, offset) =>
  (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
const u24le = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);

function assertDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw fail(CODES.INVALID_DIMENSIONS, "The image reports an invalid width or height.");
  }
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    throw fail(
      CODES.DIMENSIONS_TOO_LARGE,
      `Images can be at most ${MAX_IMAGE_SIDE} x ${MAX_IMAGE_SIDE} pixels; this one is ${width} x ${height}.`,
      { width, height },
    );
  }
}

async function sniffFormat(reader) {
  const head = await reader.read(0, Math.min(reader.size, 16));
  if (startsWith(head, PNG_SIGNATURE)) return "png";
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xd8) return "jpeg";
  if (head.length >= 12 && text(head.subarray(0, 4)) === "RIFF" && text(head.subarray(8, 12)) === "WEBP") {
    return "webp";
  }
  throw fail(
    CODES.UNSUPPORTED_TYPE,
    "Choose a PNG, JPEG or WebP image. Other file types are not supported.",
    { header: text(head.subarray(0, 12)) },
  );
}

async function parsePng(reader) {
  let offset = 8;
  let first = true;
  let width = 0;
  let height = 0;
  let animated = false;
  let sawEnd = false;

  if (reader.size <= 8) throw fail(CODES.TRUNCATED_IMAGE, "The PNG ends before its image header.");

  for (let index = 0; index < MAX_CHUNKS; index++) {
    if (offset >= reader.size) break;
    if (offset + 8 > reader.size) {
      throw fail(CODES.TRUNCATED_IMAGE, "The PNG ends before its image header or end marker.");
    }
    const header = await reader.read(offset, 8);
    if (header.length < 8) throw fail(CODES.TRUNCATED_IMAGE, "The PNG chunk header is incomplete.");
    const length = u32be(header, 0);
    const type = text(header.subarray(4, 8));
    if (length > 0x7fffffff || !/^[A-Za-z]{4}$/.test(type)) {
      throw fail(CODES.MALFORMED_IMAGE, "The PNG has an invalid chunk header.");
    }
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > reader.size) {
      throw fail(CODES.TRUNCATED_IMAGE, `The PNG's ${type} chunk extends past the end of the file.`);
    }

    if (first) {
      if (type !== "IHDR" || length !== 13) {
        throw fail(CODES.MALFORMED_IMAGE, "A PNG must begin with a 13-byte IHDR chunk.");
      }
      const ihdr = await reader.read(offset + 8, 17);
      if (ihdr.length < 17) throw fail(CODES.TRUNCATED_IMAGE, "The PNG image header is incomplete.");
      const stored = u32be(ihdr, 13);
      const actual = crc32Parts(header.subarray(4, 8), ihdr.subarray(0, 13));
      if (stored !== actual) {
        throw fail(CODES.MALFORMED_IMAGE, "The PNG image header checksum does not match.");
      }
      width = u32be(ihdr, 0);
      height = u32be(ihdr, 4);
      const bitDepth = ihdr[8];
      const colorType = ihdr[9];
      const allowedDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!allowedDepths[colorType]?.includes(bitDepth) || ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] > 1) {
        throw fail(CODES.MALFORMED_IMAGE, "The PNG image header uses unsupported values.");
      }
      assertDimensions(width, height);
      first = false;
    } else {
      if (type === "IHDR") throw fail(CODES.MALFORMED_IMAGE, "The PNG has more than one image header.");
      if (type === "acTL") animated = true;
    }

    if (type === "IEND") {
      if (length !== 0) throw fail(CODES.MALFORMED_IMAGE, "The PNG end marker is malformed.");
      sawEnd = true;
      break;
    }
    offset = chunkEnd;
  }

  if (animated) {
    throw fail(CODES.ANIMATED_IMAGE, "Animated PNGs (APNG) are not supported. Export a single frame instead.");
  }
  if (!sawEnd) throw fail(CODES.MALFORMED_IMAGE, "The PNG is missing its IEND end marker.");
  return { width, height };
}

async function readJpegOrientation(reader, start, end) {
  if (end - start < 14) return null;
  const header = await reader.read(start, 14);
  if (!startsWith(header, [0x45, 0x78, 0x69, 0x66, 0, 0])) return null;
  const byteOrder = u16(header, 6);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  const littleEndian = byteOrder === 0x4949;
  const tiff = new DataView(header.buffer, header.byteOffset + 6, 8);
  if (tiff.getUint16(2, littleEndian) !== 42) return null;
  const offset = tiff.getUint32(4, littleEndian);
  const directory = start + 6 + offset;
  if (offset < 8 || directory + 2 > end) return null;
  const countBytes = await reader.read(directory, 2);
  const count = new DataView(countBytes.buffer, countBytes.byteOffset, 2).getUint16(0, littleEndian);
  // The entire table is bounded by this APP1 segment (JPEG segment lengths are 16-bit).
  if (directory + 2 + count * 12 > end) return null;
  const entries = await reader.read(directory + 2, count * 12);
  const view = new DataView(entries.buffer, entries.byteOffset, entries.byteLength);
  for (let i = 0; i < view.byteLength; i += 12) {
    if (view.getUint16(i, littleEndian) !== 0x0112) continue;
    if (view.getUint16(i + 2, littleEndian) !== 3 || view.getUint32(i + 4, littleEndian) !== 1) return null;
    const value = view.getUint16(i + 8, littleEndian);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

async function parseJpeg(reader) {
  if (reader.size < 4) throw fail(CODES.TRUNCATED_IMAGE, "The JPEG is too short.");
  let offset = 2;
  let frame = null;
  let sawScan = false;
  let orientation = null;

  for (let index = 0; index < MAX_JPEG_SEGMENTS; index++) {
    if (offset >= reader.size) break;
    if (offset + 2 > reader.size) {
      throw fail(CODES.TRUNCATED_IMAGE, "The JPEG ends before its start of scan.");
    }
    const pair = await reader.read(offset, 2);
    if (pair[0] !== 0xff) throw fail(CODES.MALFORMED_IMAGE, "The JPEG marker structure is invalid.");
    const marker = pair[1];

    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x00) throw fail(CODES.MALFORMED_IMAGE, "The JPEG marker structure is invalid.");
    if (marker === 0xd8) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    if (offset + 4 > reader.size) throw fail(CODES.TRUNCATED_IMAGE, "The JPEG segment length is missing.");
    const lengthBytes = await reader.read(offset + 2, 2);
    const length = u16(lengthBytes, 0);
    if (length < 2) throw fail(CODES.MALFORMED_IMAGE, "The JPEG has an empty segment.");
    const segmentEnd = offset + 2 + length;
    if (segmentEnd > reader.size) {
      throw fail(CODES.TRUNCATED_IMAGE, "A JPEG segment extends past the end of the file.");
    }

    if (marker === 0xe1 && orientation === null) {
      orientation = await readJpegOrientation(reader, offset + 4, segmentEnd);
    }
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (frame) throw fail(CODES.MALFORMED_IMAGE, "The JPEG contains more than one image frame.");
      if (length < 8) throw fail(CODES.MALFORMED_IMAGE, "The JPEG frame header is too short.");
      const payload = await reader.read(offset + 4, 6);
      if (payload.length < 6) throw fail(CODES.TRUNCATED_IMAGE, "The JPEG frame header is incomplete.");
      const precision = payload[0];
      const height = u16(payload, 1);
      const width = u16(payload, 3);
      const components = payload[5];
      if (precision === 0 || components === 0) {
        throw fail(CODES.MALFORMED_IMAGE, "The JPEG frame header uses unsupported values.");
      }
      assertDimensions(width, height);
      frame = { width, height };
    }

    if (marker === 0xda) {
      if (!frame) throw fail(CODES.MALFORMED_IMAGE, "The JPEG has a scan before its frame header.");
      sawScan = true;
      break;
    }
    offset = segmentEnd;
  }

  if (!frame) throw fail(CODES.MALFORMED_IMAGE, "The JPEG has no image frame header.");
  if (!sawScan) throw fail(CODES.MALFORMED_IMAGE, "The JPEG has no start of scan.");
  // Decoders display the oriented image; both raw sides were already checked above.
  if (orientation !== null && orientation >= 5) return { width: frame.height, height: frame.width };
  return frame;
}

async function parseWebp(reader) {
  if (reader.size < 12) throw fail(CODES.TRUNCATED_IMAGE, "The WebP header is incomplete.");
  const head = await reader.read(0, 12);
  const riffSize = u32le(head, 4);
  if (riffSize < 4) throw fail(CODES.MALFORMED_IMAGE, "The WebP container size is invalid.");
  const end = riffSize + 8;
  if (end > reader.size) throw fail(CODES.TRUNCATED_IMAGE, "The WebP container is shorter than it declares.");

  let offset = 12;
  let canvas = null;
  let frame = null;
  let animated = false;
  let chunks = 0;

  while (offset + 8 <= end) {
    if (++chunks > MAX_CHUNKS) throw fail(CODES.MALFORMED_IMAGE, "The WebP has too many chunks.");
    const header = await reader.read(offset, 8);
    const fourcc = text(header.subarray(0, 4));
    const length = u32le(header, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > end) throw fail(CODES.TRUNCATED_IMAGE, `The WebP's ${fourcc} chunk extends past the container.`);

    if (fourcc === "ANIM" || fourcc === "ANMF") animated = true;

    if (fourcc === "VP8X") {
      if (length !== 10 || canvas || offset !== 12) {
        throw fail(CODES.MALFORMED_IMAGE, "The WebP extended header is invalid.");
      }
      const payload = await reader.read(dataStart, 10);
      if (payload[0] & 0x02) animated = true;
      const width = u24le(payload, 4) + 1;
      const height = u24le(payload, 7) + 1;
      canvas = { width, height };
    } else if (fourcc === "VP8 ") {
      if (frame) throw fail(CODES.MALFORMED_IMAGE, "The WebP contains more than one image frame.");
      if (length < 10) throw fail(CODES.MALFORMED_IMAGE, "The WebP lossy frame header is too short.");
      const payload = await reader.read(dataStart, 10);
      if ((payload[0] & 0x01) !== 0 || payload[3] !== 0x9d || payload[4] !== 0x01 || payload[5] !== 0x2a) {
        throw fail(CODES.MALFORMED_IMAGE, "The WebP lossy frame header is invalid.");
      }
      const width = u16le(payload, 6) & 0x3fff;
      const height = u16le(payload, 8) & 0x3fff;
      frame = { width, height };
    } else if (fourcc === "VP8L") {
      if (frame) throw fail(CODES.MALFORMED_IMAGE, "The WebP contains more than one image frame.");
      if (length < 5) throw fail(CODES.MALFORMED_IMAGE, "The WebP lossless frame header is too short.");
      const payload = await reader.read(dataStart, 5);
      if (payload[0] !== 0x2f) throw fail(CODES.MALFORMED_IMAGE, "The WebP lossless frame header is invalid.");
      const width = ((payload[1] | (payload[2] << 8)) & 0x3fff) + 1;
      const height = (((payload[2] >> 6) | (payload[3] << 2) | (payload[4] << 10)) & 0x3fff) + 1;
      frame = { width, height };
    }

    offset = dataEnd + (length & 1);
    if (offset > end) {
      if (dataEnd === end) offset = end;
      else throw fail(CODES.TRUNCATED_IMAGE, "The WebP chunk padding is missing.");
    }
  }

  if (animated) {
    throw fail(CODES.ANIMATED_IMAGE, "Animated WebP images are not supported. Export a still image instead.");
  }
  if (!frame) throw fail(CODES.MALFORMED_IMAGE, "The WebP contains no image data.");
  assertDimensions(frame.width, frame.height);
  if (canvas) {
    assertDimensions(canvas.width, canvas.height);
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      throw fail(CODES.MALFORMED_IMAGE, "The WebP chunks disagree about the canvas size.");
    }
  }
  return frame;
}

/**
 * Validate an image chosen in a file picker, without decoding it.
 *
 * source: File | Blob | ArrayBuffer | ArrayBufferView
 * options: { declaredType?: string }
 *
 * Resolves to a frozen summary:
 *   { mediaType, type, extension, width, height, size, animated: false }
 * Throws ImportError with a code from IMPORT_CODES on every rejection.
 */
export async function inspectImage(source, options = {}) {
  const size = sourceSize(source);
  if (size === null) {
    throw new TypeError("inspectImage needs a File, Blob or byte buffer.");
  }

  const declaredType = declaredTypeOf(options);
  if (declaredType && ACTIVE_MEDIA_TYPES.has(declaredType)) {
    throw fail(
      CODES.UNSUPPORTED_TYPE,
      "That file type can run active content, so it is not accepted. Choose a PNG, JPEG or WebP image.",
    );
  }

  if (size === 0) throw fail(CODES.EMPTY_FILE, "That file is empty.");
  if (size > MAX_IMAGE_BYTES) {
    throw fail(
      CODES.FILE_TOO_LARGE,
      `Images can be at most ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MiB; that file is ${(size / (1024 * 1024)).toFixed(1)} MiB.`,
      { size },
    );
  }

  const reader = createReader(source);
  const format = await sniffFormat(reader);
  const dimensions = format === "png" ? await parsePng(reader) : format === "jpeg" ? await parseJpeg(reader) : await parseWebp(reader);
  const definition = FORMATS[format];

  return Object.freeze({
    mediaType: definition.mediaType,
    type: format,
    extension: definition.extension,
    width: dimensions.width,
    height: dimensions.height,
    size,
    animated: false,
  });
}

/** The plan's `inspect(file)` name. */
export const inspect = inspectImage;

function toBlob(source, mediaType) {
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return source.type ? source : new Blob([source], { type: mediaType || "" });
  }
  if (isBlobLike(source)) return source;
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    return new Blob([source], { type: mediaType || "" });
  }
  throw new TypeError("decodeImage needs a Blob, File or byte buffer.");
}

function throwIfAborted(signal, image) {
  if (!signal?.aborted) return;
  image?.close?.();
  throw fail(CODES.ABORTED, "Image loading was cancelled.");
}

const defaultBitmapDecoder = () =>
  typeof globalThis.createImageBitmap === "function" ? globalThis.createImageBitmap.bind(globalThis) : null;

/**
 * Decode a previously inspected image and verify the decoded dimensions.
 *
 * decodeImage(blob, validation, {
 *   createImageBitmap?, document?, createObjectURL?, revokeObjectURL?,
 *   signal?, verifyDimensions? = true,
 * }) → Promise<{ image, width, height, release() }>
 *
 * `validation` is the result of inspectImage(). The preferred path uses
 * createImageBitmap; the fallback uses an <img> with an owned Blob URL that is
 * always revoked. release() closes a bitmap exactly once; <img> URLs are
 * already revoked before this resolves. Aborts close any created bitmap.
 */
export async function decodeImage(source, validation, options = {}) {
  if (
    !validation ||
    !Number.isInteger(validation.width) ||
    !Number.isInteger(validation.height) ||
    validation.width < 1 ||
    validation.height < 1
  ) {
    throw new TypeError("decodeImage needs the validation result from inspectImage().");
  }

  const { signal } = options;
  throwIfAborted(signal);
  const blob = toBlob(source, validation.mediaType);

  const createBitmap = hasOwn(options, "createImageBitmap") ? options.createImageBitmap : defaultBitmapDecoder();
  const documentRef = hasOwn(options, "document") ? options.document : globalThis.document;
  const createObjectURL = hasOwn(options, "createObjectURL")
    ? options.createObjectURL
    : globalThis.URL?.createObjectURL?.bind(globalThis.URL);
  const revokeObjectURL = hasOwn(options, "revokeObjectURL")
    ? options.revokeObjectURL
    : globalThis.URL?.revokeObjectURL?.bind(globalThis.URL);
  const verifyDimensions = options.verifyDimensions !== false;

  const verify = (image, width, height) => {
    if (!verifyDimensions) return;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      image?.close?.();
      throw fail(CODES.DECODE_FAILED, "The decoder returned no image.");
    }
    if (width !== validation.width || height !== validation.height) {
      image?.close?.();
      throw fail(
        CODES.DECODE_DIMENSION_MISMATCH,
        `The decoded image is ${width} x ${height}, but its header said ${validation.width} x ${validation.height}.`,
        { expected: { width: validation.width, height: validation.height }, actual: { width, height } },
      );
    }
  };

  const handle = (image, width, height, close) => {
    let released = false;
    return Object.freeze({
      image,
      width,
      height,
      release() {
        if (released) return;
        released = true;
        close?.();
      },
    });
  };

  if (typeof createBitmap === "function") {
    let image;
    try {
      image = await createBitmap(blob);
    } catch (error) {
      if (signal?.aborted) throw fail(CODES.ABORTED, "Image loading was cancelled.", { cause: error });
      throw fail(CODES.DECODE_FAILED, "This image could not be decoded. It may be damaged or use an unsupported feature.", {
        cause: error,
      });
    }
    throwIfAborted(signal, image);
    verify(image, Number(image?.width), Number(image?.height));
    return handle(image, Number(image.width), Number(image.height), () => image?.close?.());
  }

  if (
    documentRef &&
    typeof documentRef.createElement === "function" &&
    typeof createObjectURL === "function" &&
    typeof revokeObjectURL === "function"
  ) {
    const url = createObjectURL(blob);
    try {
      const image = documentRef.createElement("img");
      image.src = url;
      try {
        if (typeof image.decode === "function") {
          await image.decode();
        } else {
          await new Promise((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("The image element failed to load."));
          });
        }
      } catch (error) {
        if (signal?.aborted) throw fail(CODES.ABORTED, "Image loading was cancelled.", { cause: error });
        throw fail(CODES.DECODE_FAILED, "This image could not be decoded. It may be damaged or use an unsupported feature.", {
          cause: error,
        });
      }
      throwIfAborted(signal);
      const width = Number(image.naturalWidth ?? image.width);
      const height = Number(image.naturalHeight ?? image.height);
      verify(image, width, height);
      return handle(image, width, height, null);
    } finally {
      revokeObjectURL(url);
    }
  }

  throw fail(CODES.DECODE_UNAVAILABLE, "This browser cannot decode images for preview.");
}
