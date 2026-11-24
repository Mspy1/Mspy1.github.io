/* Text Toolkit pure logic: real transforms, bounds and explicit errors.
   RED first: this file fails until text-toolkit-engine.mjs exists. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_INPUT_CHARS,
  OPERATIONS,
  runToolkit,
} from "../../findows/js/apps/text-toolkit-engine.mjs";

test("case transforms change real text (upper, lower, title, sentence)", () => {
  assert.equal(runToolkit("Hello world", "upper").output, "HELLO WORLD");
  assert.equal(runToolkit("Hello WORLD", "lower").output, "hello world");
  assert.equal(runToolkit("hello WORLD", "title").output, "Hello World");
  assert.equal(runToolkit("hello. world! again", "sentence").output, "Hello. World! Again");
});

test("identifier cases split word boundaries and rejoin deterministically", () => {
  const input = "helloWorld XMLHttpRequest";
  assert.equal(runToolkit(input, "camel").output, "helloWorldXmlHttpRequest");
  assert.equal(runToolkit(input, "pascal").output, "HelloWorldXmlHttpRequest");
  assert.equal(runToolkit(input, "snake").output, "hello_world_xml_http_request");
  assert.equal(runToolkit(input, "kebab").output, "hello-world-xml-http-request");
  assert.equal(runToolkit(input, "constant").output, "HELLO_WORLD_XML_HTTP_REQUEST");
});

test("whitespace controls trim, collapse, drop blank lines and expand tabs", () => {
  assert.equal(runToolkit("  hi  ", "trim").output, "hi");
  assert.equal(runToolkit("a   b\t c\n d   ", "collapse").output, "a b c\nd");
  assert.equal(runToolkit("a\n\n b \n\nc", "no-blank-lines").output, "a\n b \nc");
  assert.equal(runToolkit("a\tb", "tabs-to-spaces", { tabSize: 4 }).output, "a    b");
  assert.equal(runToolkit("a\tb", "tabs-to-spaces").output, "a  b");
  assert.throws(() => runToolkit("a", "tabs-to-spaces", { tabSize: 0 }), /tabSize/);
});

test("line operations sort, reverse and remove duplicates", () => {
  assert.equal(runToolkit("b\na\nc", "sort-asc").output, "a\nb\nc");
  assert.equal(runToolkit("b\na\nc", "sort-desc").output, "c\nb\na");
  assert.equal(runToolkit("a\nb\nc", "reverse-lines").output, "c\nb\na");
  assert.equal(runToolkit("a\nb\na\nc\nb", "unique").output, "a\nb\nc");
  assert.equal(runToolkit("A\na\nB\nb", "unique-ignore-case").output, "A\nB");
  assert.equal(runToolkit("b\r\na\r\nc", "sort-asc").output, "a\nb\nc", "line endings normalize");
});

test("count words, Unicode code points and lines", () => {
  const result = runToolkit("Hello world\nsecond line", "count");
  assert.deepEqual(result.counts, { words: 4, chars: 23, lines: 2 });
  assert.ok(result.output.includes("Words: 4"));
  assert.ok(result.output.includes("Characters: 23"));
  assert.ok(result.output.includes("Lines: 2"));
  assert.equal(runToolkit("", "count").counts.words, 0);
  assert.equal(runToolkit("", "count").counts.lines, 0);
  assert.equal(runToolkit("🙂🙂", "count").counts.chars, 2, "astral characters count once");
});

test("input is bounded and errors are explicit", () => {
  assert.throws(() => runToolkit("x".repeat(MAX_INPUT_CHARS + 1), "upper"),
    (error) => error.code === "INPUT_TOO_LONG" && /20,?000/.test(error.message));
  assert.equal(runToolkit("x".repeat(MAX_INPUT_CHARS), "upper").output.length, MAX_INPUT_CHARS);
  assert.throws(() => runToolkit(null, "upper"),
    (error) => error.code === "INVALID_INPUT" && error instanceof TypeError);
  assert.throws(() => runToolkit("a", "does-not-exist"),
    (error) => error.code === "UNKNOWN_OPERATION");
});

test("results are frozen and never contain markup", () => {
  const result = runToolkit("<img src=x onerror=alert(1)>", "upper");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.counts));
  assert.equal(result.output, "<IMG SRC=X ONERROR=ALERT(1)>");
  assert.equal(result.output.includes("<script"), false);
});

test("every advertised operation is runnable", () => {
  const ids = OPERATIONS.map((operation) => operation.id);
  for (const id of ids) {
    const result = runToolkit("one\ntwo", id);
    assert.equal(typeof result.output, "string", `${id} returns text`);
    assert.equal(result.operation, id);
  }
});
