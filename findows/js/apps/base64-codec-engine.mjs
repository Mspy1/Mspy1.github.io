/**
 * Pure Base64 / URL-component codec logic.
 *
 * Built-in platform APIs only: TextEncoder/TextDecoder for UTF-8, btoa/atob for
 * Base64, encodeURIComponent/decodeURIComponent for URL components. No DOM, no
 * timers, no storage, no network. All failures are reported as CodecError with
 * a stable code and a message that is safe to show directly in the UI.
 */

export const MODES = Object.freeze({ BASE64: "base64", URL: "url" });
export const OPERATIONS = Object.freeze({ ENCODE: "encode", DECODE: "decode" });

const MODE_VALUES = new Set(Object.values(MODES));
const OPERATION_VALUES = new Set(Object.values(OPERATIONS));
const BASE64_BODY = /^[A-Za-z0-9+/]+$/;

export class CodecError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CodecError";
    this.code = code;
  }
}

function requireString(value, label) {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  return value;
}

function bytesToBinary(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
}

/** Encode any UTF-8 string as canonical, padded Base64. */
export function encodeBase64Text(text) {
  requireString(text, "Text");
  const bytes = new TextEncoder().encode(text);
  return btoa(bytesToBinary(bytes));
}

/**
 * Normalize user-supplied Base64: drop whitespace, validate the alphabet and
 * padding, then restore canonical padding. Returns "" for empty input.
 */
export function normalizeBase64(value) {
  requireString(value, "Base64 value");
  const cleaned = value.replace(/\s+/g, "");
  if (!cleaned) return "";

  const body = cleaned.replace(/=+$/, "");
  if (!BASE64_BODY.test(body)) {
    throw new CodecError(
      "INVALID_BASE64",
      "Not valid Base64. Use only A–Z, a–z, 0–9, +, / and at most two trailing = signs.",
    );
  }

  const suppliedPadding = cleaned.length - body.length;
  const neededPadding = (4 - (body.length % 4)) % 4;
  if (body.length % 4 === 1 || suppliedPadding > neededPadding) {
    throw new CodecError(
      "INVALID_BASE64",
      "Not valid Base64. The padding (=) does not match the data length.",
    );
  }
  return `${body}${"=".repeat(neededPadding)}`;
}

/** Decode Base64 to UTF-8 text, rejecting malformed input and invalid UTF-8. */
export function decodeBase64Text(value) {
  const normalized = normalizeBase64(value);
  if (!normalized) return "";

  let binary;
  try {
    binary = atob(normalized);
  } catch (error) {
    throw new CodecError("INVALID_BASE64", "Not valid Base64. Check the characters and padding.", error);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CodecError(
      "INVALID_UTF8",
      "The Base64 decoded, but its bytes are not valid UTF-8 text.",
      error,
    );
  }
}

/** Percent-encode a value for use inside a URL component. */
export function encodeUrlComponent(text) {
  return encodeURIComponent(requireString(text, "Text"));
}

/** Decode a percent-encoded URL component, reporting broken escapes clearly. */
export function decodeUrlComponent(value) {
  requireString(value, "URL component");
  try {
    return decodeURIComponent(value);
  } catch (error) {
    throw new CodecError(
      "INVALID_URL_COMPONENT",
      "Not a valid URL-encoded value. Check the % sequences (for example %20 for a space).",
      error,
    );
  }
}

/**
 * Single entry point for the UI. Never throws for bad user input: returns a
 * frozen { ok, mode, operation, output } or { ok: false, error } result.
 */
export function transform(mode, operation, input) {
  if (!MODE_VALUES.has(mode)) throw new RangeError(`Unknown codec mode: ${String(mode)}`);
  if (!OPERATION_VALUES.has(operation)) throw new RangeError(`Unknown codec operation: ${String(operation)}`);
  requireString(input, "Input");

  const encode = operation === OPERATIONS.ENCODE;
  const run = mode === MODES.BASE64
    ? (encode ? encodeBase64Text : decodeBase64Text)
    : (encode ? encodeUrlComponent : decodeUrlComponent);

  try {
    return Object.freeze({ ok: true, mode, operation, output: run(input) });
  } catch (error) {
    if (error instanceof CodecError) {
      return Object.freeze({
        ok: false,
        mode,
        operation,
        error: Object.freeze({ code: error.code, message: error.message }),
      });
    }
    throw error;
  }
}

export default {
  CodecError,
  MODES,
  OPERATIONS,
  encodeBase64Text,
  decodeBase64Text,
  normalizeBase64,
  encodeUrlComponent,
  decodeUrlComponent,
  transform,
};
