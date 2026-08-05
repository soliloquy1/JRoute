/**
 * Anthropic error response body shape:
 * https://docs.claude.com/en/api/errors — { type: "error", error: { type, message } }
 */
interface AnthropicErrorBody {
  type?: string;
  error?: { type?: string; message?: string };
}

/**
 * Distinguishes `billing_error` from `permission_error` despite both sharing HTTP 403
 * (design spec §10) — an empty wallet and a bad API key are different operator problems
 * with different fixes, and a generic "Forbidden" tells the operator neither.
 *
 * Operates on an ALREADY-sanitized message (the caller runs this after
 * `sanitizeErrorMessage`, never before — `jroute/errors.ts` stays frozen and is never
 * edited to special-case this). If the input is not the expected JSON shape — a plain-text
 * upstream failure, or something this function has never seen — it degrades to passing the
 * message through unchanged rather than throwing or fabricating a misleading message.
 */
export function mapAnthropicErrorMessage(sanitizedMessage: string): string {
  let body: AnthropicErrorBody;
  try {
    body = JSON.parse(sanitizedMessage) as AnthropicErrorBody;
  } catch {
    return sanitizedMessage;
  }

  const errorType = body.error?.type;
  const upstreamMessage = body.error?.message ?? sanitizedMessage;

  if (errorType === "billing_error") {
    return `Billing issue with the upstream Anthropic account: ${upstreamMessage}`;
  }

  return upstreamMessage;
}
