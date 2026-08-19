// src/lib/prompts/regexScriptSchema.ts
import { z } from "zod";

export const MAX_REGEX_SCRIPTS = 100;
export const MAX_SCRIPT_NAME_LEN = 200;
export const MAX_FIND_REGEX_LEN = 1000;
export const MAX_REPLACE_STRING_LEN = 4000;
export const MAX_TRIM_STRINGS = 20;
export const MAX_TRIM_STRING_LEN = 500;

// `looseObject` preserves ST export fields this port does not act on (minDepth/maxDepth/
// markdownOnly/promptOnly/runOnEdit are accepted-but-no-op per the design spec's Scope Out)
// so a round-tripped import/export does not silently drop them.
export const RegexScriptSchema = z.looseObject({
  id: z.string().optional(),
  scriptName: z.string().min(1).max(MAX_SCRIPT_NAME_LEN),
  findRegex: z.string().min(1).max(MAX_FIND_REGEX_LEN),
  replaceString: z.string().max(MAX_REPLACE_STRING_LEN).default(""),
  trimStrings: z.array(z.string().max(MAX_TRIM_STRING_LEN)).max(MAX_TRIM_STRINGS).default([]),
  // ST's real placement enum has no 4 (0 is a legacy display-only marker, never assigned).
  placement: z
    .array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(6)]))
    .default([1, 2]),
  disabled: z.boolean().default(false),
  // 0 = no macro substitution in findRegex (default, safe by construction); 1 = raw
  // substitution (user's explicit risk acceptance); 2 = regex-metachar-escaped
  // substitution (safe for names containing "." etc.). See regexApply.ts.
  substituteRegex: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  minDepth: z.number().nullable().optional(),
  maxDepth: z.number().nullable().optional(),
  markdownOnly: z.boolean().optional(),
  promptOnly: z.boolean().optional(),
  runOnEdit: z.boolean().optional(),
});

/** The whole script list, capped. Shared by the API routes and the DB writers so a direct
 * DB write cannot bypass the ceiling the routes enforce (mirrors LogitBiasEntriesSchema). */
export const RegexScriptsSchema = z.array(RegexScriptSchema).max(MAX_REGEX_SCRIPTS);

export type RegexScript = z.infer<typeof RegexScriptSchema>;

// ST exports findRegex in "/pattern/flags" form (JS RegExp.toString() shape). A bare
// pattern with no slash delimiters is also accepted for hand-written scripts, compiled
// with no flags.
const WRAPPED = /^\/(.*)\/([a-z]*)$/;

export function compileFindRegex(findRegex: string): RegExp {
  const m = WRAPPED.exec(findRegex);
  return m ? new RegExp(m[1], m[2]) : new RegExp(findRegex);
}
