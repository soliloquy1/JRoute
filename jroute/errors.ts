// jroute/errors.ts

const MAX_MESSAGE_LENGTH = 512;

interface ErrorInfo {
  type: string;
  code: string;
  fallback: string;
}

const STATUS_MAP: Record<number, ErrorInfo> = {
  400: { type: "invalid_request_error", code: "invalid_request", fallback: "Invalid request" },
  401: { type: "authentication_error", code: "invalid_api_key", fallback: "Invalid API key" },
  403: { type: "permission_error", code: "forbidden", fallback: "Forbidden" },
  404: { type: "invalid_request_error", code: "not_found", fallback: "Not found" },
  422: { type: "invalid_request_error", code: "unprocessable", fallback: "Unprocessable request" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded", fallback: "Rate limit exceeded" },
  500: { type: "api_error", code: "internal_error", fallback: "Internal error" },
  502: { type: "api_error", code: "bad_gateway", fallback: "Upstream error" },
  503: { type: "api_error", code: "service_unavailable", fallback: "Service unavailable" },
  504: { type: "api_error", code: "timeout", fallback: "Upstream timeout" },
};

const DEFAULT_INFO: ErrorInfo = {
  type: "api_error",
  code: "unknown_error",
  fallback: "Request failed",
};

// Every pattern is bounded — no unbounded quantifier over a character class that
// can also match the delimiter, so none of these backtrack catastrophically on
// hostile upstream text (CLAUDE.md ReDoS rule).
const REDACTIONS: Array<[RegExp, string]> = [
  // Stack frames: "    at fn (/path/file.js:1:2)" through end of line.
  [/^[ \t]*at\s.{0,300}$/gm, ""],
  // Bearer tokens and provider-style keys.
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,400}/gi, "[redacted]"],
  [/\b(?:sk|pk|jr|xai|gsk)-[A-Za-z0-9_-]{4,200}/g, "[redacted]"],
  // URLs — drop them wholesale; the host is rarely useful and the query may carry keys.
  [/\bhttps?:\/\/[^\s]{1,500}/g, "[url]"],
  // Absolute POSIX and Windows paths.
  [/(?:\/[A-Za-z0-9._-]{1,64}){2,12}(?::\d{1,6}){0,2}/g, "[path]"],
  [/\b[A-Za-z]:\\(?:[A-Za-z0-9._-]{1,64}\\){0,12}[A-Za-z0-9._-]{1,64}/g, "[path]"],
];

export function sanitizeErrorMessage(input: unknown): string {
  let text: string;
  if (typeof input === "string") text = input;
  else if (input instanceof Error) text = input.message;
  else if (input === null || input === undefined) text = "";
  else text = String(input);

  for (const [pattern, replacement] of REDACTIONS) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(/\s+/g, " ").trim();
  if (text.length > MAX_MESSAGE_LENGTH) text = `${text.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
  return text;
}

export function buildErrorBody(
  status: number,
  message: string
): { error: { message: string; type: string; code: string } } {
  const info = STATUS_MAP[status] ?? DEFAULT_INFO;
  return {
    error: {
      message: sanitizeErrorMessage(message) || info.fallback,
      type: info.type,
      code: info.code,
    },
  };
}

export function jsonError(
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(buildErrorBody(status, message)), {
    status,
    headers: { ...extraHeaders, "content-type": "application/json" },
  });
}
