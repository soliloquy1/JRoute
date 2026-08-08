// tests/unit/convert-gemini-stream.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGeminiStreamState, convertGeminiChunk } from "../../jroute/convert/gemini/stream.ts";
import { parseSseFrames } from "../../jroute/convert/anthropic/stream.ts";

test("a content frame yields one OpenAI content chunk, no termination", () => {
  const state = createGeminiStreamState("gemini-2.0-flash");
  const result = convertGeminiChunk(
    JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] } }] }),
    state
  );
  assert.equal(result.terminate, false);
  const chunk = result.chunks[0] as { choices: Array<{ delta: { content: string } }> };
  assert.equal(chunk.choices[0].delta.content, "Hi");
});

test("the first content frame carries the assistant role delta", () => {
  const state = createGeminiStreamState("gemini-2.0-flash");
  const result = convertGeminiChunk(
    JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] } }] }),
    state
  );
  // First emitted chunk opens the message with role assistant (OpenAI convention).
  const first = result.chunks[0] as { choices: Array<{ delta: { role?: string } }> };
  assert.equal(first.choices[0].delta.role, "assistant");
});

test("the assistant role delta is sent only on the first content frame", () => {
  const state = createGeminiStreamState("gemini-2.0-flash");
  const r0 = convertGeminiChunk(
    JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] } }] }),
    state
  );
  const r1 = convertGeminiChunk(
    JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: " there" }] } }] }),
    state
  );
  const first = r0.chunks[0] as { choices: Array<{ delta: { role?: string } }> };
  const second = r1.chunks[0] as { choices: Array<{ delta: { role?: string } }> };
  assert.equal(first.choices[0].delta.role, "assistant");
  assert.equal(
    second.choices[0].delta.role,
    undefined,
    "role must be sent only once, not on every frame"
  );
});

test("a frame with finishReason terminates and emits finish + usage chunks", () => {
  const state = createGeminiStreamState("gemini-2.0-flash");
  convertGeminiChunk(
    JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text: "done" }] } }],
      usageMetadata: { promptTokenCount: 9 },
    }),
    state
  );
  const result = convertGeminiChunk(
    JSON.stringify({
      candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, totalTokenCount: 13 },
    }),
    state
  );
  assert.equal(result.terminate, true);
  // Two chunks: the finish_reason chunk, then a usage-only chunk with empty choices.
  const finishChunk = result.chunks[0] as { choices: Array<{ finish_reason: string }> };
  assert.equal(finishChunk.choices[0].finish_reason, "stop");
  const usageChunk = result.chunks[1] as {
    choices: unknown[];
    usage: { prompt_tokens: number; completion_tokens: number };
  };
  assert.deepEqual(usageChunk.choices, []);
  assert.equal(usageChunk.usage.prompt_tokens, 9);
  assert.equal(usageChunk.usage.completion_tokens, 4);
});

test("prompt tokens in the stream use promptTokenCount alone (cached already included)", () => {
  const state = createGeminiStreamState("gemini-2.0-flash");
  const result = convertGeminiChunk(
    JSON.stringify({
      candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 200,
        cachedContentTokenCount: 150,
        candidatesTokenCount: 5,
        totalTokenCount: 205,
      },
    }),
    state
  );
  const usageChunk = result.chunks[1] as { usage: { prompt_tokens: number } };
  assert.equal(usageChunk.usage.prompt_tokens, 200, "must not add cachedContentTokenCount");
});

test("a malformed data frame fails loud, does not throw", () => {
  const state = createGeminiStreamState("gemini-2.0-flash");
  const result = convertGeminiChunk("this is not json", state);
  assert.equal(result.terminate, true);
  assert.ok(result.upstreamError);
});

test("state exposes running token counts for the wrapper to read on completion", () => {
  const state = createGeminiStreamState("gemini-2.0-flash");
  convertGeminiChunk(
    JSON.stringify({
      candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
    }),
    state
  );
  assert.equal(state.promptTokens, 11);
  assert.equal(state.outputTokens, 7);
});

