import { test } from "node:test";
import assert from "node:assert/strict";
import { getConverter } from "../../jroute/convert/registry.ts";
import { openaiConverter } from "../../jroute/convert/openai.ts";
import { geminiConverter } from "../../jroute/convert/gemini/request.ts";
import type { TaggedBlock } from "../../jroute/convert/types.ts";

test("registry returns the openai converter for wireFormat openai", () => {
  assert.equal(getConverter("openai"), openaiConverter);
});

test("registry returns the gemini converter for wireFormat gemini", () => {
  assert.equal(getConverter("gemini"), geminiConverter);
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

// Regression: multiple simultaneous depth-injections whose depths both clamp to the front
// (depth >= message count) must keep their DEEPER-FIRST relative order (product spec
// §6.3 #9). A buggy loop that computes each splice index against the live, growing
// `messages.length` instead of the original pre-splice length inverts this order: each
// subsequent (shallower) insertion at the growing front boundary shoves the
// already-inserted deeper one backward. A single-injection test cannot catch this — it
// only shows up with two or more injections landing near/at the same boundary.
test("openai converter keeps deeper-first relative order between multiple depth-injections that clamp to the front", () => {
  const blocks: TaggedBlock[] = [
    { role: "system", content: "DEEP_100", tag: "depth-injection", depth: 100 },
    { role: "system", content: "SHALLOW_50", tag: "depth-injection", depth: 50 },
  ];
  const out = openaiConverter.convertRequest({
    model: "gpt-4o",
    maxTokens: 16384,
    body: {
      model: "gpt-4o",
      messages: [
        { role: "user", content: "m0" },
        { role: "user", content: "m1" },
      ],
    },
    blocks,
  });
  const contents = (out.messages as Array<{ content: unknown }>).map((m) => m.content);
  assert.deepEqual(contents, ["DEEP_100", "SHALLOW_50", "m0", "m1"]);
});

// Same ordering bug, but with zero prior messages — an ordinary early-conversation case,
// not an extreme edge case. Both depths clamp to index 0.
test("openai converter keeps deeper-first relative order between multiple depth-injections with zero prior messages", () => {
  const blocks: TaggedBlock[] = [
    { role: "system", content: "DEEP_100", tag: "depth-injection", depth: 100 },
    { role: "system", content: "SHALLOW_50", tag: "depth-injection", depth: 50 },
  ];
  const out = openaiConverter.convertRequest({
    model: "gpt-4o",
    maxTokens: 16384,
    body: { model: "gpt-4o", messages: [] },
    blocks,
  });
  const contents = (out.messages as Array<{ content: unknown }>).map((m) => m.content);
  assert.deepEqual(contents, ["DEEP_100", "SHALLOW_50"]);
});

test("openai converter merges a system-prepend block into an existing messages[0] system turn", () => {
  const blocks: TaggedBlock[] = [
    { role: "system-prepend", content: "Stay in character.", tag: "system-block" },
  ];
  const out = openaiConverter.convertRequest({
    model: "gpt-4o",
    maxTokens: 16384,
    body: {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are Ada, a helpful robot." },
        { role: "user", content: "hi" },
      ],
    },
    blocks,
  });
  const messages = out.messages as Array<{ role: string; content: unknown }>;
  assert.equal(messages.length, 2, "merge must not add a second system message");
  assert.equal(messages[0].role, "system");
  assert.equal(
    messages[0].content,
    "You are Ada, a helpful robot.\n\nStay in character.",
    "prepend text is concatenated after the existing system content with a blank-line separator"
  );
  assert.equal(messages[1].role, "user");
});

test("openai converter inserts a new system message at index 0 when messages[0] is not system — never concatenates into a user turn", () => {
  const blocks: TaggedBlock[] = [
    { role: "system-prepend", content: "Stay in character.", tag: "system-block" },
  ];
  const out = openaiConverter.convertRequest({
    model: "gpt-4o",
    maxTokens: 16384,
    body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    blocks,
  });
  const messages = out.messages as Array<{ role: string; content: unknown }>;
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, "Stay in character.");
  assert.equal(messages[1].role, "user");
  assert.equal(messages[1].content, "hi", "the user turn's own content must be untouched");
});

test("openai converter merges into a block-array messages[0].content by appending a text block, not string-concatenating", () => {
  const blocks: TaggedBlock[] = [
    { role: "system-prepend", content: "Stay in character.", tag: "system-block" },
  ];
  const out = openaiConverter.convertRequest({
    model: "gpt-4o",
    maxTokens: 16384,
    body: {
      model: "gpt-4o",
      messages: [
        { role: "system", content: [{ type: "text", text: "You are Ada." }] },
        { role: "user", content: "hi" },
      ],
    },
    blocks,
  });
  const messages = out.messages as Array<{ role: string; content: unknown }>;
  assert.deepEqual(messages[0].content, [
    { type: "text", text: "You are Ada." },
    { type: "text", text: "Stay in character." },
  ]);
});

test("openai converter places a system-append block as a new trailing message, after depth-injections", () => {
  const blocks: TaggedBlock[] = [
    { role: "system-append", content: "Remember the tone.", tag: "system-block" },
    { role: "trigger", content: "search result text", tag: "depth-injection", depth: 0 },
  ];
  const out = openaiConverter.convertRequest({
    model: "gpt-4o",
    maxTokens: 16384,
    body: {
      model: "gpt-4o",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "last" },
      ],
    },
    blocks,
  });
  const messages = out.messages as Array<{ role: string; content: unknown }>;
  const last = messages[messages.length - 1];
  assert.equal(last.role, "system");
  assert.equal(last.content, "Remember the tone.");
  assert.equal(
    messages[messages.length - 2].content,
    "search result text",
    "depth-0 injection lands just before the trailing append"
  );
});

test("openai converter skips an empty-content system-prepend block entirely (spec 6.3 #6)", () => {
  const blocks: TaggedBlock[] = [{ role: "system-prepend", content: "", tag: "system-block" }];
  const out = openaiConverter.convertRequest({
    model: "gpt-4o",
    maxTokens: 16384,
    body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    blocks,
  });
  assert.deepEqual(out.messages, [{ role: "user", content: "hi" }]);
});
