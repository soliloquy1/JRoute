import { mapStopReason } from "./response.ts";
import { errorEventBytes } from "../../sse.ts";
import { sanitizeErrorMessage } from "../../errors.ts";

export interface SseFrame {
  event: string;
  data: string;
}

/**
 * Splits accumulated text into complete SSE frames plus a leftover partial frame.
 *
 * SSE frames are separated by a blank line ("\n\n"). A frame may span multiple physical
 * `fetch` chunks — the raw upstream stream can split at ANY byte boundary, including mid
 * "event:" line or mid "data:" line — so this function must be safe to call repeatedly
 * with partial input and never lose or duplicate a frame. `rest` carries forward whatever
 * text was not yet terminated by a blank line; the caller re-prepends it to the next
 * chunk's decoded text before calling this again (Task 5 hardens this against arbitrary
 * byte-boundary splits, including mid multi-byte UTF-8 character).
 */
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const frames: SseFrame[] = [];
  for (const block of parts) {
    if (block.trim().length === 0) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0) frames.push({ event, data: dataLines.join("\n") });
  }
  return { frames, rest };
}

export interface StreamState {
  model: string;
  id: string | null;
  promptTokens: number;
  outputTokens: number;
}

export function createStreamState(model: string): StreamState {
  return { model, id: null, promptTokens: 0, outputTokens: 0 };
}

export interface EventResult {
  chunks: Array<Record<string, unknown>>;
  usage: { promptTokens: number; outputTokens: number } | null;
  terminate: boolean;
  upstreamError: string | null;
}

