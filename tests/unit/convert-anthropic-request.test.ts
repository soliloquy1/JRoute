import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anthropicConverter,
  toContentBlocks,
  mapAnthropicTools,
  mapMessagesToAnthropic,
} from "../../jroute/convert/anthropic/request.ts";
import type { TaggedBlock } from "../../jroute/convert/types.ts";

const convert = (body: Record<string, unknown>, blocks: TaggedBlock[] = []) =>
  anthropicConverter.convertRequest({
    model: "claude-sonnet-4-6",
    maxTokens: 64000,
    body,
    blocks,
  });

test("hoists system-blocks into the top-level system param as a block array", () => {
  const out = convert({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] }, [
    { role: "system", content: "You are Ada.", tag: "system-block" },
    { role: "system", content: "Stay in character.", tag: "system-block" },
  ]);
  assert.deepEqual(out.system, [
    { type: "text", text: "You are Ada." },
    { type: "text", text: "Stay in character." },
  ]);
});

test("omits the system param entirely when there are no system-blocks", () => {
  const out = convert({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] });
  assert.equal("system" in out, false, "an empty system param must not be sent");
});

test("never emits a role:system message — Anthropic has no such role", () => {
  const out = convert(
    {
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: "inline system from the client" },
        { role: "user", content: "hi" },
      ],
    },
    [{ role: "system", content: "You are Ada.", tag: "system-block" }]
  );
  const messages = out.messages as Array<{
    role: string;
    content: Array<{ type: string; text?: string }>;
  }>;
  assert.ok(
    messages.every((m) => m.role !== "system"),
    "no message may carry role:system"
  );
  // A hoisted role:system message must not ALSO survive as content inside a mapped
  // message — that would duplicate the system content (once in `system`, once as a
  // fake user turn in `messages`). Guards against a future removal of the
  // `.filter((m) => m.role !== "system")` step in the message-mapping pipeline.
  const allMessageText = messages.flatMap((m) => m.content.map((b) => b.text ?? "")).join(" ");
  assert.ok(
    !allMessageText.includes("inline system from the client"),
    "hoisted system content must not also appear in messages"
  );
});

test("a client-supplied role:system message is hoisted into the system param", () => {
  const out = convert({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: "inline system from the client" },
      { role: "user", content: "hi" },
    ],
  });
  assert.deepEqual(out.system, [{ type: "text", text: "inline system from the client" }]);

  // Same duplication guard as above, exercised without the extra system-block input.
  const messages = out.messages as Array<{
    role: string;
    content: Array<{ type: string; text?: string }>;
  }>;
  const allMessageText = messages.flatMap((m) => m.content.map((b) => b.text ?? "")).join(" ");
  assert.ok(
    !allMessageText.includes("inline system from the client"),
    "hoisted system content must not also appear in messages"
  );
});

test("supplies the per-model max_tokens", () => {
  const out = convert({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] });
  assert.equal(out.max_tokens, 64000);
});

test("a client-supplied max_tokens is clamped to the model ceiling", () => {
  const under = convert({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(under.max_tokens, 500, "a smaller client value is honoured");

  const over = convert({
    model: "claude-sonnet-4-6",
    max_tokens: 999_999,
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(over.max_tokens, 64000, "exceeding the ceiling is a 400 — clamp instead");
});

test("a client-supplied max_tokens: NaN falls back to the model ceiling", () => {
  const out = convert({
    model: "claude-sonnet-4-6",
    max_tokens: NaN,
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(
    out.max_tokens,
    64000,
    "NaN must not propagate — it would serialize to null and 400 upstream"
  );
});

test("passes model and stream through", () => {
  const out = convert({
    model: "claude-sonnet-4-6",
    stream: true,
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(out.model, "claude-sonnet-4-6");
  assert.equal(out.stream, true);
});

test("does not forward OpenAI-only fields Anthropic rejects", () => {
  const out = convert({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "hi" }],
    frequency_penalty: 0.5,
    presence_penalty: 0.5,
    logit_bias: { "1": 1 },
    n: 2,
  });
  for (const k of ["frequency_penalty", "presence_penalty", "logit_bias", "n"]) {
    assert.equal(k in out, false, `${k} must not reach Anthropic`);
  }
});

test("forwards sampling fields Anthropic does accept", () => {
  const out = convert({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.7,
    top_p: 0.9,
    stop: ["\nUser:"],
  });
  assert.equal(out.temperature, 0.7);
  assert.equal(out.top_p, 0.9);
  assert.deepEqual(out.stop_sequences, ["\nUser:"], "OpenAI `stop` becomes `stop_sequences`");
  assert.equal("stop" in out, false);
});

test("toContentBlocks normalizes a plain string", () => {
  assert.deepEqual(toContentBlocks("hello"), [{ type: "text", text: "hello" }]);
});

test("toContentBlocks passes through an OpenAI text part array", () => {
  assert.deepEqual(
    toContentBlocks([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]),
    [
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]
  );
});

test("toContentBlocks converts an OpenAI image_url data URL to an Anthropic image block", () => {
  const blocks = toContentBlocks([
    { type: "text", text: "look" },
    {
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    },
  ]);
  assert.deepEqual(blocks, [
    { type: "text", text: "look" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
  ]);
});

test("toContentBlocks converts a remote image_url to an Anthropic url source", () => {
  const blocks = toContentBlocks([
    { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
  ]);
  assert.deepEqual(blocks, [
    { type: "image", source: { type: "url", url: "https://example.com/cat.png" } },
  ]);
});

test("messages carry block-array content, never raw strings", () => {
  const out = convert({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "hi" }],
  });
  const messages = out.messages as Array<{ role: string; content: unknown }>;
  assert.deepEqual(messages[0].content, [{ type: "text", text: "hi" }]);
});

test("a system-append block lands after Janitor's own system message, a system-prepend block before it", () => {
  const out = convert(
    {
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: "You are Ada, a character card." },
        { role: "user", content: "hi" },
      ],
    },
    [
      { role: "system-append", content: "Remember the tone.", tag: "system-block" },
      { role: "system-prepend", content: "JRoute jailbreak text.", tag: "system-block" },
    ]
  );
  assert.deepEqual(out.system, [
    { type: "text", text: "JRoute jailbreak text." },
    { type: "text", text: "You are Ada, a character card." },
    { type: "text", text: "Remember the tone." },
  ]);
});

// --- Native MCP tool-calling mode (design spec §6, §6.1) ----------------------------------
// Field names verified against the current Anthropic Messages API docs: tool definitions use
// `{name, description, input_schema}`, tool_choice "let the model decide" is `{type: "auto"}`,
// an assistant tool call is `{type: "tool_use", id, name, input}` (input is a parsed object,
// not a JSON string), and a result is `{type: "tool_result", tool_use_id, content}`.

test("mapAnthropicTools converts OpenAI function defs to Anthropic tool shape", () => {
  const tools = [
    {
      type: "function" as const,
      function: {
        name: "web_search",
        description: "Search the web",
        parameters: { type: "object", properties: {} },
      },
    },
  ];
  assert.deepEqual(mapAnthropicTools(tools), [
    {
      name: "web_search",
      description: "Search the web",
      input_schema: { type: "object", properties: {} },
    },
  ]);
});

test("convertRequest sets tools and forces tool_choice to auto when body.tools is present", () => {
  const out = convert({
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "t", description: "d", parameters: {} } }],
    tool_choice: "none", // client-supplied — must be IGNORED, always forced to auto
  });
  assert.deepEqual(out.tool_choice, { type: "auto" });
  assert.equal((out.tools as unknown[]).length, 1);
});

test("convertRequest omits tools/tool_choice entirely when body.tools is absent", () => {
  const out = convert({ messages: [{ role: "user", content: "hi" }] });
  assert.equal("tools" in out, false);
  assert.equal("tool_choice" in out, false);
});

test("an assistant message with tool_calls maps to a tool_use content block, no text loss", () => {
  const messages = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          // OpenAI sends arguments as a JSON STRING — Anthropic's `input` must be the parsed
          // object. A regression that forwards the raw string would 400 upstream.
          function: { name: "web_search", arguments: '{"query":"cats"}' },
        },
      ],
    },
  ];
  const mapped = mapMessagesToAnthropic(messages as never);
  assert.equal(mapped.length, 1);
  assert.deepEqual(mapped[0].content, [
    { type: "tool_use", id: "call_1", name: "web_search", input: { query: "cats" } },
  ]);
});

