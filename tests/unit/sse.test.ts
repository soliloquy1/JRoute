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

function countPings(s: string): number {
  return s.split(": ping").length - 1;
}

/**
 * Number of live timer handles in the process. A keepalive interval that is
 * never cleared shows up here as a handle that outlives the stream, which is
 * the leak this suite guards: one per proxied request.
 */
function liveTimers(): number {
  return process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
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

test("emits a keepalive comment before the inner stream's first byte", async () => {
  const out = await drain(keepaliveStream(streamOf(["data: x\n\n"], 120), 40));
  assert.ok(out.includes(": ping\n\n"), "expected a keepalive comment");
  assert.ok(out.includes("data: x\n\n"), "inner payload must still arrive");
  // Ordering is the point: the inner stream is silent for 120ms against a 40ms
  // interval, so keepalives must reach the wire before the payload does. An
  // implementation that only starts pinging after the first chunk fails here.
  assert.ok(
    out.indexOf(": ping\n\n") < out.indexOf("data: x\n\n"),
    `keepalive must precede the payload, got: ${JSON.stringify(out)}`
  );
});

test("stops emitting keepalives once the inner stream closes", async () => {
  const baseline = liveTimers();

  const stream = keepaliveStream(streamOf(["data: x\n\n"]), 10);
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  const pingsAtClose = countPings(out);

  // Hold the accumulator open across a window several intervals wide.
  await new Promise((r) => setTimeout(r, 60));

  // Nothing may leak into the delivered bytes after close.
  assert.equal(countPings(out) - pingsAtClose, 0, "no keepalives may arrive after close");

  // The interval itself must be gone. Without this the timer keeps firing into
  // a closed controller: invisible in the output (the enqueue throws and is
  // swallowed) but a live handle leaked per request.
  assert.equal(liveTimers(), baseline, "keepalive interval must be cleared on close");
});

test("errorEventStream emits a terminated SSE error", async () => {
  const out = await drain(errorEventStream("upstream unavailable"));
  assert.ok(out.includes('"message":"upstream unavailable"'));
  assert.ok(out.endsWith("data: [DONE]\n\n"));
});
