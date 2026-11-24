/* Pure Hash Tool helpers. No DOM, no storage, no network, no application state.
   Web Crypto is injected so this file can be proven in Node as well as in the
   browser. The DOM module owns all interaction and never reimplements a hash. */

/** Generous local ceiling; keeps a mistaken multi-gigabyte pick from locking the UI. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Web Crypto is only exposed in a secure context (HTTPS or localhost). */
export class HashUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "HashUnavailableError";
    this.code = "CRYPTO_UNAVAILABLE";
  }
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError("Expected binary data (Uint8Array or ArrayBuffer)");
}

/** Lowercase, zero-padded hex. Only ever called on a 32-byte digest here. */
export function bytesToHex(bytes) {
  const view = asBytes(bytes);
  const parts = new Array(view.length);
  for (let i = 0; i < view.length; i += 1) parts[i] = view[i].toString(16).padStart(2, "0");
  return parts.join("");
}

/** UTF-8 text to bytes. The encoder is injectable for test environments. */
export function utf8Bytes(text, Encoder = globalThis.TextEncoder) {
  if (typeof Encoder !== "function") throw new TypeError("TextEncoder is required");
  return new Encoder().encode(String(text ?? ""));
}

/** Capability check that reports why hashing cannot run, for the UI to show. */
export function cryptoSupport({ subtle, secureContext } = {}) {
  if (secureContext === false) {
    return { available: false, reason: "Hashing needs a secure context. Open Findows over HTTPS or from localhost." };
  }
  if (typeof subtle?.digest !== "function") {
    return { available: false, reason: "This browser does not provide Web Crypto (crypto.subtle)." };
  }
  return { available: true, reason: "" };
}

/** SHA-256 over local bytes. Nothing leaves the device; no fetch, no upload. */
export async function sha256Hex(input, subtle = globalThis.crypto?.subtle, { secureContext } = {}) {
  const support = cryptoSupport({ subtle, secureContext });
  if (!support.available) throw new HashUnavailableError(support.reason);
  const bytes = asBytes(input);
  const digest = await subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

/** null means the file is acceptable; otherwise a human-readable reason. */
export function validateFileSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return "That file has an invalid size.";
  if (bytes > MAX_FILE_BYTES) return "That file is larger than 64 MiB. Choose a smaller local file.";
  return null;
}

/** Compact size label for the status line. */
export function formatBytes(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
