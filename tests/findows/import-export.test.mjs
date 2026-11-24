/* Gate 3/5: image import validation and scoped decode.
   Fixtures are byte-built locally (PNG/JPEG/WebP headers, chunk structure and
   dimensions); nothing is fetched and no native image decoder runs for
   inspection. `node:zlib` only builds the PNG IDAT payload for test fixtures. */
import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import {
  IMPORT_CODES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIDE,
  SUPPORTED_IMAGE_TYPES,
  ImportError,
  decodeImage,
  inspect,
  inspectImage,
  isImportError,
} from "../../findows/js/import-export.mjs";

const ascii = (text) => Uint8Array.from([...text].map((character) => character.charCodeAt(0)));
const u16be = (value) => Uint8Array.of((value >>> 8) & 0xff, value & 0xff);
const u16le = (value) => Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
const u24le = (value) => Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff);
const u32be = (value) =>
  Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
const u32le = (value) =>
  Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);

function concat(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function pngChunk(type, data) {
  const body = concat(ascii(type), data);
  return concat(u32be(data.length), body, u32be(crc32(body)));
}

function pngIhdr({ width, height, bitDepth = 8, colorType = 6 }) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = bitDepth;
  header[9] = colorType;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return header;
}

/* A real, decodable RGBA PNG for small dimensions; the structure is what the
   validator inspects. `omitEnd`/`chunks` cover malformed variants. */
function makePng({
  width = 4,
  height = 3,
  animated = false,
  chunks = null,
  bitDepth = 8,
  colorType = 6,
  corruptCrc = false,
} = {}) {
  const ihdr = pngChunk("IHDR", pngIhdr({ width, height, bitDepth, colorType }));
  if (corruptCrc) ihdr[ihdr.length - 1] ^= 0xff;
  if (chunks) return concat(PNG_SIGNATURE, ihdr, ...chunks);
  const pixelData = new Uint8Array(height * (width * 4 + 1));
  const parts = [PNG_SIGNATURE, ihdr];
  if (animated) parts.push(pngChunk("acTL", concat(u32be(2), u32be(0))));
  parts.push(pngChunk("IDAT", deflateSync(pixelData)));
  parts.push(pngChunk("IEND", new Uint8Array(0)));
  return concat(...parts);
}

function jpegSegment(marker, payload) {
  return concat(Uint8Array.of(0xff, marker), u16be(payload.length + 2), payload);
}

/* Structurally valid baseline/progressive JPEG header through SOS. The entropy
   tail is irrelevant to header validation and no decoder is invoked. */
function makeJpeg({
  width = 8,
  height = 6,
  progressive = false,
  includeSof = true,
  includeSos = true,
  soWidth = width,
  soHeight = height,
  truncate = false,
} = {}) {
  const app0 = jpegSegment(0xe0, concat(ascii("JFIF\0"), Uint8Array.of(1, 1, 0, 0, 1, 0, 1, 0, 0)));
  const sof = jpegSegment(
    progressive ? 0xc2 : 0xc0,
    concat(Uint8Array.of(8), u16be(soHeight), u16be(soWidth), Uint8Array.of(1, 1, 0x11, 0)),
  );
  const sos = jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0));
  const parts = [Uint8Array.of(0xff, 0xd8), app0];
  if (includeSof) parts.push(sof);
  if (includeSos) parts.push(concat(sos, Uint8Array.of(0x12, 0x34, 0xff, 0xd9)));
  const file = concat(...parts);
  return truncate ? file.slice(0, file.length - 2) : file;
}

function riffChunk(fourcc, payload) {
  const padded = payload.length % 2 ? concat(payload, Uint8Array.of(0)) : payload;
  return concat(ascii(fourcc), u32le(payload.length), padded);
}

function vp8lPayload({ width, height }) {
  const widthBits = width - 1;
  const heightBits = height - 1;
  return Uint8Array.of(
    0x2f,
    widthBits & 0xff,
    ((widthBits >>> 8) & 0x3f) | ((heightBits & 0x03) << 6),
    (heightBits >>> 2) & 0xff,
    (heightBits >>> 10) & 0x0f,
  );
}

function vp8Payload({ width, height }) {
  return concat(Uint8Array.of(0, 0, 0, 0x9d, 0x01, 0x2a), u16le(width & 0x3fff), u16le(height & 0x3fff));
}

