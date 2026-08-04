// tests/unit/sse.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { keepaliveStream, sseHeaders, errorEventStream } from "../../jroute/sse.ts";

const decoder = new TextDecoder();

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  let out = "";
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function streamOf(chunks: string[], delayMs = 0): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const c of chunks) {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    },
  });
}

test("sets streaming headers that defeat proxy buffering", () => {
  const h = sseHeaders();
  assert.equal(h["Content-Type"], "text/event-stream");
  assert.equal(h["Cache-Control"], "no-cache, no-transform");
  assert.equal(h["Connection"], "keep-alive");
  assert.equal(h["X-Accel-Buffering"], "no");
});

test("passes inner chunks through unchanged", async () => {
  const out = await drain(keepaliveStream(streamOf(["data: a\n\n", "data: b\n\n"]), 50_000));
  assert.equal(out, "data: a\n\ndata: b\n\n");
});

test("emits a keepalive comment while the inner stream is silent", async () => {
  const out = await drain(keepaliveStream(streamOf(["data: x\n\n"], 120), 40));
  assert.ok(out.includes(": ping\n\n"), "expected a keepalive comment");
  assert.ok(out.includes("data: x\n\n"), "inner payload must still arrive");
});

test("stops emitting keepalives once the inner stream closes", async () => {
  const out = await drain(keepaliveStream(streamOf(["data: x\n\n"]), 10));
  await new Promise((r) => setTimeout(r, 60));
  const pings = out.split(": ping").length - 1;
  assert.ok(pings <= 1, `expected no trailing keepalives, saw ${pings}`);
});

test("errorEventStream emits a terminated SSE error", async () => {
  const out = await drain(errorEventStream("upstream unavailable"));
  assert.ok(out.includes('"message":"upstream unavailable"'));
  assert.ok(out.endsWith("data: [DONE]\n\n"));
});
