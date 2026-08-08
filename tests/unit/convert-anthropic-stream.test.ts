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

// ---------------------------------------------------------------------------
// chunk-boundary hardening — three-way replay (Task 5)
// ---------------------------------------------------------------------------

/** Drives a full buffer through parseSseFrames + convertAnthropicEvent, feeding `rest`
 * forward exactly as the real TransformStream (Task 6) will. Returns every emitted chunk
 * across the whole sequence, in order. */
function replay(chunks: string[]): Array<Record<string, unknown>> {
  const state = createStreamState("claude-sonnet-4-6");
  let buffer = "";
  const out: Array<Record<string, unknown>> = [];
  for (const piece of chunks) {
    buffer += piece;
    const { frames, rest } = parseSseFrames(buffer);
    buffer = rest;
    for (const frame of frames) {
      const result = convertAnthropicEvent(frame.event, frame.data, state);
      out.push(...result.chunks);
    }
  }
  return out;
}

const FULL_SEQUENCE =
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01X","usage":{"input_tokens":10}}}\n\n' +
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n' +
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n' +
  'event: message_stop\ndata: {"type":"message_stop"}\n\n';

test("chunk-boundary replay: whole buffer as one piece", () => {
  const out = replay([FULL_SEQUENCE]);
  assert.equal(out.length, 4, "role chunk + content chunk + finish chunk + usage chunk");
});

test("chunk-boundary replay: split mid-frame produces identical output to the whole buffer", () => {
  const cut = FULL_SEQUENCE.indexOf('"text_delta"') + 5; // lands inside the content_block_delta frame
  const whole = replay([FULL_SEQUENCE]);
  const split = replay([FULL_SEQUENCE.slice(0, cut), FULL_SEQUENCE.slice(cut)]);
  assert.deepEqual(split, whole, "an arbitrary mid-frame split must not change the output");
});

test("chunk-boundary replay: one byte at a time produces identical output to the whole buffer", () => {
  const whole = replay([FULL_SEQUENCE]);
  const oneAtATime = replay(FULL_SEQUENCE.split(""));
  assert.deepEqual(
    oneAtATime,
    whole,
    "single-character-at-a-time delivery must not change the output"
  );
});

test("chunk-boundary replay: split exactly on the \\n\\n delimiter (one chunk ends in \\n, next starts with \\n)", () => {
  // This split point is adversarial: the blank-line delimiter is itself bisected, so the
  // first chunk ends with "\n" and the second starts with "\n". A naive implementation that
  // splits on "\n\n" within a single call might miss a frame whose terminator spans two
  // consecutive chunks. The buffer-accumulation model (rest += next_chunk) must handle this
  // correctly by construction: both "\n" halves end up in the same buffer call.
  const firstFrameEnd = FULL_SEQUENCE.indexOf("\n\n"); // offset of the first blank-line separator
  const delimiterMidpoint = firstFrameEnd + 1; // cut after the first '\n', before the second
  const whole = replay([FULL_SEQUENCE]);
  const split = replay([
    FULL_SEQUENCE.slice(0, delimiterMidpoint),
    FULL_SEQUENCE.slice(delimiterMidpoint),
  ]);
  assert.deepEqual(
    split,
    whole,
    "a split that bisects the \\n\\n frame delimiter must not change the output"
  );
});