function vp8xPayload({ width, height, animated = false }) {
  return concat(Uint8Array.of(animated ? 0x02 : 0x00, 0, 0, 0), u24le(width - 1), u24le(height - 1));
}

function makeWebp({ width = 32, height = 20, format = "VP8L", animated = false, chunks = null } = {}) {
  let body;
  if (chunks) {
    body = concat(ascii("WEBP"), ...chunks);
  } else if (format === "VP8X") {
    const parts = [riffChunk("VP8X", vp8xPayload({ width, height, animated }))];
    if (animated) parts.push(riffChunk("ANIM", Uint8Array.of(0, 0, 0, 0, 0, 0)));
    parts.push(riffChunk("VP8L", vp8lPayload({ width, height })));
    body = concat(ascii("WEBP"), ...parts);
  } else if (format === "VP8") {
    body = concat(ascii("WEBP"), riffChunk("VP8 ", vp8Payload({ width, height })));
  } else {
    body = concat(ascii("WEBP"), riffChunk("VP8L", vp8lPayload({ width, height })));
  }
  return concat(ascii("RIFF"), u32le(body.length), body);
}

/* A Blob-like source that records how much of the file inspection reads. */
function spySource(bytes) {
  const state = { maxEnd: 0, calls: 0, fullReadAttempts: 0 };
  return {
    state,
    ...{
      size: bytes.length,
      slice(start, end) {
        state.calls++;
        state.maxEnd = Math.max(state.maxEnd, end);
        return new Blob([bytes.slice(start, end)]);
      },
      arrayBuffer() {
        state.fullReadAttempts++;
        throw new Error("inspection must not read the whole file");
      },
    },
  };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ImportError, `expected ImportError, got ${error}`);
    assert.equal(error.code, code);
    assert.equal(isImportError(error), true);
    assert.ok(error.message.length > 0);
    return true;
  });
}

test("limits and supported image types are explicit and frozen", () => {
  assert.equal(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_IMAGE_SIDE, 4096);
  assert.deepEqual([...SUPPORTED_IMAGE_TYPES], ["image/png", "image/jpeg", "image/webp"]);
  assert.ok(Object.isFrozen(SUPPORTED_IMAGE_TYPES));
  assert.ok(Object.isFrozen(IMPORT_CODES));
  assert.equal(inspect, inspectImage, "the plan's inspect(file) name is available");
});

test("valid PNG, JPEG and WebP headers expose the dimensions and detected type", async () => {
  const png = await inspectImage(makePng({ width: 4, height: 3 }));
  assert.deepEqual(
    { ...png },
    { mediaType: "image/png", type: "png", extension: "png", width: 4, height: 3, size: png.size, animated: false },
  );
  assert.equal(png.size, makePng({ width: 4, height: 3 }).length);
  assert.ok(Object.isFrozen(png));

  const jpeg = await inspectImage(new Blob([makeJpeg({ width: 8, height: 6 })]));
  assert.equal(jpeg.mediaType, "image/jpeg");
  assert.equal(jpeg.type, "jpeg");
  assert.equal(jpeg.extension, "jpg");
  assert.equal(jpeg.width, 8);
  assert.equal(jpeg.height, 6);

  const progressive = await inspectImage(makeJpeg({ width: 7, height: 5, progressive: true }));
  assert.deepEqual([progressive.width, progressive.height], [7, 5]);

  const lossless = await inspectImage(makeWebp({ width: 32, height: 20, format: "VP8L" }));
  assert.equal(lossless.mediaType, "image/webp");
  assert.equal(lossless.type, "webp");
  assert.equal(lossless.extension, "webp");
  assert.deepEqual([lossless.width, lossless.height], [32, 20]);

  const lossy = await inspectImage(makeWebp({ width: 41, height: 17, format: "VP8" }));
  assert.deepEqual([lossy.width, lossy.height], [41, 17]);

  const extended = await inspectImage(makeWebp({ width: 64, height: 48, format: "VP8X" }));
  assert.deepEqual([extended.width, extended.height], [64, 48]);
});

