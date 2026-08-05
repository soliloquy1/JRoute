import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSseFrames,
  createStreamState,
  convertAnthropicEvent,
} from "../../jroute/convert/anthropic/stream.ts";

// ---------------------------------------------------------------------------
// parseSseFrames
// ---------------------------------------------------------------------------

test("parses a single complete frame", () => {
  const { frames, rest } = parseSseFrames('event: ping\ndata: {"type":"ping"}\n\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "ping");
  assert.equal(frames[0].data, '{"type":"ping"}');
  assert.equal(rest, "");
});

test("parses multiple frames in one buffer", () => {
  const buf =
    'event: ping\ndata: {"type":"ping"}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  const { frames, rest } = parseSseFrames(buf);
  assert.equal(frames.length, 2);
  assert.equal(frames[1].event, "message_stop");
  assert.equal(rest, "");
});

test("holds back an incomplete trailing frame as rest", () => {
  const { frames, rest } = parseSseFrames('event: ping\ndata: {"type":"pi');
  assert.equal(frames.length, 0);
  assert.equal(rest, 'event: ping\ndata: {"type":"pi');
});

test("defaults event to message when no event: line is present", () => {
  const { frames } = parseSseFrames('data: {"foo":1}\n\n');
  assert.equal(frames[0].event, "message");
});

// ---------------------------------------------------------------------------
// convertAnthropicEvent — ignore-allowlist
// ---------------------------------------------------------------------------

test("ping, content_block_start, and content_block_stop produce no chunks", () => {
  const state = createStreamState("claude-sonnet-4-6");
  for (const [event, data] of [
    ["ping", '{"type":"ping"}'],
    [
      "content_block_start",
      '{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    ],
    ["content_block_stop", '{"type":"content_block_stop","index":0}'],
  ]) {
    const result = convertAnthropicEvent(event, data, state);
    assert.deepEqual(result.chunks, []);
    assert.equal(result.terminate, false);
    assert.equal(result.upstreamError, null);
  }
});

// ---------------------------------------------------------------------------
// message_start
// ---------------------------------------------------------------------------

test("message_start emits a role-only chunk and captures the message id", () => {
  const state = createStreamState("claude-sonnet-4-6");
  const result = convertAnthropicEvent(
    "message_start",
    '{"type":"message_start","message":{"id":"msg_01ABC","usage":{"input_tokens":25,"output_tokens":1}}}',
    state
  );
  assert.equal(result.chunks.length, 1);
  const choices = result.chunks[0].choices as Array<{ delta: { role: string; content: string } }>;
  assert.equal(choices[0].delta.role, "assistant");
  assert.equal(choices[0].delta.content, "");
  assert.equal(result.chunks[0].id, "msg_01ABC");
});

// ---------------------------------------------------------------------------
// content_block_delta
// ---------------------------------------------------------------------------

test("content_block_delta emits a content-only chunk", () => {
  const state = createStreamState("claude-sonnet-4-6");
  const result = convertAnthropicEvent(
    "content_block_delta",
    '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
    state
  );
  assert.equal(result.chunks.length, 1);
  const choices = result.chunks[0].choices as Array<{ delta: { content: string } }>;
  assert.equal(choices[0].delta.content, "Hello");
});

test("a content_block_delta with an unrecognized delta type fails loudly", () => {
  const state = createStreamState("claude-sonnet-4-6");
  const result = convertAnthropicEvent(
    "content_block_delta",
    '{"type":"content_block_delta","index":0,"delta":{"type":"future_block_kind","text":"x"}}',
    state
  );
  assert.equal(result.terminate, true);
  assert.ok(
    result.upstreamError,
    "an unrecognized content block type must not be silently dropped"
  );
});

// ---------------------------------------------------------------------------
// message_delta / message_stop — the two-chunk finish sequence
// ---------------------------------------------------------------------------

test("message_delta emits a finish_reason chunk and a separate usage-only chunk", () => {
  const state = createStreamState("claude-sonnet-4-6");
  const result = convertAnthropicEvent(
    "message_delta",
    '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":15}}',
    state
  );
  assert.equal(result.chunks.length, 2, "one message_delta produces TWO OpenAI chunks");
  const first = result.chunks[0].choices as Array<{
    finish_reason: string;
    delta: Record<string, unknown>;
  }>;
  assert.equal(first[0].finish_reason, "stop");
  assert.deepEqual(first[0].delta, {}, "the finish_reason chunk carries no content delta");
  assert.deepEqual(result.chunks[1].choices, [], "the usage chunk has empty choices");
  assert.ok(result.chunks[1].usage, "the usage chunk must carry usage");
});

test("message_stop signals termination with no chunks of its own", () => {
  const state = createStreamState("claude-sonnet-4-6");
  const result = convertAnthropicEvent("message_stop", '{"type":"message_stop"}', state);
  assert.equal(result.chunks.length, 0);
  assert.equal(result.terminate, true);
});

// ---------------------------------------------------------------------------
// event: error and malformed frames
// ---------------------------------------------------------------------------

test("event: error signals termination with the upstream message", () => {
  const state = createStreamState("claude-sonnet-4-6");
  const result = convertAnthropicEvent(
    "error",
    '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    state
  );
  assert.equal(result.terminate, true);
  assert.equal(result.upstreamError, "Overloaded");
});

test("a malformed (non-JSON) data frame fails loudly rather than throwing", () => {
  const state = createStreamState("claude-sonnet-4-6");
  assert.doesNotThrow(() => convertAnthropicEvent("content_block_delta", "not json at all", state));
  const result = convertAnthropicEvent("content_block_delta", "not json at all", state);
  assert.equal(result.terminate, true);
  assert.ok(result.upstreamError);
});

test("an entirely unrecognized event name fails loudly", () => {
  const state = createStreamState("claude-sonnet-4-6");
  const result = convertAnthropicEvent("some_future_event_type", '{"type":"x"}', state);
  assert.equal(result.terminate, true);
  assert.ok(result.upstreamError);
});

// ---------------------------------------------------------------------------
// cache tokens (Task 4)
// ---------------------------------------------------------------------------

test("message_start sums input_tokens with both cache token fields", () => {
  const state = createStreamState("claude-sonnet-4-6");
  convertAnthropicEvent(
    "message_start",
    JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_01CACHE",
        usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 50 },
      },
    }),
    state
  );
  // message_delta reads back state.promptTokens into the final usage chunk — assert
  // through that, since state itself is intentionally opaque to callers.
  const deltaResult = convertAnthropicEvent(
    "message_delta",
    '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
    state
  );
  const usageChunk = deltaResult.chunks[1] as { usage: { prompt_tokens: number } };
  assert.equal(
    usageChunk.usage.prompt_tokens,
    160,
    "10 + 100 + 50 — omitting cache fields undercounts"
  );
});

test("message_start with no cache fields at all still works (uncached request)", () => {
  const state = createStreamState("claude-sonnet-4-6");
  convertAnthropicEvent(
    "message_start",
    '{"type":"message_start","message":{"id":"msg_01PLAIN","usage":{"input_tokens":25}}}',
    state
  );
  const deltaResult = convertAnthropicEvent(
    "message_delta",
    '{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}',
    state
  );
  const usageChunk = deltaResult.chunks[1] as { usage: { prompt_tokens: number } };
  assert.equal(usageChunk.usage.prompt_tokens, 25);
});
