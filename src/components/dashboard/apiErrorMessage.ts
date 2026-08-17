// src/components/dashboard/apiErrorMessage.ts
// Pure, framework-free helper for reading an error message out of a JSON API response
// body. Kept out of .tsx components so it's unit-testable under `npm test` without
// rendering — this exact shape mismatch (assuming `error` is a bare string when
// jsonError()/buildErrorBody() actually send `{ error: { message, type, code } }`)
// previously crashed ModelManager's import-models error path with "Objects are not
// valid as a React child" (minified React error #31): the raw error OBJECT got handed
// straight to setState/toast instead of its .message string.

/** Matches the body shape from jsonError()/buildErrorBody() (open-sse/utils/error.ts) —
 * `{ message?: string; type: string; code: string }`, but only `message` is read here. */
export interface JsonErrorBody {
  error?: ({ message?: string } & Record<string, unknown>) | string | null;
}

export function extractApiErrorMessage(body: JsonErrorBody | null, fallback: string): string {
  if (!body?.error) return fallback;
  if (typeof body.error === "string") return body.error;
  return body.error.message ?? fallback;
}
