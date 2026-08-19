import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTextResult } from "../../src/lib/mcp/toolResultText.ts";

test("joins multiple text content parts", () => {
  const result = {
    content: [
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ],
  };
  assert.equal(extractTextResult(result), "hello\nworld");
});

test("ignores non-text content parts", () => {
  const result = {
    content: [
      { type: "text", text: "kept" },
      { type: "image", data: "..." },
    ],
  };
  assert.equal(extractTextResult(result), "kept");
});

// The fixture above is corroborating only: `{type: "image", data}` carries no `text` key, so
// it is dropped by the `"text" in part` guard even if the `type === "text"` discriminator is
// deleted (verified by mutation — that mutant survived). This case makes the discriminator
// itself load-bearing: a non-text part that DOES carry a `text` field must still be dropped.
test("drops a non-text part even when it carries a text field", () => {
  const result = {
    content: [
      { type: "text", text: "kept" },
      { type: "resource", text: "must not be included" },
    ],
  };
  assert.equal(extractTextResult(result), "kept");
});

test("returns empty string for a result with no content array", () => {
  assert.equal(extractTextResult({}), "");
  assert.equal(extractTextResult(null), "");
  assert.equal(extractTextResult(undefined), "");
});
