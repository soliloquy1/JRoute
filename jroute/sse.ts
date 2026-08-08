// jroute/sse.ts
const encoder = new TextEncoder();

export function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Tells nginx not to buffer; without it the proxy holds chunks and the
    // keepalives never reach the client (spec §5.1).
    "X-Accel-Buffering": "no",
  };
}

/**
 * Spec §5.1. Emits `: ping` comment lines whenever `inner` has been silent for
 * `intervalMs`, so an intermediary's idle timeout cannot kill a long tool loop.
 */
export function keepaliveStream(
  inner: ReadableStream<Uint8Array>,
  intervalMs = 15000
): ReadableStream<Uint8Array> {
  const reader = inner.getReader();
  let timer: ReturnType<typeof setInterval> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // Controller already closed; the pump's finally clears the timer.
        }
      }, intervalMs);

      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          clearInterval(timer);
        }
      })();
    },
    cancel(reason) {
      clearInterval(timer);
      return reader.cancel(reason);
    },
  });
}

export function errorEventStream(message: string): ReadableStream<Uint8Array> {
  const payload = JSON.stringify({ error: { message, type: "upstream_error" } });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

/**
 * Same two frames as `errorEventStream`, as raw bytes for enqueueing into an ALREADY-OPEN
 * stream controller (design spec §8.5). `errorEventStream` builds a brand-new
 * `ReadableStream` and can only be used as a pre-stream failure response — once headers are
 * sent and bytes are already flowing, the only channel left is a frame written into the
 * live controller, which is what this function is for.
 *
 * Unlike `errorEventStream`, this does NOT hardcode `type: "upstream_error"` — callers pass
 * the type so design spec §10's error-type mapping can flow through. Callers are
 * responsible for sanitizing `message` before calling this — it is written to the wire
 * as-is.
 */
export function errorEventBytes(message: string, type = "upstream_error"): Uint8Array {
  const payload = JSON.stringify({ error: { message, type } });
  return encoder.encode(`data: ${payload}\n\ndata: [DONE]\n\n`);
}