test("phone JPEGs with rotated EXIF metadata use display dimensions without weakening validation", async () => {
  const original = makeJpeg({ width: 120, height: 80 });
  for (const littleEndian of [false, true]) {
    for (const orientation of [1, 5, 6, 7, 8]) {
      const tiff = new Uint8Array(26);
      const view = new DataView(tiff.buffer);
      tiff.fill(littleEndian ? 0x49 : 0x4d, 0, 2);
      view.setUint16(2, 42, littleEndian);
      view.setUint32(4, 8, littleEndian);
      view.setUint16(8, 1, littleEndian);
      view.setUint16(10, 0x0112, littleEndian);
      view.setUint16(12, 3, littleEndian);
      view.setUint32(14, 1, littleEndian);
      view.setUint16(18, orientation, littleEndian);
      const exif = concat(ascii("Exif"), Uint8Array.of(0, 0), tiff);
      const length = exif.length + 2;
      const jpeg = concat(original.subarray(0, 2), Uint8Array.of(0xff, 0xe1, length >> 8, length & 255), exif, original.subarray(2));
      const expected = orientation === 1 ? [120, 80] : [80, 120];
      const info = await inspectImage(jpeg);
      assert.deepEqual([info.width, info.height], expected);
      const decoded = await decodeImage(jpeg, info, {
        createImageBitmap: async () => ({ width: expected[0], height: expected[1], close() {} }),
      });
      assert.deepEqual([decoded.width, decoded.height], expected);
      decoded.release();
    }
  }
  const unrotated = await inspectImage(original);
  await rejectsWith(decodeImage(original, unrotated, {
    createImageBitmap: async () => ({ width: 80, height: 120, close() {} }),
  }), IMPORT_CODES.DECODE_DIMENSION_MISMATCH);
});

