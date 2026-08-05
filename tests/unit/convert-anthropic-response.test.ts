import { test } from "node:test";
import assert from "node:assert/strict";
import { convertResponse, mapStopReason } from "../../jroute/convert/anthropic/response.ts";
import type { AnthropicResponseJson } from "../../jroute/convert/anthropic/response.ts";

const base: AnthropicResponseJson = {
  id: "msg_01ABC",
  content: [{ type: "text", text: "Hello there." }],
  stop_reason: "end_turn",
  usage: { input_tokens: 25, output_tokens: 12 },
};

test("converts content blocks into a single OpenAI message string", () => {
  const out = convertResponse(base, "claude-sonnet-4-6");
  const choices = out.choices as Array<{ message: { role: string; content: string } }>;
  assert.equal(choices[0].message.role, "assistant");
  assert.equal(choices[0].message.content, "Hello there.");
});

test("joins multiple text blocks with no separator", () => {
  const multi: AnthropicResponseJson = {
    ...base,
    content: [
      { type: "text", text: "Hello " },
      { type: "text", text: "there." },
    ],
  };
  const out = convertResponse(multi, "claude-sonnet-4-6");
  const choices = out.choices as Array<{ message: { content: string } }>;
  assert.equal(choices[0].message.content, "Hello there.");
});

test("emits the OpenAI chat.completion envelope shape", () => {
  const out = convertResponse(base, "claude-sonnet-4-6");
  assert.equal(out.object, "chat.completion");
  assert.equal(out.model, "claude-sonnet-4-6");
  assert.equal(typeof out.id, "string");
  assert.equal(typeof out.created, "number");
  const choices = out.choices as unknown[];
  assert.equal(choices.length, 1);
});

test("sums input_tokens, cache_creation_input_tokens, and cache_read_input_tokens into prompt_tokens", () => {
  const cached: AnthropicResponseJson = {
    ...base,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 50,
    },
  };
  const out = convertResponse(cached, "claude-sonnet-4-6");
  const usage = out.usage as {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  assert.equal(usage.prompt_tokens, 160, "10 + 100 + 50 — omitting cache fields undercounts");
  assert.equal(usage.completion_tokens, 5);
  assert.equal(usage.total_tokens, 165);
});

test("a response with no usage field at all does not throw", () => {
  const noUsage: AnthropicResponseJson = { ...base, usage: undefined };
  const out = convertResponse(noUsage, "claude-sonnet-4-6");
  const usage = out.usage as {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  assert.equal(usage.prompt_tokens, 0);
  assert.equal(usage.completion_tokens, 0);
});

test("maps end_turn to stop and max_tokens to length", () => {
  const outEndTurn = convertResponse(base, "claude-sonnet-4-6");
  const outMaxTokens = convertResponse({ ...base, stop_reason: "max_tokens" }, "claude-sonnet-4-6");
  const choicesEnd = outEndTurn.choices as Array<{ finish_reason: string }>;
  const choicesMax = outMaxTokens.choices as Array<{ finish_reason: string }>;
  assert.equal(choicesEnd[0].finish_reason, "stop");
  assert.equal(choicesMax[0].finish_reason, "length");
});

test("maps refusal to content_filter, not an error", () => {
  const refusal: AnthropicResponseJson = {
    id: "msg_01REFUSE",
    content: [],
    stop_reason: "refusal",
    usage: { input_tokens: 10, output_tokens: 0 },
  };
  const out = convertResponse(refusal, "claude-sonnet-4-6");
  const choices = out.choices as Array<{
    finish_reason: string;
    message: { content: string };
  }>;
  assert.equal(choices[0].finish_reason, "content_filter");
  assert.equal(
    choices[0].message.content,
    "",
    "a refusal renders as an empty message, not a thrown error"
  );
});

test("maps pause_turn and tool_use", () => {
  assert.equal(mapStopReason("pause_turn"), "stop");
  assert.equal(mapStopReason("tool_use"), "tool_calls");
});

test("an unrecognized stop_reason degrades to stop rather than throwing", () => {
  assert.doesNotThrow(() => mapStopReason("some_future_reason_this_converter_has_never_seen"));
  assert.equal(mapStopReason("some_future_reason_this_converter_has_never_seen"), "stop");
});

test("null stop_reason (still-streaming shape reused non-streaming) maps to stop", () => {
  assert.equal(mapStopReason(null), "stop");
  assert.equal(mapStopReason(undefined), "stop");
});
