// src/lib/api/validation.ts
import type { z } from "zod";

/**
 * Formats Zod issues into a safe, human-actionable 400 message. Only the field PATH and
 * the issue message are included — never the received value — so nothing a client sent
 * is reflected back (log/response injection, oversized payloads).
 */
export function describeIssues(error: z.ZodError, max = 3): string {
  const parts = error.issues.slice(0, max).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  const suffix = error.issues.length > max ? ` (+${error.issues.length - max} more)` : "";
  return `${parts.join("; ")}${suffix}`;
}

/**
 * Parses a route `:id` param as a positive integer. Returns null for anything else —
 * callers turn that into a 400 instead of letting `Number("abc")` no-op as NaN.
 */
export function parseIdParam(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
