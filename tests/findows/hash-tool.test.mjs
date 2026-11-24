/* Hash Tool pure logic. Runs in Node with no DOM: byte encoding, hex formatting,
   Web Crypto SHA-256 with an injected subtle implementation, capability
   detection and validation. Every vector below is a published SHA-256 value
   computed independently with node:crypto. */
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  MAX_FILE_BYTES,
  HashUnavailableError,
  bytesToHex,
  cryptoSupport,
  formatBytes,
  sha256Hex,
  utf8Bytes,
  validateFileSize,
} from "../../findows/js/apps/hash-tool-engine.mjs";

const nodeSubtle = webcrypto.subtle;
const secure = { secureContext: true };

test("bytesToHex renders lowercase zero-padded hexadecimal", () => {
  assert.equal(bytesToHex(new Uint8Array([0, 1, 15, 16, 255])), "00010f10ff");
  assert.equal(bytesToHex(new Uint8Array()), "");
  assert.equal(bytesToHex(new Uint8Array([0xba, 0x78]).buffer), "ba78");
});

test("bytesToHex rejects values that are not binary data", () => {
  assert.throws(() => bytesToHex(null), TypeError);
  assert.throws(() => bytesToHex("abc"), TypeError);
  assert.throws(() => bytesToHex(12), TypeError);
});

test("utf8Bytes uses UTF-8, not a lossy Latin-1 conversion", () => {
  assert.deepEqual([...utf8Bytes("abc")], [97, 98, 99]);
  assert.deepEqual([...utf8Bytes("😀")], [0xf0, 0x9f, 0x98, 0x80]);
  assert.equal(utf8Bytes(undefined).length, 0);
});

test("sha256Hex matches the abc acceptance vector", async () => {
  const digest = await sha256Hex(utf8Bytes("abc"), nodeSubtle, secure);
  assert.equal(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256Hex hashes empty input and Unicode text exactly", async () => {
  assert.equal(await sha256Hex(new Uint8Array(), nodeSubtle, secure),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(await sha256Hex(utf8Bytes("😀"), nodeSubtle, secure),
    "f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9");
  assert.equal(await sha256Hex(utf8Bytes("hello world"), nodeSubtle, secure),
    "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
});

test("sha256Hex accepts an ArrayBuffer directly and always returns 64 lowercase chars", async () => {
  const bytes = utf8Bytes("The quick brown fox jumps over the lazy dog");
  const digest = await sha256Hex(bytes.buffer, nodeSubtle, secure);
  assert.equal(digest, "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592");
  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("cryptoSupport is unavailable without subtle or outside a secure context", () => {
  assert.deepEqual(cryptoSupport({ subtle: nodeSubtle, secureContext: true }), { available: true, reason: "" });
  assert.equal(cryptoSupport({ subtle: nodeSubtle, secureContext: false }).available, false);
  assert.match(cryptoSupport({ subtle: nodeSubtle, secureContext: false }).reason, /HTTPS|localhost/i);
  assert.equal(cryptoSupport({ subtle: null, secureContext: true }).available, false);
  assert.equal(cryptoSupport({ subtle: { digest: "not-a-function" }, secureContext: true }).available, false);
});

test("sha256Hex refuses to run when Web Crypto is absent or insecure", async () => {
  await assert.rejects(
    () => sha256Hex(utf8Bytes("abc"), null, secure),
    (error) => error instanceof HashUnavailableError && error.code === "CRYPTO_UNAVAILABLE",
  );
  await assert.rejects(
    () => sha256Hex(utf8Bytes("abc"), nodeSubtle, { secureContext: false }),
    HashUnavailableError,
  );
});

test("file size validation rejects invalid or oversized files and accepts ordinary ones", () => {
  assert.equal(MAX_FILE_BYTES, 64 * 1024 * 1024);
  assert.equal(validateFileSize(0), null);
  assert.equal(validateFileSize(1024), null);
  assert.equal(validateFileSize(MAX_FILE_BYTES), null);
  assert.match(validateFileSize(MAX_FILE_BYTES + 1), /64 MiB/);
  assert.match(validateFileSize(-1), /size/i);
  assert.match(validateFileSize("not-a-number"), /size/i);
});

test("formatBytes is a readable, bounded label for status text", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(undefined), "0 B");
});
