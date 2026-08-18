// tests/unit/search-html-to-text.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText } from "../../src/lib/search/htmlToText.ts";

test("strips tags and returns visible text", () => {
  const html = "<html><body><h1>Title</h1><p>Hello <b>world</b>.</p></body></html>";
  assert.equal(htmlToText(html, 1000), "Title Hello world .");
});

test("removes script and style block contents entirely, not just the tags", () => {
  const html =
    "<p>Keep</p><script>var x = 'DROP THIS';</script><style>.a{color:red}</style><p>Also keep</p>";
  const out = htmlToText(html, 1000);
  assert.ok(!out.includes("DROP THIS"));
  assert.ok(!out.includes("color:red"));
  assert.ok(out.includes("Keep"));
  assert.ok(out.includes("Also keep"));
});

test("decodes common HTML entities", () => {
  const html = "<p>Tom &amp; Jerry &mdash; &lt;fun&gt; &nbsp;times&nbsp;</p>";
  const out = htmlToText(html, 1000);
  assert.ok(out.includes("Tom & Jerry"));
  assert.ok(out.includes("<fun>"));
});

test("collapses repeated whitespace to single spaces", () => {
  const html = "<p>a\n\n\n   b\t\tc</p>";
  assert.equal(htmlToText(html, 1000), "a b c");
});

test("leaves out-of-range numeric entities alone instead of throwing", () => {
  // String.fromCodePoint throws RangeError above U+10FFFF, and Number.isFinite alone does
  // not catch that — a single such entity used to blow up the whole page extraction.
  const html = "<p>before &#x200000; &#2097152; after</p>";
  const out = htmlToText(html, 1000);
  assert.ok(out.includes("before"));
  assert.ok(out.includes("after"));
  assert.ok(out.includes("&#x200000;"));
  assert.ok(out.includes("&#2097152;"));
});

test("still decodes numeric entities at the top of the valid range", () => {
  assert.equal(htmlToText("<p>&#x10FFFF;</p>", 1000), String.fromCodePoint(0x10ffff));
});

test("truncates to maxLength", () => {
  const html = `<p>${"x".repeat(100)}</p>`;
  assert.equal(htmlToText(html, 10).length, 10);
});