test("chunk-boundary replay: a multi-byte UTF-8 character split across chunks decodes correctly", () => {
  // A TextDecoder with { stream: true } — as the real Task 6 wrapper uses — buffers an
  // incomplete UTF-8 sequence until the next chunk completes it. This test proves the
  // buffering happens BEFORE parseSseFrames ever sees the text, by decoding bytes here the
  // same way the real wrapper will, rather than asserting on parseSseFrames alone (which
  // only ever sees valid text, by construction, once decoding is done correctly upstream).
  const withEmoji =
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"👍"}}\n\n';
  const bytes = new TextEncoder().encode(withEmoji);
  // 👍 is a 4-byte UTF-8 sequence (U+1F44D). Split the byte stream in the middle of it.
  const emojiByteOffset = bytes.length - 8; // inside the JSON's escaped/raw emoji bytes
  const decoder = new TextDecoder();
  const state = createStreamState("claude-sonnet-4-6");
  let buffer = "";
  const out: Array<Record<string, unknown>> = [];
  for (const part of [bytes.slice(0, emojiByteOffset), bytes.slice(emojiByteOffset)]) {
    buffer += decoder.decode(part, { stream: true });
    const { frames, rest } = parseSseFrames(buffer);
    buffer = rest;
    for (const frame of frames) {
      const result = convertAnthropicEvent(frame.event, frame.data, state);
      out.push(...result.chunks);
    }
  }
  const choices = out[0].choices as Array<{ delta: { content: string } }>;
  assert.equal(
    choices[0].delta.content,
    "👍",
    "a byte-split multi-byte character must decode intact"
  );
});

// ---------------------------------------------------------------------------
// errorEventBytes (Task 6)
// ---------------------------------------------------------------------------
import { errorEventBytes } from "../../jroute/sse.ts";

test("errorEventBytes encodes two SSE frames as bytes", () => {
  const bytes = errorEventBytes("boom");
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('"message":"boom"'));
  assert.ok(text.includes("data: [DONE]"));
});

test("errorEventBytes accepts a custom error type", () => {
  const bytes = errorEventBytes("boom", "billing_error");
  const text = new TextDecoder().decode(bytes);
  assert.ok(text.includes('"type":"billing_error"'));
});

// ---------------------------------------------------------------------------
// createAnthropicStreamTransform (Task 6)
// ---------------------------------------------------------------------------
import { createAnthropicStreamTransform } from "../../jroute/convert/anthropic/stream.ts";

/** Pipes a byte-producing source through the transform and collects the decoded output. */
async function runTransform(
  sourceChunks: Uint8Array[],
  options: { model: string; onComplete: (r: unknown) => void }
): Promise<string> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of sourceChunks) controller.enqueue(c);
      controller.close();
    },
  });
  const transformed = source.pipeThrough(createAnthropicStreamTransform(options));
  const reader = transformed.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

test("the wrapper emits OpenAI SSE frames and terminates with [DONE] on message_stop", async () => {
  const encoder = new TextEncoder();
  const sequence =
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01Y","usage":{"input_tokens":5}}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n' +
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  let completed: unknown = null;
  const out = await runTransform([encoder.encode(sequence)], {
    model: "claude-sonnet-4-6",
    onComplete: (r) => {
      completed = r;
    },
  });
  assert.ok(out.includes('"role":"assistant"'));
  assert.ok(out.includes('"content":"Hi"'));
  assert.ok(out.includes("data: [DONE]"));
  assert.deepEqual(completed, { promptTokens: 5, outputTokens: 1, reason: "completed" });
});

test("an event: error mid-stream produces a SANITIZED errorEventBytes frame, not a throw", async () => {
  const encoder = new TextEncoder();
  const sequence =
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01Z","usage":{"input_tokens":5}}}\n\n' +
    'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"sk-live-abcdefghijklmnopqrstuvwx leaked in upstream text"}}\n\n';
  let completed: unknown = null;
  const out = await runTransform([encoder.encode(sequence)], {
    model: "claude-sonnet-4-6",
    onComplete: (r) => {
      completed = r;
    },
  });
  assert.ok(
    !out.includes("sk-live-abcdefghijklmnopqrstuvwx"),
    "an upstream error message must be sanitized before hitting the wire"
  );
  assert.ok(out.includes("[redacted]"));
  assert.ok(out.includes("data: [DONE]"));
  assert.deepEqual(completed, { promptTokens: 5, outputTokens: null, reason: "upstream-closed" });
});

test("the transform never throws even on a completely malformed byte sequence", async () => {
  const encoder = new TextEncoder();
  await assert.doesNotReject(
    runTransform([encoder.encode("this is not SSE at all, just garbage\n\nmore garbage\n\n")], {
      model: "claude-sonnet-4-6",
      onComplete: () => {},
    })
  );
});

