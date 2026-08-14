// tests/unit/logit-bias-tokenize.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTokenIds, computeLogitBias } from "../../src/lib/prompts/logitBias.ts";

test("resolveTokenIds tokenizes a single-token word", () => {
  assert.deepEqual(resolveTokenIds("hello"), [15339]);
});

test("resolveTokenIds tokenizes a multi-token word", () => {
  assert.deepEqual(resolveTokenIds("suddenly"), [82, 44806]);
});

test("resolveTokenIds treats a JSON array literal of numbers as raw token IDs", () => {
  assert.deepEqual(resolveTokenIds("[1234, 5678]"), [1234, 5678]);
});

test("resolveTokenIds falls back to tokenizing when the array literal isn't all numbers", () => {
  // "[abc]" is not `JSON.parse`-able as a number array, so it falls through to
  // tokenizing the literal string "[abc]" itself — matching ST's try/catch-and-continue.
  assert.deepEqual(resolveTokenIds("[abc]"), [58, 13997, 60]);
});

test("resolveTokenIds returns an empty array for empty text", () => {
  assert.deepEqual(resolveTokenIds(""), []);
});

test("computeLogitBias maps every resolved token id to the entry's value", () => {
  const result = computeLogitBias([{ text: "hello", value: -50 }]);
  assert.deepEqual(result, { "15339": -50 });
});

test("computeLogitBias merges multiple entries, last write wins on collision", () => {
  const result = computeLogitBias([
    { text: "hello", value: -50 },
    { text: "[15339]", value: 30 }, // resolves to the same token id as "hello"
  ]);
  assert.deepEqual(result, { "15339": 30 });
});

test("computeLogitBias returns an empty object for an empty entry list", () => {
  assert.deepEqual(computeLogitBias([]), {});
});
