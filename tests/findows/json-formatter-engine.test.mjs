/* Gate 3: JSON Formatter pure logic. No DOM, no eval, no network.
   The engine parses with source positions, builds a render tree and serializes
   safe JSON text; the UI only ever renders from this data. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJson,
  formatJson,
  minifyJson,
  serializeJson,
  toDownloadName,
} from "../../findows/js/apps/json-formatter-engine.mjs";

test("pretty prints nested JSON with stable two-space indentation", () => {
  const result = formatJson('{"name":"Ada","tags":["x","y"],"ok":true,"n":null}');
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
  assert.equal(
    result.text,
    [
      "{",
      '  "name": "Ada",',
      '  "tags": [',
      '    "x",',
      '    "y"',
      "  ],",
      '  "ok": true,',
      '  "n": null',
      "}",
    ].join("\n"),
  );
  assert.equal(parseJson(result.text).ok, true, "output is valid JSON again");
});

test("indent option supports 4 spaces, tabs and compact mode", () => {
  const source = '{"a":[1,2]}';
  assert.equal(formatJson(source, { indent: 4 }).text, [
    "{",
    '    "a": [',
    "        1,",
    "        2",
    "    ]",
    "}",
  ].join("\n"));
  assert.equal(formatJson(source, { indent: "\t" }).text, [
    "{",
    '\t"a": [',
    "\t\t1,",
    "\t\t2",
    "\t]",
    "}",
  ].join("\n"));
  assert.equal(formatJson(source, { indent: 0 }).text, '{"a":[1,2]}');
  assert.throws(() => formatJson(source, { indent: 3 }), RangeError);
  assert.throws(() => formatJson(source, { indent: "  " }), RangeError);
});

test("sortKeys reorders object members recursively but keeps arrays in order", () => {
  const result = formatJson('{"z":1,"a":{"d":4,"b":[3,1]},"m":2}', { indent: 0, sortKeys: true });
  assert.equal(result.text, '{"a":{"b":[3,1],"d":4},"m":2,"z":1}');
  const plain = formatJson('{"z":1,"a":2}', { indent: 0 });
  assert.equal(plain.text, '{"z":1,"a":2}', "order is preserved by default");
});

test("minify removes whitespace without changing values", () => {
  const result = minifyJson('{\n  "a" : [1, 2, { "b" : "c d" }]\n}\n');
  assert.equal(result.ok, true);
  assert.equal(result.text, '{"a":[1,2,{"b":"c d"}]}');
  assert.deepEqual(parseJson(result.text).value, { a: [1, 2, { b: "c d" }] });
});

test("parse error reports an exact position, line and column", () => {
  const text = '{\n  "a": 1,\n  "b": [1, 2,],\n}';
  const result = formatJson(text);
  assert.equal(result.ok, false);
  assert.equal(result.text, null);
  assert.equal(result.root, null);
  assert.equal(result.error.position, text.indexOf("],"));
  assert.equal(result.error.line, 3);
  assert.equal(result.error.column, 14);
  assert.match(result.error.message, /value|token/i);
  assert.match(result.error.near, /]/);
  assert.ok(Object.isFrozen(result.error), "errors are readonly");
});

test("truncated and empty input are errors, not exceptions", () => {
  const truncated = parseJson('{"a":');
  assert.equal(truncated.ok, false);
  assert.match(truncated.error.message, /end of input/i);
  assert.equal(truncated.error.position, 5);
  const empty = parseJson("   \n  ");
  assert.equal(empty.ok, false);
  assert.match(empty.error.message, /end of input/i);
  assert.throws(() => parseJson(null), TypeError);
});

test("malformed JSON of several common shapes is rejected with a position", () => {
  const samples = [
    "{" ,
    "[1,,2]",
    '{"a" 1}',
    '{"a":01}',
    '"unterminated',
    "NaN",
    "tru",
    '{"a":1}{}',
    '"\u0001"',
  ];
  for (const text of samples) {
    const result = parseJson(text);
    assert.equal(result.ok, false, `must reject ${JSON.stringify(text)}`);
    assert.equal(typeof result.error.position, "number");
    assert.ok(result.error.position >= 0 && result.error.position <= text.length);
    assert.ok(result.error.message.length > 0);
  }
});

test("builds a frozen render tree with stable keys, paths and node kinds", () => {
  const result = parseJson('{"a":[1,{"b":"c"}]}');
  assert.equal(result.ok, true);
  const root = result.root;
  assert.equal(root.type, "object");
  assert.equal(root.path, "$");
  assert.ok(Object.isFrozen(root));
  assert.equal(root.children[0].key, "a");
  assert.equal(root.children[0].type, "array");
  assert.equal(root.children[0].path, "$.a");
  const number = root.children[0].children[0];
  assert.equal(number.type, "number");
  assert.equal(number.value, 1);
  assert.equal(number.index, 0);
  assert.equal(number.path, "$.a[0]");
  const inner = root.children[0].children[1];
  assert.equal(inner.type, "object");
  assert.equal(inner.children[0].key, "b");
  assert.equal(inner.children[0].value, "c");
  assert.equal(inner.children[0].path, "$.a[1].b");
  assert.deepEqual(result.stats, { nodes: 5, leaves: 2, containers: 3, maxDepth: 3 });
});

test("odd property names are addressable without ambiguity", () => {
  const result = parseJson('{"a b":1,"x.y":2,"0":3}');
  assert.equal(result.root.children[0].path, '$["a b"]');
  assert.equal(result.root.children[1].path, '$["x.y"]');
  assert.equal(result.root.children[2].path, '$["0"]');
  assert.equal(serializeJson(result.root, { indent: 0 }), '{"a b":1,"x.y":2,"0":3}');
});

test("strings are escaped by the serializer so output is inert text", () => {
  const payload = '</script><img src=x onerror="alert(1)">';
  const source = JSON.stringify({ note: payload });
  const result = formatJson(source);
  assert.equal(result.ok, true);
  assert.ok(!result.text.includes("</script>"), "the output contains no raw closing tag");
  assert.ok(result.text.includes("\\u003c/script\\u003e"), "angle brackets are escaped");
  assert.equal(parseJson(result.text).value.note, payload, "the value round-trips exactly");
});

test("unrepresentable numbers and excessive nesting are rejected safely", () => {
  const overflow = parseJson("1e999");
  assert.equal(overflow.ok, false);
  assert.match(overflow.error.message, /range/i);
  const deep = "[".repeat(200) + "0" + "]".repeat(200);
  const tooDeep = parseJson(deep);
  assert.equal(tooDeep.ok, false);
  assert.match(tooDeep.error.message, /too deep/i);
});

test("__proto__ and constructor keys stay ordinary own data (F1 regression)", () => {
  const source = '{"__proto__":{"pwned":1},"constructor":"safe","a":2}';
  const result = parseJson(source);
  assert.equal(result.ok, true);
  const value = result.value;
  assert.deepEqual(Object.keys(value), ["__proto__", "constructor", "a"]);
  assert.equal(Object.getPrototypeOf(value), Object.prototype, "prototype is not replaced");
  assert.deepEqual(value.__proto__, { pwned: 1 }, "the parsed value is readable as own data");
  assert.equal(value.constructor, "safe");
  const descriptor = Object.getOwnPropertyDescriptor(value, "__proto__");
  assert.equal(descriptor.enumerable, true);
  assert.equal(descriptor.writable, true);
  assert.equal(descriptor.configurable, true);
  assert.equal({}.pwned, undefined, "Object.prototype is untouched");

  const nested = parseJson('{"outer":{"__proto__":{"pwned":2}}}');
  assert.deepEqual(Object.keys(nested.value.outer), ["__proto__"]);
  assert.equal(Object.getPrototypeOf(nested.value.outer), Object.prototype);
  assert.deepEqual(nested.value.outer.__proto__, { pwned: 2 });

  assert.equal(formatJson(source, { indent: 0 }).text, source, "serialization keeps the key");
  assert.equal(result.root.children[0].key, "__proto__");
  assert.equal(result.root.children[0].path, "$.__proto__");
});

test("download names are sanitized and always end in .json", () => {
  assert.equal(toDownloadName("win-42"), "jsonformatter-win-42.json");
  assert.equal(toDownloadName("<bad:window?>"), "jsonformatter-bad-window.json");
  assert.equal(toDownloadName(""), "jsonformatter-json.json");
});