test("a source that closes without message_stop reports upstream-closed via flush", async () => {
  const encoder = new TextEncoder();
  const sequence =
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01W","usage":{"input_tokens":3}}}\n\n';
  let completed: unknown = null;
  const out = await runTransform([encoder.encode(sequence)], {
    model: "claude-sonnet-4-6",
    onComplete: (r) => {
      completed = r;
    },
  });
  assert.ok(out.includes("Upstream connection closed unexpectedly"));
  assert.deepEqual(completed, {
    promptTokens: null,
    outputTokens: null,
    reason: "upstream-closed",
  });
});

// ---------------------------------------------------------------------------
// cancel() handler — post-dial client hangup (Task 8)
// ---------------------------------------------------------------------------

test("cancelling the transform reports client-hangup with partial tokens, not completed or upstream-closed", async () => {
  const encoder = new TextEncoder();
  const sequence =
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01H","usage":{"input_tokens":8}}}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n';
  // No message_delta / message_stop in this sequence — the "connection" is still open when
  // the consumer cancels, simulating a real mid-stream client disconnect.
  let completed: unknown = null;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sequence));
      // Deliberately never closes — the consumer below cancels instead.
    },
  });
  const transformed = source.pipeThrough(
    createAnthropicStreamTransform({
      model: "claude-sonnet-4-6",
      onComplete: (r) => {
        completed = r;
      },
    })
  );
  const reader = transformed.getReader();
  await reader.read(); // consume the role/content chunks so the pipe is flowing
  await reader.cancel("client went away");
  assert.deepEqual(completed, { promptTokens: 8, outputTokens: null, reason: "client-hangup" });
});

test("cancelling before message_start captured anything reports null tokens, not zero", () => {
  let completed: unknown = null;
  const transform = createAnthropicStreamTransform({
    model: "claude-sonnet-4-6",
    onComplete: (r) => {
      completed = r;
    },
  });
  // Drive `cancel()` directly against the transformer's writable side without ever calling
  // `transform()`, to isolate the "hangup before any frame arrived" case.
  const writer = transform.writable.getWriter();
  void writer.abort("client went away immediately");
  return transform.readable.cancel("client went away immediately").then(() => {
    assert.deepEqual(completed, {
      promptTokens: null,
      outputTokens: null,
      reason: "client-hangup",
    });
  });
});

test("cancel mid-stream then upstream closes fires onComplete exactly once", async () => {
  // This test verifies the exactly-once contract for the cancel() path. When a consumer
  // cancels mid-stream, cancel() fires and sets terminated=true. The source close that
  // follows (simulating the upstream eventually responding to the pipe cancellation) cannot
  // trigger a second onComplete because: (a) the cancel propagation closes the writable
  // side of the TransformStream before flush() can run, and (b) flush()'s own
  // `if (!terminated)` guard additionally blocks any second fire. The test asserts
  // calls===1 as the invariant the production `if (!terminated)` guard upholds.
  const encoder = new TextEncoder();
  const sequence =
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01N","usage":{"input_tokens":5}}}\n\n';
  let calls = 0;
  let sourceController!: ReadableStreamDefaultController<Uint8Array>;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      sourceController = controller;
      controller.enqueue(encoder.encode(sequence));
      // Does NOT close yet — consumer cancels first.
    },
  });
  const transformed = source.pipeThrough(
    createAnthropicStreamTransform({
      model: "claude-sonnet-4-6",
      onComplete: () => {
        calls++;
      },
    })
  );
  const reader = transformed.getReader();
  await reader.read(); // consume the role chunk — stream is flowing but not terminated
  await reader.cancel("client went away"); // fires cancel() → sets terminated=true → calls=1
  // Attempt to close the source after cancel (mimics upstream eventually closing).
  // The writable side is already cancelled so this throws — the catch suppresses it.
  try {
    sourceController.close();
  } catch {
    /* expected: pipe already cancelled */
  }
  assert.equal(
    calls,
    1,
    "onComplete must fire exactly once even when the source is closed after cancel"
  );
});
