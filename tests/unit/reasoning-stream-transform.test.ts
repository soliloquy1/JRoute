// tests/unit/reasoning-stream-transform.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapWithReasoningTransform } from "../../jroute/reasoningStreamTransform.ts";
import { ReasoningTagPairSchema } from "../../src/lib/prompts/reasoningTagSchema.ts";

function pair(overrides: Record<string, unknown>) {
  return ReasoningTagPairSchema.parse({ openTag: "<think>", closeTag: "</think>", ...overrides });
}

function sseChunk(content: string, finishReason: string | null = null): string {
  const payload = {
    id: "c1",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function byteStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const all = encoder.encode(frames.join(""));
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= all.length) {
        controller.close();
        return;
      }
      controller.enqueue(all.slice(offset));
      offset = all.length;
    },
  });
}

async function collectDeltas(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  const deltas: string[] = [];
  for (const block of buffer.split("\n\n")) {
    if (!block.startsWith("data:")) continue;
    const data = block.slice(5).trim();
    if (data === "[DONE]" || data.length === 0) continue;
    const parsed = JSON.parse(data) as { choices: Array<{ delta: { content?: string } }> };
    const content = parsed.choices[0]?.delta?.content;
    if (content) deltas.push(content);
  }
  return deltas;
}

test("wrapWithReasoningTransform strips an explicit block spanning multiple chunks", async () => {
  const p = pair({});
  const input = byteStream([
    sseChunk("hi "),
    sseChunk("<think>"),
    sseChunk("secret plan across chunks"),
    sseChunk("</think>"),
    sseChunk(" there"),
    sseChunk("", "stop"),
    "data: [DONE]\n\n",
  ]);
  const out = wrapWithReasoningTransform(input, [p], "req1");
  const deltas = await collectDeltas(out);
  assert.equal(deltas.join(""), "hi  there");
});

test("wrapWithReasoningTransform strips a block larger than the old 200-codepoint regex margin", async () => {
  const p = pair({});
  const longReasoning = "x".repeat(1000);
  const input = byteStream([
    sseChunk(`<think>${longReasoning}</think>`),
    sseChunk("final answer"),
    sseChunk("", "stop"),
    "data: [DONE]\n\n",
  ]);
  const out = wrapWithReasoningTransform(input, [p], "req2");
  const deltas = await collectDeltas(out);
  assert.equal(deltas.join(""), "final answer");
});

test("wrapWithReasoningTransform handles implicit reasoning split across chunks", async () => {
  const p = pair({ expectImplicitOpen: true });
  const input = byteStream([
    sseChunk("part of the reasoning "),
    sseChunk("more reasoning</think>"),
    sseChunk("the real reply"),
    sseChunk("", "stop"),
    "data: [DONE]\n\n",
  ]);
  const out = wrapWithReasoningTransform(input, [p], "req3");
  const deltas = await collectDeltas(out);
  assert.equal(deltas.join(""), "the real reply");
});

test("wrapWithReasoningTransform does not send a content:\"\" frame while still holding back", async () => {
  const p = pair({ expectImplicitOpen: true });
  const input = byteStream([sseChunk("just some plain text")]); // stream just closes
  const out = wrapWithReasoningTransform(input, [p], "req4");
  const reader = out.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  const dataFrames = buffer
    .split("\n\n")
    .filter((block) => block.startsWith("data:") && block.slice(5).trim().length > 0);
  assert.equal(dataFrames.length, 1);
  assert.match(dataFrames[0], /"content":"just some plain text"/);
});

test("wrapWithReasoningTransform: finish_reason frame immediately followed by [DONE] does not double-flush", async () => {
  const p = pair({});
  const input = byteStream([
    sseChunk("<think>x</think>hi"),
    sseChunk("", "stop"),
    "data: [DONE]\n\n",
  ]);
  const out = wrapWithReasoningTransform(input, [p], "req5");
  const deltas = await collectDeltas(out);
  assert.equal(deltas.join(""), "hi");
});