test("inspection never invokes a browser image decoder", async () => {
  const original = globalThis.createImageBitmap;
  let calls = 0;
  globalThis.createImageBitmap = () => {
    calls++;
    throw new Error("decoder must not run during inspection");
  };
  try {
    const result = await inspectImage(makePng({ width: 2, height: 2 }));
    assert.equal(result.width, 2);
    assert.equal(calls, 0);
  } finally {
    if (original === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = original;
  }
});

test("the 4096-pixel side limit is inclusive and a larger side is rejected", async () => {
  const atLimit = await inspectImage(makePng({ width: 4096, height: 1 }));
  assert.equal(atLimit.width, 4096);
  await rejectsWith(inspectImage(makePng({ width: 4097, height: 1 })), IMPORT_CODES.DIMENSIONS_TOO_LARGE);
  await rejectsWith(inspectImage(makeJpeg({ width: 4097, height: 2 })), IMPORT_CODES.DIMENSIONS_TOO_LARGE);
  await rejectsWith(inspectImage(makeWebp({ width: 10, height: 4097 })), IMPORT_CODES.DIMENSIONS_TOO_LARGE);
});

test("APNG and animated WebP are rejected before any decode", async () => {
  await rejectsWith(inspectImage(makePng({ animated: true })), IMPORT_CODES.ANIMATED_IMAGE);
  await rejectsWith(
    inspectImage(makeWebp({ animated: true, format: "VP8X" })),
    IMPORT_CODES.ANIMATED_IMAGE,
  );
  const animChunk = [
    riffChunk("VP8X", vp8xPayload({ width: 8, height: 8 })),
    riffChunk("ANIM", Uint8Array.of(0, 0, 0, 0, 0, 0)),
    riffChunk("VP8L", vp8lPayload({ width: 8, height: 8 })),
  ];
  await rejectsWith(inspectImage(makeWebp({ chunks: animChunk })), IMPORT_CODES.ANIMATED_IMAGE);
});

test("malformed and truncated PNG structures fail with named errors", async () => {
  const good = makePng({ width: 3, height: 2 });

  const badSignature = good.slice();
  badSignature[0] = 0x00;
  await rejectsWith(inspectImage(badSignature), IMPORT_CODES.UNSUPPORTED_TYPE);

  await rejectsWith(inspectImage(makePng({ corruptCrc: true })), IMPORT_CODES.MALFORMED_IMAGE);
  await rejectsWith(
    inspectImage(makePng({ chunks: [pngChunk("IDAT", deflateSync(new Uint8Array(0)))] })),
    IMPORT_CODES.MALFORMED_IMAGE,
    "PNG without IEND",
  );
  await rejectsWith(inspectImage(makePng({ width: 0, height: 2 })), IMPORT_CODES.INVALID_DIMENSIONS);
  await rejectsWith(inspectImage(makePng({ height: 0 })), IMPORT_CODES.INVALID_DIMENSIONS);
  await rejectsWith(inspectImage(good.slice(0, 20)), IMPORT_CODES.TRUNCATED_IMAGE);
  await rejectsWith(inspectImage(good.slice(0, 8)), IMPORT_CODES.TRUNCATED_IMAGE);

  const firstChunkNotIhdr = concat(
    PNG_SIGNATURE,
    pngChunk("tEXt", ascii("a\0b")),
    pngChunk("IHDR", pngIhdr({ width: 2, height: 2 })),
    pngChunk("IEND", new Uint8Array(0)),
  );
  await rejectsWith(inspectImage(firstChunkNotIhdr), IMPORT_CODES.MALFORMED_IMAGE);

  const badBitDepth = makePng({ width: 2, height: 2, bitDepth: 3, colorType: 6 });
  await rejectsWith(inspectImage(badBitDepth), IMPORT_CODES.MALFORMED_IMAGE);
});

test("malformed JPEG structures fail with named errors", async () => {
  await rejectsWith(inspectImage(makeJpeg({ includeSof: false })), IMPORT_CODES.MALFORMED_IMAGE);
  await rejectsWith(inspectImage(makeJpeg({ includeSos: false })), IMPORT_CODES.MALFORMED_IMAGE);
  await rejectsWith(inspectImage(makeJpeg({ soWidth: 0 })), IMPORT_CODES.INVALID_DIMENSIONS);
  await rejectsWith(inspectImage(makeJpeg({ soHeight: 0 })), IMPORT_CODES.INVALID_DIMENSIONS);
  await rejectsWith(inspectImage(makeJpeg({ truncate: true, includeSos: false })), IMPORT_CODES.TRUNCATED_IMAGE);

  const truncatedSegment = concat(Uint8Array.of(0xff, 0xd8), Uint8Array.of(0xff, 0xe0, 0x10, 0x00, 1, 2));
  await rejectsWith(inspectImage(truncatedSegment), IMPORT_CODES.TRUNCATED_IMAGE);

  const badMarker = concat(Uint8Array.of(0xff, 0xd8), Uint8Array.of(0x00, 0x01, 0x02));
  await rejectsWith(inspectImage(badMarker), IMPORT_CODES.MALFORMED_IMAGE);
});

test("extended WebP cannot substitute canvas metadata for actual frame dimensions", async () => {
  const header = riffChunk("VP8X", vp8xPayload({ width: 32, height: 20 }));
  const oversized = riffChunk("VP8L", vp8lPayload({ width: 8192, height: 20 }));
  const mismatch = riffChunk("VP8 ", vp8Payload({ width: 32, height: 18 }));
  await rejectsWith(inspectImage(makeWebp({ chunks: [header, oversized] })), IMPORT_CODES.DIMENSIONS_TOO_LARGE);
  await rejectsWith(inspectImage(makeWebp({ chunks: [header, mismatch] })), IMPORT_CODES.MALFORMED_IMAGE);
  await rejectsWith(inspectImage(makeWebp({ chunks: [header] })), IMPORT_CODES.MALFORMED_IMAGE);
});

test("malformed WebP containers fail with named errors", async () => {
  const good = makeWebp({ width: 10, height: 10 });

  const badRiff = good.slice();
  badRiff[4] = 0xff;
  badRiff[5] = 0xff;
  await rejectsWith(inspectImage(badRiff), IMPORT_CODES.TRUNCATED_IMAGE);

  const notWebp = concat(ascii("RIFF"), u32le(4), ascii("WAVE"));
  await rejectsWith(inspectImage(notWebp), IMPORT_CODES.UNSUPPORTED_TYPE);

  const noImageChunk = concat(ascii("RIFF"), u32le(4 + 8 + 4), ascii("WEBP"), ascii("EXIF"), u32le(4), Uint8Array.of(1, 2, 3, 4));
  await rejectsWith(inspectImage(noImageChunk), IMPORT_CODES.MALFORMED_IMAGE);

  const chunkOverrun = concat(ascii("RIFF"), u32le(4 + 8 + 4), ascii("WEBP"), ascii("VP8L"), u32le(4000), Uint8Array.of(1, 2));
  await rejectsWith(inspectImage(chunkOverrun), IMPORT_CODES.TRUNCATED_IMAGE);

  const badVp8l = concat(
    ascii("RIFF"),
    u32le(4 + 8 + 4),
    ascii("WEBP"),
    ascii("VP8L"),
    u32le(4),
    Uint8Array.of(0x00, 1, 2, 3),
  );
  await rejectsWith(inspectImage(badVp8l), IMPORT_CODES.MALFORMED_IMAGE);
});

test("unsupported, empty and oversized files are rejected before decoding", async () => {
  await rejectsWith(inspectImage(new Uint8Array(0)), IMPORT_CODES.EMPTY_FILE);
  await rejectsWith(inspectImage(concat(ascii("GIF89a"), new Uint8Array(16))), IMPORT_CODES.UNSUPPORTED_TYPE);
  await rejectsWith(inspectImage(ascii("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")), IMPORT_CODES.UNSUPPORTED_TYPE);
  await rejectsWith(inspectImage(ascii("not an image at all")), IMPORT_CODES.UNSUPPORTED_TYPE);

  await rejectsWith(
    inspectImage(makePng({ width: 2, height: 2 }), { declaredType: "image/svg+xml" }),
    IMPORT_CODES.UNSUPPORTED_TYPE,
  );
  await rejectsWith(
    inspectImage(makePng({ width: 2, height: 2 }), { declaredType: "text/html" }),
    IMPORT_CODES.UNSUPPORTED_TYPE,
  );

  const oversized = { size: MAX_IMAGE_BYTES + 1, slice() {}, arrayBuffer() {} };
  await rejectsWith(inspectImage(oversized), IMPORT_CODES.FILE_TOO_LARGE);

  const exactLimit = {
    size: MAX_IMAGE_BYTES,
    slice() {
      return new Blob([new Uint8Array(12)]);
    },
    arrayBuffer() {
      throw new Error("inspection must not read the whole file");
    },
  };
  await rejectsWith(inspectImage(exactLimit), IMPORT_CODES.UNSUPPORTED_TYPE);
});

test("inspection reads only bounded headers, not the whole file", async () => {
  const huge = 1024 * 1024;
  const png = concat(makePng({ width: 5, height: 5 }), new Uint8Array(huge));
  const source = spySource(png);
  const result = await inspectImage(source);
  assert.deepEqual([result.width, result.height], [5, 5]);
  assert.equal(source.state.fullReadAttempts, 0);
  assert.ok(source.state.maxEnd < 1024, `read ${source.state.maxEnd} bytes of a 1 MiB file`);

  const jpeg = concat(makeJpeg({ width: 5, height: 5 }), new Uint8Array(huge));
  const jpegSource = spySource(jpeg);
  assert.deepEqual([(await inspectImage(jpegSource)).width], [5]);
  assert.ok(jpegSource.state.maxEnd < 1024);

  const webp = concat(makeWebp({ width: 5, height: 5 }), new Uint8Array(huge));
  const webpSource = spySource(webp);
  assert.deepEqual([(await inspectImage(webpSource)).height], [5]);
  assert.ok(webpSource.state.maxEnd < 1024);
});

test("decodeImage verifies the decoded dimensions and releases resources once", async () => {
  const validation = await inspectImage(makePng({ width: 4, height: 3 }));
  let closed = 0;
  let received = null;
  const handle = await decodeImage(new Blob([makePng({ width: 4, height: 3 })]), validation, {
    createImageBitmap: async (blob) => {
      received = blob;
      return { width: 4, height: 3, close: () => closed++ };
    },
    document: null,
  });
  assert.equal(handle.width, 4);
  assert.equal(handle.height, 3);
  assert.equal(received.type, "image/png");
  handle.release();
  handle.release();
  assert.equal(closed, 1, "release is idempotent");
});

test("decodeImage rejects a decoder that returns different dimensions and closes it", async () => {
  const validation = await inspectImage(makePng({ width: 4, height: 3 }));
  let closed = 0;
  await rejectsWith(
    decodeImage(new Blob([makePng({ width: 4, height: 3 })]), validation, {
      createImageBitmap: async () => ({ width: 400, height: 300, close: () => closed++ }),
      document: null,
    }),
    IMPORT_CODES.DECODE_DIMENSION_MISMATCH,
  );
  assert.equal(closed, 1);
});

test("decodeImage turns decoder failures into DECODE_FAILED", async () => {
  const validation = await inspectImage(makePng({ width: 2, height: 2 }));
  await rejectsWith(
    decodeImage(new Blob([makePng({ width: 2, height: 2 })]), validation, {
      createImageBitmap: async () => {
        throw new Error("corrupt image data");
      },
      document: null,
    }),
    IMPORT_CODES.DECODE_FAILED,
  );
});

test("decodeImage reports DECODE_UNAVAILABLE when the environment has no decoder", async () => {
  const validation = await inspectImage(makePng({ width: 2, height: 2 }));
  await rejectsWith(
    decodeImage(new Blob([makePng({ width: 2, height: 2 })]), validation, {
      createImageBitmap: null,
      document: null,
      createObjectURL: null,
      revokeObjectURL: null,
    }),
    IMPORT_CODES.DECODE_UNAVAILABLE,
  );
});

test("decodeImage honours abort before work starts", async () => {
  const validation = await inspectImage(makePng({ width: 2, height: 2 }));
  let called = 0;
  const controller = new AbortController();
  controller.abort();
  await rejectsWith(
    decodeImage(new Blob([makePng({ width: 2, height: 2 })]), validation, {
      createImageBitmap: async () => {
        called++;
        return { width: 2, height: 2, close() {} };
      },
      document: null,
      signal: controller.signal,
    }),
    IMPORT_CODES.ABORTED,
  );
  assert.equal(called, 0);
});

test("decodeImage aborts after a bitmap resolves, closes it, and cleans up", async () => {
  const validation = await inspectImage(makePng({ width: 2, height: 2 }));
  const controller = new AbortController();
  let closed = 0;
  await rejectsWith(
    decodeImage(new Blob([makePng({ width: 2, height: 2 })]), validation, {
      createImageBitmap: async () => {
        controller.abort();
        return { width: 2, height: 2, close: () => closed++ };
      },
      document: null,
      signal: controller.signal,
    }),
    IMPORT_CODES.ABORTED,
  );
  assert.equal(closed, 1);
});

test("the <img> fallback revokes its Blob URL on success and on failure", async () => {
  const validation = await inspectImage(makePng({ width: 2, height: 2 }));
  const file = new Blob([makePng({ width: 2, height: 2 })], { type: "image/png" });
  const makeDocument = ({ width, height, fail = false, failDecode = false }) => {
    const image = {
      naturalWidth: width,
      naturalHeight: height,
      decode: async () => {
        if (failDecode) throw new Error("bad image");
      },
    };
    return {
      image,
      document: {
        createElement(tag) {
          assert.equal(tag, "img");
          return image;
        },
      },
      fail,
    };
  };

  const created = [];
  const revoked = [];
  const createObjectURL = (blob) => {
    created.push(blob);
    return `blob:test/${created.length}`;
  };
  const revokeObjectURL = (url) => revoked.push(url);

  const ok = makeDocument({ width: 2, height: 2 });
  const handle = await decodeImage(file, validation, {
    createImageBitmap: null,
    document: ok.document,
    createObjectURL,
    revokeObjectURL,
  });
  assert.equal(handle.image, ok.image);
  assert.equal(handle.width, 2);
  assert.equal(handle.height, 2);
  assert.deepEqual(revoked, ["blob:test/1"]);

  const wrong = makeDocument({ width: 20, height: 20 });
  await rejectsWith(
    decodeImage(file, validation, {
      createImageBitmap: null,
      document: wrong.document,
      createObjectURL,
      revokeObjectURL,
    }),
    IMPORT_CODES.DECODE_DIMENSION_MISMATCH,
  );
  assert.equal(revoked.length, 2, "mismatch still revokes its URL");

  const broken = makeDocument({ width: 2, height: 2, failDecode: true });
  await rejectsWith(
    decodeImage(file, validation, {
      createImageBitmap: null,
      document: broken.document,
      createObjectURL,
      revokeObjectURL,
    }),
    IMPORT_CODES.DECODE_FAILED,
  );
  assert.equal(revoked.length, 3, "decode failure still revokes its URL");
});

test("decodeImage refuses to run without prior validation", async () => {
  await assert.rejects(
    decodeImage(new Blob([makePng({ width: 2, height: 2 })]), null, { createImageBitmap: null, document: null }),
    (error) => error instanceof TypeError,
  );
});
