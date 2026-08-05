import { mapStopReason } from "./response.ts";

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