test("Gemini SSE frames survive the shared parseSseFrames framing", () => {
  const wire =
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"a"}]}}]}\n\n' +
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"b"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}\n\n';
  const { frames, rest } = parseSseFrames(wire);
  assert.equal(rest, "");
  assert.equal(frames.length, 2);
  const state = createGeminiStreamState("gemini-2.0-flash");
  const r0 = convertGeminiChunk(frames[0].data, state);
  assert.equal(
    (r0.chunks[0] as { choices: Array<{ delta: { content: string } }> }).choices[0].delta.content,
    "a"
  );
  const r1 = convertGeminiChunk(frames[1].data, state);
  assert.equal(r1.terminate, true);
});

import { createGeminiStreamTransform } from "../../jroute/convert/gemini/stream.ts";

/** Pipes byte chunks through the transform, collects decoded output. */
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
  const transformed = source.pipeThrough(createGeminiStreamTransform(options));
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

test("the wrapper emits OpenAI frames and a synthesized [DONE] on the finishReason frame", async () => {
  const encoder = new TextEncoder();
  const wire =
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]}}]}\n\n' +
    'data: {"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":1}}\n\n';
  let completed: unknown = null;
  const out = await runTransform([encoder.encode(wire)], {
    model: "gemini-2.0-flash",
    onComplete: (r) => {
      completed = r;
    },
  });
  assert.ok(out.includes('"role":"assistant"'));
  assert.ok(out.includes('"content":"Hi"'));
  assert.ok(out.includes("data: [DONE]"), "we synthesize [DONE]; Gemini never sends one");
  assert.deepEqual(completed, { promptTokens: 5, outputTokens: 1, reason: "completed" });
});

test("a malformed frame produces a SANITIZED error frame, not a throw", async () => {
  const encoder = new TextEncoder();
  const wire =
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]}}]}\n\n' +
    "data: sk-live-abcdefghijklmnopqrstuvwx not json\n\n";
  let completed: unknown = null;
  const out = await runTransform([encoder.encode(wire)], {
    model: "gemini-2.0-flash",
    onComplete: (r) => {
      completed = r;
    },
  });
  assert.ok(
    !out.includes("sk-live-abcdefghijklmnopqrstuvwx"),
    "upstream text must be sanitized before the wire"
  );
  // `errorEventBytes` itself emits BOTH the error frame AND a trailing `data: [DONE]\n\n`
  // (see jroute/sse.ts) — so the error path terminates the SSE stream with [DONE] without the
  // wrapper enqueuing it separately. This assertion confirms that termination, not the
  // natural-completion path.
  assert.ok(out.includes("data: [DONE]"));
  assert.equal((completed as { reason: string }).reason, "upstream-closed");
});

test("the transform never throws on completely malformed bytes", async () => {
  const encoder = new TextEncoder();
  await assert.doesNotReject(
    runTransform([encoder.encode("garbage with no data prefix\n\nmore garbage\n\n")], {
      model: "gemini-2.0-flash",
      onComplete: () => {},
    })
  );
});

test("a source that closes without a finishReason reports upstream-closed via flush", async () => {
  const encoder = new TextEncoder();
  // A content frame with REAL usage tokens but no terminal finishReason frame — the connection
  // dropped mid-stream. The truncation must still report NULL tokens: an upstream that dropped
  // before finishReason produced no CONFIRMED usage report, so reporting the partial state
  // would mislead the operator. The non-null token state is what makes this distinguishable
  // from a flush that (wrongly) echoes `state` back.
  const wire =
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"partial"}]}}],"usageMetadata":{"promptTokenCount":5}}\n\n';
  let completed: unknown = null;
  const out = await runTransform([encoder.encode(wire)], {
    model: "gemini-2.0-flash",
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

test("cancelling mid-stream reports client-hangup with partial tokens", async () => {
  const encoder = new TextEncoder();
  // A content frame that also carried usageMetadata but no finishReason yet.
  const wire =
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"partial"}]}}],"usageMetadata":{"promptTokenCount":8}}\n\n';
  let completed: unknown = null;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(wire));
      // never closes
    },
  });
  const transformed = source.pipeThrough(
    createGeminiStreamTransform({
      model: "gemini-2.0-flash",
      onComplete: (r) => {
        completed = r;
      },
    })
  );
  const reader = transformed.getReader();
  await reader.read();
  await reader.cancel("client went away");
  assert.deepEqual(completed, { promptTokens: 8, outputTokens: null, reason: "client-hangup" });
});
