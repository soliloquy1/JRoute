// jroute/reasoningStreamTransform.ts
import { parseSseFrames } from "./convert/anthropic/stream.ts";
import { createReasoningScanner } from "../src/lib/prompts/reasoningTagScanner.ts";
import type { ReasoningTagPair } from "../src/lib/prompts/reasoningTagSchema.ts";

function tailChunk(content: string): Record<string, unknown> {
  return {
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

export function wrapWithReasoningTransform(
  inner: ReadableStream<Uint8Array>,
  tagPairs: ReasoningTagPair[],
  requestId: string
): ReadableStream<Uint8Array> {
  void requestId; // reserved for future debugLog correlation, unused by the scanner itself
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const scanner = createReasoningScanner(tagPairs);
  let flushed = false;

  return inner.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const { frames, rest } = parseSseFrames(buffer);
        buffer = rest;

        for (const frame of frames) {
          if (frame.data === "[DONE]") {
            if (!flushed) {
              flushed = true;
              const tail = scanner.finish();
              if (tail.length > 0) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(tailChunk(tail))}\n\n`));
              }
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            continue;
          }

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(frame.data) as Record<string, unknown>;
          } catch {
            controller.enqueue(encoder.encode(`data: ${frame.data}\n\n`));
            continue;
          }

          const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
          const delta = choice?.delta as { content?: unknown } | undefined;

          if (!choice || typeof delta?.content !== "string" || delta.content.length === 0) {
            if (choice?.finish_reason != null && !flushed) {
              flushed = true;
              const tail = scanner.finish();
              if (tail.length > 0) {
                const mergedDelta = { ...(delta ?? {}), content: tail };
                const outParsed = { ...parsed, choices: [{ ...choice, delta: mergedDelta }] };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(outParsed)}\n\n`));
                continue;
              }
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
            continue;
          }

          const emitted = scanner.push(delta.content);
          // See regexStreamTransform.ts's identical fix: a sibling delta field (e.g.
          // Gemini's role: "assistant" bundled into the first content-bearing delta) must
          // still reach the client even while content itself is held back by detection.
          const hasOtherDeltaFields = Object.keys(delta).some((k) => k !== "content");
          if (emitted.length > 0 || hasOtherDeltaFields) {
            const outDelta: Record<string, unknown> = { ...delta };
            if (emitted.length > 0) {
              outDelta.content = emitted;
            } else {
              delete outDelta.content;
            }
            const outParsed = { ...parsed, choices: [{ ...choice, delta: outDelta }] };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(outParsed)}\n\n`));
          }

          if (choice.finish_reason != null && !flushed) {
            flushed = true;
            const tail = scanner.finish();
            if (tail.length > 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(tailChunk(tail))}\n\n`));
            }
          }
        }
      },
      flush(controller) {
        if (flushed) return;
        flushed = true;
        const tail = scanner.finish();
        if (tail.length > 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(tailChunk(tail))}\n\n`));
        }
      },
    })
  );
}
