// src/lib/lorebooks/runner.ts
import { getLorebook } from "../db/lorebooks.ts";
import { runLorebook, buildLorebookCtx, type CtxMessage } from "./sandbox.ts";
import { scopeKeyFor } from "./scopeKey.ts";
import { debugLog } from "../debugLog/logger.ts";
import type { TaggedBlock } from "../../../jroute/convert/types.ts";

const DEFAULT_DEPTH = 2;

export interface RunnerInput {
  lorebookIds: number[];
  messages: Array<{ role: string; content: unknown }>;
  rawSystemPrompt: string;
}

function toCtxMessages(messages: RunnerInput["messages"]): CtxMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : "",
  }));
}

function lastUserMessageOf(messages: RunnerInput["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user" && typeof messages[i].content === "string") {
      return messages[i].content as string;
    }
  }
  return "";
}

/** §7.1's return-value contract: `null` (inactive), a string (default placement), or an
 * object `{ text, depth }` (explicit control). Anything else — a number, an array, `undefined`
 * from a function with no return, a malformed object missing `text` — is treated as inactive
 * rather than thrown, matching `runLorebook`'s own never-throw contract at the layer below.
 */
function toBlock(result: unknown): { text: string; depth: number } | null {
  if (result === null || result === undefined) return null;
  if (typeof result === "string")
    return result.length > 0 ? { text: result, depth: DEFAULT_DEPTH } : null;
  if (typeof result === "object" && "text" in result) {
    const obj = result as { text?: unknown; depth?: unknown };
    if (typeof obj.text !== "string" || obj.text.length === 0) return null;
    const depth =
      typeof obj.depth === "number" && Number.isFinite(obj.depth) ? obj.depth : DEFAULT_DEPTH;
    return { text: obj.text, depth };
  }
  return null;
}

export function runLorebooksForRequest(input: RunnerInput): TaggedBlock[] {
  const ctxMessages = toCtxMessages(input.messages);
  const lastUserMessage = lastUserMessageOf(input.messages);
  const out: TaggedBlock[] = [];

  for (const id of input.lorebookIds) {
    const lorebook = getLorebook(id);
    if (!lorebook || !lorebook.enabled) continue;

    const scopeKey = scopeKeyFor(lorebook.scope, input.rawSystemPrompt);
    const ctxInput = {
      messages: ctxMessages,
      lastUserMessage,
      characterName: "", // Task 6 wires a real extraction if/when needed; empty is a safe default per §7.1's contract (a lorebook that reads it just sees "").
      lorebookId: lorebook.id,
      scopeKey,
    };

    // Deviation from §7.5: the design spec calls for one shared QuickJS runtime per
    // request (to avoid a bulk message copy per lorebook), but `runLorebook` here creates
    // one runtime per lorebook instead. The spec's stated cost concern is neutralized by
    // the lazy `ctx.getMessage`/`ctx.messageCount` marshaling already in place (no bulk
    // copy happens either way), and per-lorebook runtime isolation is an additional
    // security benefit — one lorebook's guest heap can't affect another's — not a compromise.
    const outcome = runLorebook(lorebook.source, buildLorebookCtx(ctxInput));
    debugLog("lorebook.outcome", { lorebookId: lorebook.id, name: lorebook.name, outcome });
    if (outcome.kind !== "ok") continue;

    const block = toBlock(outcome.result);
    if (!block) continue;

    out.push({
      role: "lorebook",
      content: block.text,
      tag: "depth-injection",
      depth: block.depth,
    });
  }

  return out;
}