test("an assistant message with BOTH text and tool_calls keeps the text block first", () => {
  const messages = [
    {
      role: "assistant",
      content: "Let me look that up.",
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "web_search", arguments: "{}" } },
      ],
    },
  ];
  const mapped = mapMessagesToAnthropic(messages as never);
  assert.deepEqual(mapped[0].content, [
    { type: "text", text: "Let me look that up." },
    { type: "tool_use", id: "call_1", name: "web_search", input: {} },
  ]);
});

test("consecutive tool-role messages merge into ONE Anthropic user message with multiple tool_result blocks", () => {
  const messages = [
    { role: "user", content: "search two things" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "web_search", arguments: "{}" } },
        { id: "call_2", type: "function", function: { name: "web_search", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: "result one" },
    { role: "tool", tool_call_id: "call_2", content: "result two" },
  ];
  const mapped = mapMessagesToAnthropic(messages as never);
  // user, assistant(tool_use x2), ONE merged user(tool_result x2) — not two separate user
  // messages, which would 400 with "tool_use ids were found without tool_result blocks
  // immediately after".
  assert.equal(mapped.length, 3);
  assert.equal(mapped[2].role, "user");
  assert.deepEqual(mapped[2].content, [
    { type: "tool_result", tool_use_id: "call_1", content: "result one" },
    { type: "tool_result", tool_use_id: "call_2", content: "result two" },
  ]);
});

test("a tool-role run is flushed before a following non-tool message, preserving order", () => {
  const messages = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "web_search", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: "the result" },
    { role: "user", content: "thanks, now what?" },
  ];
  const mapped = mapMessagesToAnthropic(messages as never);
  assert.equal(mapped.length, 3);
  assert.deepEqual(mapped[1].content, [
    { type: "tool_result", tool_use_id: "call_1", content: "the result" },
  ]);
  assert.deepEqual(mapped[2].content, [{ type: "text", text: "thanks, now what?" }]);
});

test("convertRequest itself (not just the helper) routes tool-role messages through the merge", () => {
  // Guards the WIRING: implementing mapMessagesToAnthropic but forgetting to call it from
  // convertRequest would leave every tool result mapped as plain text and 400 upstream.
  const out = convert({
    messages: [
      { role: "user", content: "search two things" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "web_search", arguments: "{}" } },
          { id: "call_2", type: "function", function: { name: "web_search", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "result one" },
      { role: "tool", tool_call_id: "call_2", content: "result two" },
    ],
  });
  const messages = out.messages as Array<{ role: string; content: unknown[] }>;
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[1].content, [
    { type: "tool_use", id: "call_1", name: "web_search", input: {} },
    { type: "tool_use", id: "call_2", name: "web_search", input: {} },
  ]);
  assert.deepEqual(messages[2].content, [
    { type: "tool_result", tool_use_id: "call_1", content: "result one" },
    { type: "tool_result", tool_use_id: "call_2", content: "result two" },
  ]);
});
