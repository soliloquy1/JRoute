// src/lib/prompts/macros.ts

/**
 * Small, data-backed macro set only (design spec §6) — deliberately not the full
 * SillyTavern macro library. {{random}}, {{roll}}, {{time}}, etc. are left unresolved
 * on purpose: JRoute is a stateless proxy with no persona/session/dice state to back them.
 */
export interface MacroContext {
  char: string;
  user: string;
}

export function substituteMacros(text: string, ctx: MacroContext): string {
  // Function replacers, not string replacers: a char/user name containing `$&`, `$'`,
  // or `` $` `` would otherwise expand as a replacement-pattern metacharacter.
  return text
    .replace(/\{\{char\}\}/g, () => ctx.char)
    .replace(/\{\{user\}\}/g, () => ctx.user)
    .replace(/\{\{newline\}\}/g, "\n");
}
