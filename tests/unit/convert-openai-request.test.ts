// tests/unit/convert-openai-request.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { openaiConverter } from "../../jroute/convert/openai.ts";

test("openai converter sends the native (prefix-stripped) model upstream", () => {
  const out = openaiConverter.convertRequest({
    model: "gpt-5.6-sol", // native id, prefix already stripped by resolveModel
    maxTokens: 8192,
    body: { model: "or/gpt-5.6-sol", messages: [{ role: "user", content: "hi" }] },
    blocks: [],
  });
  assert.equal(out.model, "gpt-5.6-sol");
  assert.notEqual(out.model, "or/gpt-5.6-sol");
});

test("openai converter strips the prefix even when blocks are injected", () => {
  const out = openaiConverter.convertRequest({
    model: "gpt-5.6-sol",
    maxTokens: 8192,
    body: { model: "or/gpt-5.6-sol", messages: [{ role: "user", content: "hi" }] },
    blocks: [{ role: "system-prepend", content: "system text", order: 0 }],
  });
  assert.equal(out.model, "gpt-5.6-sol");
  const messages = out.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, "system text");
});

test("openai converter leaves a legacy (unprefixed) model untouched", () => {
  const out = openaiConverter.convertRequest({
    model: "gpt-4o",
    maxTokens: 16384,
    body: { model: "gpt-4o", messages: [] },
    blocks: [],
  });
  assert.equal(out.model, "gpt-4o");
});
