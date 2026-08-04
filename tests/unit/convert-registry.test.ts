import { test } from "node:test";
import assert from "node:assert/strict";
import { getConverter } from "../../jroute/convert/registry.ts";
import { openaiConverter } from "../../jroute/convert/openai.ts";
import type { TaggedBlock } from "../../jroute/convert/types.ts";

test("registry returns the openai converter for wireFormat openai", () => {
  assert.equal(getConverter("openai"), openaiConverter);
});

test("registry returns null for a wireFormat with no converter yet", () => {
  assert.equal(getConverter("gemini"), null);
});

test("openai converter passes the body through unchanged", () => {
  const body = {
    model: "gpt-4o",
    messages: [{ role: "user", content: "hi", name: "westin" }],
    temperature: 0.9,
    custom_field: { nested: true },
  };
  const out = openaiConverter.convertRequest({
    model: "gpt-4o",
    maxTokens: 16384,
    body,
    blocks: [],
  });
  assert.deepEqual(out, body);
});

test("openai converter prepends system-blocks as system messages", () => {
  const blocks: TaggedBlock[] = [{ role: "system", content: "You are Ada.", tag: "system-block" }];
  const out = openaiConverter.convertRequest({
    model: "gpt-4o",
    maxTokens: 16384,
    body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    blocks,
  });
  const messages = out.messages as Array<{ role: string; content: unknown }>;
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, "You are Ada.");
  assert.equal(messages[1].role, "user");
});

test("openai converter places a depth-injection at its depth, not at the top", () => {
  const blocks: TaggedBlock[] = [
    { role: "system", content: "LOREBOOK", tag: "depth-injection", depth: 1 },
  ];
  const out = openaiConverter.convertRequest({
    model: "gpt-4o",
    maxTokens: 16384,
    body: {
      model: "gpt-4o",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ],
    },
    blocks,
  });
  const messages = out.messages as Array<{ role: string; content: unknown }>;
  assert.notEqual(messages[0].content, "LOREBOOK", "must NOT be hoisted to the top");
  // depth 1 == one message from the end, i.e. immediately before the final user turn.
  const idx = messages.findIndex((m) => m.content === "LOREBOOK");
  assert.equal(idx, messages.length - 2, "depth 1 lands immediately before the last message");
});
