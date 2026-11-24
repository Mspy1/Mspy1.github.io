/* Gate: Markdown Preview pure tokenizer (no DOM, no HTML parsing, no network).
   Acceptance: **bold** -> strong, and <script> stays literal text. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SOURCE_CHARS,
  parseMarkdown,
  sanitizeHref,
  inlineText,
} from "../../findows/js/apps/markdown-preview-engine.mjs";

const types = (nodes) => nodes.map((node) => node.type);
const firstBlock = (src) => parseMarkdown(src).blocks[0];

test("rejects non-string input and accepts an empty document", () => {
  for (const value of [null, undefined, 42, {}, ["# hi"]]) {
    assert.throws(() => parseMarkdown(value), TypeError, `non-string ${String(value)} must throw`);
  }
  assert.deepEqual(parseMarkdown("").blocks, []);
  assert.deepEqual(parseMarkdown("   \n\n  ").blocks, []);
});

test("acceptance: **bold** becomes a strong inline node", () => {
  const block = firstBlock("A **bold** word.");
  assert.equal(block.type, "paragraph");
  assert.deepEqual(types(block.inline), ["text", "strong", "text"]);
  assert.equal(block.inline[1].type, "strong");
  assert.equal(inlineText(block.inline[1].inline), "bold");
  assert.equal(inlineText(block.inline), "A bold word.");
});

test("acceptance: <script> stays literal text, never markup", () => {
  const source = '<script>window.__pwned=1</script> and <img src=http://evil.test/x>';
  const block = firstBlock(source);
  assert.equal(block.type, "paragraph");
  assert.deepEqual(types(block.inline), ["text"], "raw HTML is a single literal text node");
  assert.equal(block.inline[0].value, source, "characters are preserved byte for byte");
  assert.equal(inlineText(block.inline), source);
  assert.ok(!source.includes("<strong"), "no markup is synthesized from HTML");
});

test("parses ATX headings of every level with trailing hashes removed", () => {
  const blocks = parseMarkdown("# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n####### Seven").blocks;
  assert.deepEqual(blocks.filter((b) => b.type === "heading").map((b) => b.level), [1, 2, 3, 4, 5, 6]);
  assert.ok(blocks.slice(0, 6).every((b) => b.type === "heading"));
  assert.equal(inlineText(blocks[0].inline), "One");
  assert.deepEqual(types(blocks[5].inline), ["text"]);
  // Seven hashes is not a valid ATX heading; it is a paragraph.
  assert.equal(blocks[6].type, "paragraph");
  assert.equal(inlineText(firstBlock("## Title ##").inline), "Title");
});

test("parses italics from * and _ but not inside words", () => {
  assert.deepEqual(types(firstBlock("*alpha*").inline), ["em"]);
  assert.equal(inlineText(firstBlock("*alpha*").inline), "alpha");
  assert.deepEqual(types(firstBlock("_beta_").inline), ["em"]);
  assert.deepEqual(types(firstBlock("snake_case_here").inline), ["text"], "intra-word underscores stay literal");
  assert.deepEqual(types(firstBlock("**bold** and *em*").inline), ["strong", "text", "em"]);
});

test("nested emphasis and bold content are parsed recursively", () => {
  const nodes = firstBlock("**bold with *inner* emphasis**").inline;
  assert.deepEqual(types(nodes), ["strong"]);
  assert.deepEqual(types(nodes[0].inline), ["text", "em", "text"]);
  assert.equal(inlineText(nodes), "bold with inner emphasis");
});

test("escaped markers stay literal", () => {
  const nodes = firstBlock("\\*not italic\\* and \\*\\*not bold\\*\\*").inline;
  assert.deepEqual(types(nodes), ["text"]);
  assert.equal(nodes[0].value, "*not italic* and **not bold**");
});

test("inline code keeps its characters exactly, including HTML-looking text", () => {
  const nodes = firstBlock("Use `<div class=x>` here").inline;
  assert.deepEqual(types(nodes), ["text", "code", "text"]);
  assert.equal(nodes[1].value, "<div class=x>");
});

test("groups consecutive unordered and ordered list items into separate lists", () => {
  const blocks = parseMarkdown("- one\n- two\n\n1. first\n2. second\n").blocks;
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((b) => b.type), ["list", "list"]);
  assert.equal(blocks[0].ordered, false);
  assert.equal(blocks[1].ordered, true);
  assert.equal(blocks[0].items.length, 2);
  assert.equal(blocks[1].items.length, 2);
  assert.equal(inlineText(blocks[0].items[1]), "two");
  assert.equal(inlineText(blocks[1].items[0]), "first");
  assert.deepEqual(types(firstBlock("- **item**").items[0]), ["strong"]);
});

test("paragraph lines join with a space and blank lines split blocks", () => {
  const blocks = parseMarkdown("first line\nsecond line\n\nnew block").blocks;
  assert.equal(blocks.length, 2);
  assert.equal(inlineText(blocks[0].inline), "first line second line");
  assert.equal(inlineText(blocks[1].inline), "new block");
});

test("normalizes CRLF and CR line endings", () => {
  const blocks = parseMarkdown("# Head\r\n\r\n- a\r- b").blocks;
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "list"]);
  assert.equal(blocks[1].items.length, 2);
});

test("horizontal rules are their own block", () => {
  const blocks = parseMarkdown("before\n\n---\n\nafter").blocks;
  assert.deepEqual(blocks.map((b) => b.type), ["paragraph", "rule", "paragraph"]);
});

test("links parse labels and keep only safe hrefs", () => {
  const nodes = firstBlock("[site](https://example.com/a)").inline;
  assert.deepEqual(types(nodes), ["link"]);
  assert.equal(nodes[0].safe, true);
  assert.equal(nodes[0].href, "https://example.com/a");
  assert.equal(inlineText(nodes[0].inline), "site");

  const rel = firstBlock("[docs](/guide#intro)").inline[0];
  assert.equal(rel.safe, true);
  assert.equal(rel.href, "/guide#intro");

  const mail = firstBlock("[mail](mailto:hi@example.com)").inline[0];
  assert.equal(mail.safe, true);
});

test("dangerous link schemes are blocked and never carry an href", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<script>x</script>", "vbscript:msgbox", "file:///etc/passwd"]) {
    const node = firstBlock(`[bad](${url})`).inline[0];
    assert.equal(node.type, "link", `parsed as link: ${url}`);
    assert.equal(node.safe, false, `marked unsafe: ${url}`);
    assert.equal(node.href, null, `no href for ${url}`);
  }
  const wrapped = firstBlock("[bad](<javascript:alert(1)>)").inline[0];
  assert.equal(wrapped.safe, false);
  const spaced = firstBlock("[bad](https://example.com/a b)").inline[0];
  assert.equal(spaced.safe, false, "control/space characters are rejected");
});

test("link labels never become markup", () => {
  const node = firstBlock("[<b>x</b>](https://example.com)").inline[0];
  assert.equal(node.type, "link");
  assert.deepEqual(types(node.inline), ["text"]);
  assert.equal(node.inline[0].value, "<b>x</b>");
});

test("sanitizeHref is an explicit, reusable guard", () => {
  assert.deepEqual(sanitizeHref("HTTPS://EXAMPLE.COM"), { href: "HTTPS://EXAMPLE.COM", safe: true, reason: "" });
  assert.equal(sanitizeHref("javascript:alert(1)").safe, false);
  assert.equal(sanitizeHref(null).safe, false);
  assert.equal(sanitizeHref("").safe, false);
});

test("input is bounded: oversized documents fail fast with a typed error", () => {
  assert.equal(MAX_SOURCE_CHARS, 20_000, "the engine publishes a shared input cap");
  const tooLong = "a".repeat(MAX_SOURCE_CHARS + 1);
  let caught = null;
  try {
    parseMarkdown(tooLong);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof RangeError, "oversized source throws RangeError");
  assert.equal(caught.code, "INPUT_TOO_LONG");
  assert.equal(caught.actual, MAX_SOURCE_CHARS + 1);
  assert.equal(caught.max, MAX_SOURCE_CHARS);
  assert.match(caught.message, /20,000/, "the error message states the limit");
  assert.equal(parseMarkdown("a".repeat(MAX_SOURCE_CHARS)).blocks.length, 1,
    "a source exactly at the cap still parses");
  assert.equal(inlineText(parseMarkdown("**bold**").blocks[0].inline), "bold",
    "the cap does not change the accepted syntax");
});

test("output is deeply frozen and cannot be mutated", () => {
  const ast = parseMarkdown("# Title\n\n**b** [l](https://e.test)\n\n- x");
  assert.ok(Object.isFrozen(ast));
  assert.ok(Object.isFrozen(ast.blocks));
  assert.ok(Object.isFrozen(ast.blocks[0]));
  assert.ok(Object.isFrozen(ast.blocks[1].inline));
  assert.ok(Object.isFrozen(ast.blocks[1].inline[1]));
  assert.throws(() => { ast.blocks[0].level = 6; }, TypeError);
  assert.throws(() => { ast.blocks.push({}); }, TypeError);
});
