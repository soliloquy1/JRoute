// src/lib/prompts/regexApply.ts
import { substituteMacros } from "./macros.ts";
import { compileFindRegex } from "./regexScriptSchema.ts";
import { debugLogError } from "../debugLog/logger.ts";
import type { MacroContext } from "./macros.ts";
import type { RegexScript } from "./regexScriptSchema.ts";

const MACRO_ESCAPE = /[.*+?^${}()|[\]\\]/g;

function macroSubstitutedFindRegex(script: RegexScript, ctx: MacroContext): string {
  if (script.substituteRegex === 0) return script.findRegex;
  if (script.substituteRegex === 1) return substituteMacros(script.findRegex, ctx);
  // 2: escaped — a char/user name containing a regex metachar (e.g. "A.J.") cannot widen
  // the compiled pattern.
  const escapedCtx: MacroContext = {
    char: ctx.char.replace(MACRO_ESCAPE, "\\$&"),
    user: ctx.user.replace(MACRO_ESCAPE, "\\$&"),
  };
  return substituteMacros(script.findRegex, escapedCtx);
}

function applyTrimStrings(matched: string, trimStrings: string[]): string {
  let out = matched;
  for (const s of trimStrings) {
    if (s.length === 0) continue;
    out = out.split(s).join("");
  }
  return out;
}

// Single left-to-right pass over $-tokens and ST's own {{match}} macro. {{match}} and $&
// both resolve to the (trimStrings-stripped) matched text — a plain string-replace pass
// for {{match}} first, then a regex pass for $$/$&/$1-$99, so the two can never
// re-expand each other. Group refs beyond the actual capture count resolve to "" rather
// than JS's native two-digit fallback ($10 -> "$1"+"0") — a deliberate simplification,
// documented and tested.
function buildReplacement(replaceString: string, matchedTrimmed: string, groups: string[]): string {
  const withMatchMacro = replaceString.replace(/\{\{match\}\}/g, () => matchedTrimmed);
  return withMatchMacro.replace(/\$(\$|&|\d{1,2})/g, (_full, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return matchedTrimmed;
    const idx = Number(token) - 1;
    return idx >= 0 && idx < groups.length && groups[idx] !== undefined ? groups[idx] : "";
  });
}

export function applyRegexScript(
  text: string,
  script: RegexScript,
  forPlacement: 1 | 2,
  ctx: MacroContext
): string {
  if (script.disabled) return text;
  if (!script.placement.includes(forPlacement)) return text;
  try {
    const pattern = macroSubstitutedFindRegex(script, ctx);
    const compiled = compileFindRegex(pattern);
    // Force the global flag: a saved /pattern/flags that omitted "g" would otherwise only
    // replace the first match, unlike ST's own "replace every occurrence" behavior.
    const globalRe = compiled.global ? compiled : new RegExp(compiled.source, `${compiled.flags}g`);
    return text.replace(globalRe, (match: string, ...rest: unknown[]) => {
      // String.prototype.replace callback args after `match`: [...groups, offset,
      // fullString] or [...groups, offset, fullString, namedGroupsObject].
      let groupCount = rest.length - 2;
      const last = rest[rest.length - 1];
      if (typeof last === "object" && last !== null) groupCount -= 1;
      const groups = rest.slice(0, groupCount).map((g) => (typeof g === "string" ? g : "")) as string[];
      return buildReplacement(script.replaceString, applyTrimStrings(match, script.trimStrings), groups);
    });
  } catch (err) {
    debugLogError("regex.scriptFailed", err, { scriptName: script.scriptName, forPlacement });
    return text;
  }
}

export function applyRegexScripts(
  text: string,
  scripts: RegexScript[],
  forPlacement: 1 | 2,
  ctx: MacroContext
): string {
  let out = text;
  for (const script of scripts) {
    out = applyRegexScript(out, script, forPlacement, ctx);
  }
  return out;
}

export function hasActiveScripts(scripts: RegexScript[], forPlacement: 1 | 2): boolean {
  return scripts.some((s) => !s.disabled && s.placement.includes(forPlacement));
}

/**
 * Content-shape dispatcher (design spec's "Content shapes" section): a chat message's
 * `content` is either a plain string, an array of parts (only `type: "text"` parts are
 * transformed; `image_url` and any other part type pass through untouched), or
 * null/undefined (no-op). Never touches `tool_calls`/`function_call` — those live on the
 * message object, not inside `content`, and are never passed to this function.
 */
export function applyRegexScriptsToContent(
  content: unknown,
  scripts: RegexScript[],
  forPlacement: 1 | 2,
  ctx: MacroContext
): unknown {
  if (typeof content === "string") {
    return applyRegexScripts(content, scripts, forPlacement, ctx);
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return {
          ...(part as Record<string, unknown>),
          text: applyRegexScripts((part as { text: string }).text, scripts, forPlacement, ctx),
        };
      }
      return part;
    });
  }
  return content;
}
