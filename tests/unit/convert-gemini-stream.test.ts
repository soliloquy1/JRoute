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
