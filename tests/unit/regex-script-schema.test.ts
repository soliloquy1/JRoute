// tests/unit/regex-script-schema.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { RegexScriptSchema, compileFindRegex } from "../../src/lib/prompts/regexScriptSchema.ts";

test("RegexScriptSchema fills defaults for a minimal script", () => {
  const parsed = RegexScriptSchema.parse({ scriptName: "Strip brackets", findRegex: "/\\[.*?\\]/g" });
  assert.equal(parsed.replaceString, "");
  assert.deepEqual(parsed.trimStrings, []);
  assert.deepEqual(parsed.placement, [1, 2]);
  assert.equal(parsed.disabled, false);
  assert.equal(parsed.substituteRegex, 0);
});

test("RegexScriptSchema preserves unknown ST fields via looseObject", () => {
  const parsed = RegexScriptSchema.parse({
    scriptName: "x",
    findRegex: "/a/",
    someFutureStField: "kept",
  });
  assert.equal((parsed as Record<string, unknown>).someFutureStField, "kept");
});

test("RegexScriptSchema rejects an empty findRegex", () => {
  const result = RegexScriptSchema.safeParse({ scriptName: "x", findRegex: "" });
  assert.equal(result.success, false);
});

test("compileFindRegex parses ST's /pattern/flags convention", () => {
  const re = compileFindRegex("/hello/gi");
  assert.equal(re.source, "hello");
  assert.equal(re.flags, "gi");
});

test("compileFindRegex treats a bare pattern as a flag-less RegExp", () => {
  const re = compileFindRegex("hello world");
  assert.equal(re.source, "hello world");
  assert.equal(re.flags, "");
});

test("compileFindRegex throws on an invalid pattern", () => {
  assert.throws(() => compileFindRegex("/[/"));
});
