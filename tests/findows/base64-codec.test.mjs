/* Gate 3: Base64 / URL codec pure logic. Built-in APIs only, no DOM, no network. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CodecError,
  encodeBase64Text,
  decodeBase64Text,
  encodeUrlComponent,
  decodeUrlComponent,
  transform,
  MODES,
  OPERATIONS,
} from "../../findows/js/apps/base64-codec-engine.mjs";

test("hello round-trips through UTF-8 base64 with canonical padding", () => {
  const encoded = encodeBase64Text("hello");
  assert.equal(encoded, "aGVsbG8=");
  assert.equal(decodeBase64Text(encoded), "hello");
  assert.equal(decodeBase64Text("aGVsbG8="), "hello");
});

test("UTF-8 text survives a base64 round-trip, including multibyte emoji", () => {
  const originals = ["", "a", "café", "Merhaba dünya", "rocket 🚀 + pine 🌲", "line one\nline two"];
  for (const text of originals) {
    const encoded = encodeBase64Text(text);
    assert.match(encoded, /^[A-Za-z0-9+/]*={0,2}$/, `canonical base64 for ${JSON.stringify(text)}`);
    assert.equal(decodeBase64Text(encoded), text);
  }
  assert.equal(encodeBase64Text("café"), "Y2Fmw6k=");
});

test("base64 decoding tolerates wrapped whitespace and omitted padding", () => {
  assert.equal(decodeBase64Text("aGVsbG8"), "hello");
  assert.equal(decodeBase64Text("  aGVs\nbG8= \t"), "hello");
  assert.equal(decodeBase64Text(""), "");
});

test("malformed base64 fails with an explicit, user-facing error", () => {
  for (const bad of ["aG!sbG8=", "aGVsbG8===", "aGVsbG8=z", "a", "!!!!"]) {
    assert.throws(
      () => decodeBase64Text(bad),
      (error) => error instanceof CodecError && error.code === "INVALID_BASE64" && /base64/i.test(error.message),
      `${JSON.stringify(bad)} is rejected as malformed base64`,
    );
  }
  assert.equal(decodeBase64Text("aGVsbG8= "), "hello", "outer whitespace is ignored");
});

test("base64 that decodes to invalid UTF-8 fails with an explicit error", () => {
  assert.throws(
    () => decodeBase64Text("/w=="),
    (error) => error instanceof CodecError && error.code === "INVALID_UTF8" && /utf-8/i.test(error.message),
  );
});

test("URL component encoding preserves the exact acceptance example", () => {
  assert.equal(encodeUrlComponent("a b&c"), "a%20b%26c");
  assert.equal(decodeUrlComponent("a%20b%26c"), "a b&c");
  assert.equal(encodeUrlComponent("https://example.com/a?x=1&y=2"), "https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%26y%3D2");
});

test("URL component decoding rejects broken percent escapes explicitly", () => {
  for (const bad of ["%", "%zz", "a%2", "%E0%A4%A"]) {
    assert.throws(
      () => decodeUrlComponent(bad),
      (error) => error instanceof CodecError && error.code === "INVALID_URL_COMPONENT" && /url/i.test(error.message),
      `${JSON.stringify(bad)} is rejected as a malformed URL component`,
    );
  }
  assert.equal(decodeUrlComponent(""), "");
});

test("transform dispatches every mode/operation pair without throwing", () => {
  assert.deepEqual(transform(MODES.BASE64, OPERATIONS.ENCODE, "hello"), {
    ok: true, mode: "base64", operation: "encode", output: "aGVsbG8=",
  });
  assert.deepEqual(transform(MODES.BASE64, OPERATIONS.DECODE, "aGVsbG8="), {
    ok: true, mode: "base64", operation: "decode", output: "hello",
  });
  assert.deepEqual(transform(MODES.URL, OPERATIONS.ENCODE, "a b&c"), {
    ok: true, mode: "url", operation: "encode", output: "a%20b%26c",
  });
  assert.deepEqual(transform(MODES.URL, OPERATIONS.DECODE, "a%20b%26c"), {
    ok: true, mode: "url", operation: "decode", output: "a b&c",
  });
  const failure = transform(MODES.BASE64, OPERATIONS.DECODE, "not base64!");
  assert.equal(failure.ok, false);
  assert.equal(failure.error.code, "INVALID_BASE64");
  assert.match(failure.error.message, /base64/i);
  assert.ok(Object.isFrozen(failure));
});

test("transform rejects unknown modes and operations with RangeError", () => {
  for (const [mode, operation] of [["hex", "encode"], ["base64", "reverse"], [null, "encode"]]) {
    assert.throws(() => transform(mode, operation, "hello"), RangeError);
  }
});

test("non-string input is rejected instead of being coerced", () => {
  for (const value of [null, undefined, 5, {}, ["hello"]]) {
    assert.throws(() => encodeBase64Text(value), TypeError);
    assert.throws(() => decodeUrlComponent(value), TypeError);
  }
});