function baseChunk(
  state: StreamState,
  delta: Record<string, unknown>,
  finishReason: string | null = null
): Record<string, unknown> {
  return {
    id: state.id ?? "chatcmpl-stream",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: state.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

const IGNORED_EVENTS = new Set(["ping", "content_block_start", "content_block_stop"]);
const NO_RESULT: EventResult = { chunks: [], usage: null, terminate: false, upstreamError: null };

/**
 * Converts one already-parsed Anthropic SSE frame into zero or more OpenAI-shaped chunk
 * objects, mutating `state` as a side effect (message id, running token counts).
 *
 * Two explicit sets (design spec §8.3): `ping`/`content_block_start`/`content_block_stop`
 * are ignored silently. Everything this function does not recognize — an unknown event
 * name, an unrecognized content-block delta type, or a non-JSON data frame — fails LOUDLY
 * (`terminate: true`, `upstreamError` set) rather than being silently dropped, since
 * silently dropping a frame can desynchronize `index` against what the client already
 * rendered.
 */
export function convertAnthropicEvent(
  event: string,
  data: string,
  state: StreamState
): EventResult {
  if (IGNORED_EVENTS.has(event)) return NO_RESULT;

  if (event === "message_stop") {
    return { chunks: [], usage: null, terminate: true, upstreamError: null };
  }

  if (event === "error") {
    let message = "Upstream error";
    try {
      const parsed = JSON.parse(data) as { error?: { message?: string } };
      message = parsed.error?.message ?? message;
    } catch {
      // Malformed error frame: fall back to the generic message rather than throwing.
    }
    return { chunks: [], usage: null, terminate: true, upstreamError: message };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return { chunks: [], usage: null, terminate: true, upstreamError: "Malformed upstream frame" };
  }

  if (event === "message_start") {
    const message = parsed.message as
      | {
          id?: string;
          usage?: {
            input_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
          };
        }
      | undefined;
    state.id = message?.id ?? state.id;
    const usage = message?.usage;
    // Sums all three prompt-side fields (design spec §8.1) — cache tokens are NOT included
    // in input_tokens, so reading input_tokens alone silently undercounts every cached
    // request.
    state.promptTokens =
      (usage?.input_tokens ?? 0) +
      (usage?.cache_creation_input_tokens ?? 0) +
      (usage?.cache_read_input_tokens ?? 0);
    return {
      chunks: [baseChunk(state, { role: "assistant", content: "" })],
      usage: null,
      terminate: false,
      upstreamError: null,
    };
  }

  if (event === "content_block_delta") {
    const delta = parsed.delta as { type?: string; text?: string } | undefined;
    if (delta?.type !== "text_delta") {
      return {
        chunks: [],
        usage: null,
        terminate: true,
        upstreamError: `Unrecognized content block type: ${String(delta?.type)}`,
      };
    }
    return {
      chunks: [baseChunk(state, { content: delta.text ?? "" })],
      usage: null,
      terminate: false,
      upstreamError: null,
    };
  }

  if (event === "message_delta") {
    const delta = parsed.delta as { stop_reason?: string | null } | undefined;
    const usage = parsed.usage as { output_tokens?: number } | undefined;
    state.outputTokens = usage?.output_tokens ?? 0;
    const finishReason = mapStopReason(delta?.stop_reason);
    const finalUsage = {
      prompt_tokens: state.promptTokens,
      completion_tokens: state.outputTokens,
      total_tokens: state.promptTokens + state.outputTokens,
    };
    // One message_delta produces TWO OpenAI chunks (design spec §8.1): finish_reason on its
    // own delta-less chunk, then usage on a SEPARATE trailing chunk with empty choices.
    return {
      chunks: [
        baseChunk(state, {}, finishReason),
        {
          id: state.id ?? "chatcmpl-stream",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [],
          usage: finalUsage,
        },
      ],
      usage: { promptTokens: state.promptTokens, outputTokens: state.outputTokens },
      terminate: false,
      upstreamError: null,
    };
  }

  return {
    chunks: [],
    usage: null,
    terminate: true,
    upstreamError: `Unrecognized event: ${event}`,
  };
}

export interface AnthropicStreamCompletion {
  promptTokens: number | null;
  outputTokens: number | null;
  reason: "completed" | "upstream-closed";
}

export interface AnthropicStreamOptions {
  model: string;
  onComplete: (result: AnthropicStreamCompletion) => void;
}

/**
 * The stateful boundary (design spec §3.2 — the only stateful module in convert/). Wraps
 * the pure `parseSseFrames`/`convertAnthropicEvent` functions in a real `TransformStream`,
 * decoding upstream bytes incrementally and re-encoding OpenAI-shaped SSE frames.
 *
 * HARD CONSTRAINT (§8.4): this transform must NEVER throw. Every code path is wrapped so a
 * malformed or unexpected upstream frame becomes an `errorEventBytes` frame instead of an
 * uncaught throw — `keepaliveStream` (jroute/sse.ts) calls `controller.error(err)` on an
 * inner-stream throw, which destroys the response body rather than emitting anything.
 *
 * `onComplete` fires EXACTLY ONCE, from one of: natural termination (`message_stop`,
 * `reason: "completed"`), a fail-loud event or upstream error mid-stream (`reason:
 * "upstream-closed"`), or the source closing before `message_stop` ever arrived (also
 * `"upstream-closed"`, via `flush`). This task does not add a `cancel()` handler — Task 8
 * adds the client-hangup case.
 */
export function createAnthropicStreamTransform(
  options: AnthropicStreamOptions
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = createStreamState(options.model);
  let buffer = "";
  let terminated = false;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (terminated) return;
      try {
        buffer += decoder.decode(chunk, { stream: true });
        const { frames, rest } = parseSseFrames(buffer);
        buffer = rest;

        for (const frame of frames) {
          const result = convertAnthropicEvent(frame.event, frame.data, state);
          for (const out of result.chunks) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(out)}\n\n`));
          }
          if (result.upstreamError) {
            controller.enqueue(errorEventBytes(sanitizeErrorMessage(result.upstreamError)));
            terminated = true;
            options.onComplete({
              promptTokens: state.promptTokens || null,
              outputTokens: state.outputTokens || null,
              reason: "upstream-closed",
            });
            controller.terminate();
            return;
          }
          if (result.terminate) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            terminated = true;
            options.onComplete({
              promptTokens: state.promptTokens || null,
              outputTokens: state.outputTokens || null,
              reason: "completed",
            });
            controller.terminate();
            return;
          }
        }
      } catch (err) {
        // Belt-and-suspenders: no path above is known to throw, but an upstream shape this
        // converter has never seen must still degrade to a frame, never an uncaught error.
        if (!terminated) {
          terminated = true;
          controller.enqueue(
            errorEventBytes(
              sanitizeErrorMessage(err instanceof Error ? err.message : "Stream conversion failed")
            )
          );
          options.onComplete({
            promptTokens: state.promptTokens || null,
            outputTokens: state.outputTokens || null,
            reason: "upstream-closed",
          });
          controller.terminate();
        }
      }
    },
    flush(controller) {
      // The upstream closed without a message_stop (a truncated connection) — surface it as
      // an error frame rather than silently ending the SSE stream with no [DONE].
      // Token counts are reported as null here: a connection that dropped before message_stop
      // never produced a confirmed usage report, so reporting partial state would be
      // misleading (the upstream may not have processed any tokens at all).
      if (!terminated) {
        terminated = true;
        controller.enqueue(errorEventBytes("Upstream connection closed unexpectedly"));
        options.onComplete({
          promptTokens: null,
          outputTokens: null,
          reason: "upstream-closed",
        });
      }
    },
  });
}
