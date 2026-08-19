// tests/unit/regex-stream-transform.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapWithRegexTransform } from "../../jroute/regexStreamTransform.ts";
import { RegexScriptSchema } from "../../src/lib/prompts/regexScriptSchema.ts";

const CTX = { char: "", user: "" };

function script(overrides: Record<string, unknown>) {
  return RegexScriptSchema.parse({ scriptName: "t", findRegex: "/x/", ...overrides });
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

function byteStream(frames: string[], bytesPerPush = 4096): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const all = encoder.encode(frames.join(""));
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= all.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + bytesPerPush, all.length);
      controller.enqueue(all.slice(offset, end));
      offset = end;
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

test("wrapWithRegexTransform: short response is fully transformed and flushed at finish_reason", async () => {
  const s = script({ findRegex: "/secret/", replaceString: "[redacted]" });
  const input = byteStream([
    sseChunk("the "),
    sseChunk("secret "),
    sseChunk("word"),
    sseChunk("", "stop"),
    "data: [DONE]\n\n",
  ]);
  const out = wrapWithRegexTransform(input, [s], CTX, "req1");
  const deltas = await collectDeltas(out);
  assert.equal(deltas.join(""), "the [redacted] word");
});

test("wrapWithRegexTransform: content beyond the hold-back margin is committed mid-stream", async () => {
  const s = script({ findRegex: "/a/g", replaceString: "A" });
  const long = "a".repeat(250);
  const input = byteStream([sseChunk(long), sseChunk("", "stop"), "data: [DONE]\n\n"]);
  const out = wrapWithRegexTransform(input, [s], CTX, "req2");
  const reader = out.getReader();
  const decoder = new TextDecoder();
  const { value } = await reader.read();
  const firstText = decoder.decode(value!);
  assert.match(firstText, /"content":"A+"/);
  await reader.cancel();
});

test("wrapWithRegexTransform: never drops or duplicates a codepoint when the commit invariant is violated", async () => {
  // "/x$/" is $-anchored: transforming a longer prefix does NOT necessarily start with
  // the shorter prefix's already-committed transform (the design review's counterexample).
  const s = script({ findRegex: "/x$/", replaceString: "Y" });
  const first = "x".repeat(221); // triggers the first commit: newCommittedRawLen = 21
  const second = "x".repeat(90); // triggers a second commit that must fail the guard
  const input = byteStream([
    sseChunk(first),
    sseChunk(second),
    sseChunk("", "stop"),
    "data: [DONE]\n\n",
  ]);
  const out = wrapWithRegexTransform(input, [s], CTX, "req3");
  const deltas = await collectDeltas(out);
  // First commit (21 chars of "x"*221): /x$/ matches only the last char -> "x"*20 + "Y".
  // Second commit (111 chars of the combined 311): the $ anchor now lands at index 110,
  // so index 20 (previously "Y") is plain "x" in the new candidate -> startsWith fails ->
  // passthrough for the rest, emitting the raw (untransformed) remaining 290 chars.
  const expected = "x".repeat(20) + "Y" + "x".repeat(290);
  const joined = deltas.join("");
  assert.equal(joined, expected);
  assert.equal(joined.length, first.length + second.length);
});

test("wrapWithRegexTransform: relays a non-content frame (usage-only chunk) unchanged", async () => {
  const s = script({ findRegex: "/a/", replaceString: "b" });
  const usageFrame = `data: ${JSON.stringify({ id: "c1", choices: [], usage: { total_tokens: 5 } })}\n\n`;
  const input = byteStream([sseChunk("a"), usageFrame, sseChunk("", "stop"), "data: [DONE]\n\n"]);
  const out = wrapWithRegexTransform(input, [s], CTX, "req4");
  const reader = out.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  assert.match(buffer, /"total_tokens":5/);
});

test("wrapWithRegexTransform: a byte-chunk boundary splitting a multi-byte UTF-8 character does not corrupt output", async () => {
  const s = script({ findRegex: "/x/", replaceString: "y" });
  // "🎉" is a 4-byte UTF-8 sequence — pushing 1 byte at a time forces mid-character splits.
  const input = byteStream([sseChunk("x🎉x"), sseChunk("", "stop"), "data: [DONE]\n\n"], 1);
  const out = wrapWithRegexTransform(input, [s], CTX, "req5");
  const deltas = await collectDeltas(out);
  assert.equal(deltas.join(""), "y🎉y");
});

test("wrapWithRegexTransform: a pure hold-back frame (nothing committed yet, no finish_reason) is not sent as an empty-content chunk", async () => {
  const s = script({ findRegex: "/zzz/", replaceString: "q" }); // never matches "hi"
  const input = byteStream([sseChunk("hi")]); // below the margin, stream just closes
  const out = wrapWithRegexTransform(input, [s], CTX, "req6");
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
  // Exactly one frame: the flush-produced chunk carrying the buffered "hi". No separate
  // content:"" chunk should have been sent while the text was still held back.
  assert.equal(dataFrames.length, 1);
  assert.match(dataFrames[0], /"content":"hi"/);
});

test("wrapWithRegexTransform: a sibling delta field (e.g. role) is not dropped while content is held back", async () => {
  // Gemini bundles role:"assistant" into the very first content-bearing delta rather than
  // sending it as its own frame — dropping the whole frame during hold-back would silently
  // drop the role announcement.
  const s = script({ findRegex: "/zzz/", replaceString: "q" }); // never matches
  const payload = {
    id: "c1",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [{ index: 0, delta: { role: "assistant", content: "hi" }, finish_reason: null }],
  };
  const input = byteStream([`data: ${JSON.stringify(payload)}\n\n`]); // stream just closes
  const out = wrapWithRegexTransform(input, [s], CTX, "reqRole");
  const reader = out.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  assert.match(buffer, /"role":"assistant"/);
});
