// src/lib/mcp/trigger.ts
import isSafeRegex from "safe-regex";
import { listMcpServers } from "../db/mcpServers.ts";
import { connectMcpClient } from "./client.ts";
import { debugLog, debugLogError } from "../debugLog/logger.ts";
import type { TaggedBlock } from "../../../jroute/convert/types.ts";

export interface TriggerInput {
  lastUserMessage: string;
}

/** §7.2-equivalent haystack bound, matching src/lib/lorebooks/sandbox.ts's ctx.match
 * precedent exactly — trigger patterns are just as untrusted-adjacent (operator-configured,
 * but the MATCHED TEXT is client-supplied) as lorebook patterns.
 */
const MAX_HAYSTACK_LENGTH = 8192;

export async function runTriggerMode(input: TriggerInput): Promise<TaggedBlock[]> {
  const haystack = input.lastUserMessage.slice(0, MAX_HAYSTACK_LENGTH);
  const servers = listMcpServers().filter((s) => s.enabled && s.triggerPattern !== null);

  for (const server of servers) {
    const pattern = server.triggerPattern as string;
    if (!isSafeRegex(pattern)) continue;

    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      continue;
    }
    if (!re.test(haystack)) continue;

    // Design spec §8.2: trigger mode fires ONE configured tool ("normally search"). The
    // first name in the server's toolAllowlist is that configured tool — trigger mode does
    // not expose a full tool menu the way native mode's advertised-tools list does.
    const firstAllowedName = server.toolAllowlist?.split(",")[0]?.trim();
    if (!firstAllowedName) continue;

    debugLog("mcp_trigger.matched", {
      serverId: server.id,
      serverName: server.name,
      pattern,
      tool: firstAllowedName,
    });

    // `client` is declared outside the try so `finally` can close it regardless of which
    // branch below runs (success, tool-call failure, or connectMcpClient itself throwing —
    // in the last case `client` stays undefined and `client?.close()` is a safe no-op).
    // Without this, every trigger-mode fire leaked an open MCP connection (and, for stdio
    // transports, a child process) for the lifetime of the server process.
    let client: Awaited<ReturnType<typeof connectMcpClient>> | undefined;
    try {
      client = await connectMcpClient(server);
      const result = await client.callTool({ name: firstAllowedName, arguments: {} });
      const text = extractTextResult(result);
      debugLog("mcp_trigger.tool_result", {
        serverId: server.id,
        tool: firstAllowedName,
        result,
        text,
      });
      if (text.length === 0) continue;
      return [{ role: "mcp-trigger", content: text, tag: "depth-injection", depth: 1 }];
    } catch (err) {
      // A connection/tool-call failure degrades to "no block for this trigger" — matching
      // the lorebook runner's (Plan 5) precedent of isolating one bad source from failing
      // the whole request. Try the next server rather than aborting the whole trigger pass.
      debugLogError("mcp_trigger.failed", err, { serverId: server.id, tool: firstAllowedName });
      continue;
    } finally {
      await client?.close().catch(() => {});
    }
  }

  return [];
}

/** MCP `callTool` results are a `content` array of typed parts (text/image/resource); this
 * plan only surfaces text parts, joined, matching how much of a tool-call result usefully
 * becomes prompt content. Non-text parts are dropped, not an error — same posture as the
 * Gemini/Anthropic converters' "drop what we don't render, don't crash on it" precedent.
 */
function extractTextResult(result: unknown): string {
  if (typeof result !== "object" || result === null) return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      (part as { type: unknown }).type === "text" &&
      "text" in part &&
      typeof (part as { text: unknown }).text === "string"
    ) {
      parts.push((part as { text: string }).text);
    }
  }
  return parts.join("\n");
}
