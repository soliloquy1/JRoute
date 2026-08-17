// jroute/regexStreamTransform.ts
import { parseSseFrames } from "./convert/anthropic/stream.ts";
import { applyRegexScripts } from "../src/lib/prompts/regexApply.ts";
import { debugLog } from "../src/lib/debugLog/logger.ts";
import type { RegexScript } from "../src/lib/prompts/regexScriptSchema.ts";
import type { MacroContext } from "../src/lib/prompts/macros.ts";

// Codepoints held back before a delta is committed to the wire. Large enough to give most
// bounded find/replace scripts room to see a whole match before their output is locked
// in; the runtime invariant guard below is what actually protects against scripts whose
// reach exceeds this margin (design spec's final decision: 200, down from an earlier 800).
const HOLD_BACK_MARGIN = 200;

interface RegexStreamState {
  rawBuffer: string[]; // codepoints, via Array.from — never a raw string slice
  committedRawLen: number;
  committedTransformed: string;
  passthrough: boolean;
  flushed: boolean;
  requestId: string;
}

function codepoints(text: string): string[] {
  return Array.from(text);
}

function tryAdvanceCommit(state: RegexStreamState, scripts: RegexScript[], ctx: MacroContext): string {
  const newCommittedRawLen = Math.max(0, state.rawBuffer.length - HOLD_BACK_MARGIN);
  if (newCommittedRawLen <= state.committedRawLen) return "";

  const candidate = applyRegexScripts(
    state.rawBuffer.slice(0, newCommittedRawLen).join(""),
    scripts,
    2,
    ctx
  );

  if (candidate.startsWith(state.committedTransformed)) {
    const emitted = candidate.slice(state.committedTransformed.length);
    state.committedTransformed = candidate;
    state.committedRawLen = newCommittedRawLen;
    return emitted;
  }

  // The commit invariant does not hold for this script set on this text. Recovery means
  // emitting whatever raw text has not yet reached the client, then giving up on further
  // transformation for the rest of THIS response only — never silently dropping text,
  // never retroactively rewriting what the client already received.
  debugLog("regex.streamInvariantViolated", {
    requestId: state.requestId,
    scriptNames: scripts.map((s) => s.scriptName),
  });
  state.passthrough = true;
  const untransformedTail = state.rawBuffer.slice(state.committedRawLen).join("");
  state.committedRawLen = state.rawBuffer.length;
  return untransformedTail;
}

function flushRemainder(state: RegexStreamState, scripts: RegexScript[], ctx: MacroContext): string {
  if (state.flushed) return "";
  state.flushed = true;
  if (state.passthrough) {
    return state.rawBuffer.slice(state.committedRawLen).join("");
  }
  const candidate = applyRegexScripts(state.rawBuffer.join(""), scripts, 2, ctx);
  if (candidate.startsWith(state.committedTransformed)) {
    return candidate.slice(state.committedTransformed.length);
  }
  debugLog("regex.streamInvariantViolated", {
    requestId: state.requestId,
    scriptNames: scripts.map((s) => s.scriptName),
    atFlush: true,
  });
  return state.rawBuffer.slice(state.committedRawLen).join("");
}

function tailChunk(content: string): Record<string, unknown> {
  return {
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

export function wrapWithRegexTransform(
  inner: ReadableStream<Uint8Array>,
  scripts: RegexScript[],
  ctx: MacroContext,
  requestId: string
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const state: RegexStreamState = {
    rawBuffer: [],
    committedRawLen: 0,
    committedTransformed: "",
    passthrough: false,
    flushed: false,
    requestId,
  };

  return inner.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const { frames, rest } = parseSseFrames(buffer);
        buffer = rest;

        for (const frame of frames) {
          if (frame.data === "[DONE]") {
            const tail = flushRemainder(state, scripts, ctx);
            if (tail.length > 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(tailChunk(tail))}\n\n`));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            continue;
          }

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(frame.data) as Record<string, unknown>;
          } catch {
            // Not a JSON data frame — relay unchanged rather than risk corrupting it.
            controller.enqueue(encoder.encode(`data: ${frame.data}\n\n`));
            continue;
          }

          const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
          const delta = choice?.delta as { content?: unknown } | undefined;

          if (!choice || typeof delta?.content !== "string" || delta.content.length === 0) {
            if (choice?.finish_reason != null && !state.flushed) {
              const tail = flushRemainder(state, scripts, ctx);
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

          state.rawBuffer.push(...codepoints(delta.content));

          const emitted = state.passthrough
            ? (() => {
                const raw = state.rawBuffer.slice(state.committedRawLen).join("");
                state.committedRawLen = state.rawBuffer.length;
                return raw;
              })()
            : tryAdvanceCommit(state, scripts, ctx);

          const outParsed = {
            ...parsed,
            choices: [{ ...choice, delta: { ...delta, content: emitted } }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(outParsed)}\n\n`));

          if (choice.finish_reason != null && !state.flushed) {
            const tail = flushRemainder(state, scripts, ctx);
            if (tail.length > 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(tailChunk(tail))}\n\n`));
            }
          }
        }
      },
      flush(controller) {
        if (state.flushed) return;
        const tail = flushRemainder(state, scripts, ctx);
        if (tail.length > 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(tailChunk(tail))}\n\n`));
        }
      },
    })
  );
}
