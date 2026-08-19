// src/lib/mcp/toolResultText.ts
/** MCP `callTool` results are a `content` array of typed parts (text/image/resource); this
 * plan only surfaces text parts, joined, matching how much of a tool-call result usefully
 * becomes prompt content. Non-text parts are dropped, not an error — same posture as the
 * Gemini/Anthropic converters' "drop what we don't render, don't crash on it" precedent.
 *
 * Shared by `trigger.ts` (regex-fired single tool) and `loop.ts` (native mode's round loop).
 */
export function extractTextResult(result: unknown): string {
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
