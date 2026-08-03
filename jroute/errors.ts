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
  // --- Stack frames (must run first: they CONTAIN paths/URLs as sub-expressions, so
  // removing the whole line here keeps later patterns from emitting a half-redacted frame).
  // V8/Node: "    at fn (/path/file.js:1:2)" through end of line.
  [/^[ \t]*at\s.{0,300}$/gm, ""],
  // SpiderMonkey/JavaScriptCore: "fn@/path/file.js:1:2" through end of line.
  [/^[ \t]*[A-Za-z0-9_$.<>[\]]{0,120}@[^\s]{1,300}$/gm, ""],

  // --- Credentials. All run before the URL pattern so a bare token is redacted as a
  // token (not swallowed into a generic "[url]") and before path patterns so a token
  // containing "/" is not mistaken for a path.
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,400}/gi, "[redacted]"],
  // JWTs: three base64url segments. Fixed arity, single-class segments — no nesting.
  [/\beyJ[A-Za-z0-9_-]{6,800}\.[A-Za-z0-9_-]{6,800}\.[A-Za-z0-9_-]{6,800}/g, "[redacted]"],
  // GitHub / Slack / Google. Prefixes are distinctive enough to match unanchored.
  [/gh[pousr]_[A-Za-z0-9]{10,255}/g, "[redacted]"],
  [/xox[baprs]-[A-Za-z0-9-]{10,300}/g, "[redacted]"],
  [/AIzaSy[A-Za-z0-9_-]{10,40}/g, "[redacted]"],
  // Provider-style keys, anchored at a word boundary — permissive tail.
  [/\b(?:sk|pk|jr|xai|gsk)-[A-Za-z0-9_-]{4,200}/g, "[redacted]"],
  // Same prefixes WITHOUT a boundary, to catch keys concatenated into an upstream string
  // ("...keysk-1234..."). A bare unanchored rule would mangle ordinary hyphenated English
  // ("task-manager" -> "ta[redacted]"), so the tail must be >=6 chars AND contain a digit.
  // The lookahead is bounded and single-class, so it adds no backtracking dimension.
  [/(?:sk|pk|jr|xai|gsk)-(?=[A-Za-z0-9_-]{0,200}\d)[A-Za-z0-9_-]{6,200}/g, "[redacted]"],

  // --- Locations. URLs first: a URL contains a POSIX-looking path component, so running
  // the path pattern first would emit "[path]" inside an otherwise-intact URL.
  [/\bhttps?:\/\/[^\s]{1,500}/g, "[url]"],
  // Absolute POSIX and Windows paths.
  [/(?:\/[A-Za-z0-9._-]{1,64}){2,12}(?::\d{1,6}){0,2}/g, "[path]"],
  [/\b[A-Za-z]:\\(?:[A-Za-z0-9._-]{1,64}\\){0,12}[A-Za-z0-9._-]{1,64}/g, "[path]"],
  // Bare "file.ts:44:9" with no directory. Runs LAST so it cannot bite into a URL or an
  // absolute path — by this point both have already been replaced wholesale.
  [
    /(?<![A-Za-z0-9_/.-])[A-Za-z0-9_.-]{1,64}\.(?:tsx?|jsx?|mjs|cjs):\d{1,6}(?::\d{1,6})?/g,
    "[path]",
  ],
];

export function sanitizeErrorMessage(input: unknown): string {
  // Coercion is the only step that can throw, and every branch of it can: a hostile or
  // exotic value may carry a throwing `toString`, a Proxy trap that throws on `get` or
  // `getPrototypeOf` (so even `instanceof` and `.message` are unsafe), or a null prototype
  // with no `toString` at all. Callers pass caught exception values of unknown type, so a
  // throw here would surface as an unhandled exception inside an SSE stream. Degrade to ""
  // instead — the caller substitutes a status-appropriate fallback message.
  let text: string;
  try {
    if (typeof input === "string") text = input;
    else if (input instanceof Error) text = input.message;
    else if (input === null || input === undefined) text = "";
    else text = String(input);
    if (typeof text !== "string") text = "";
  } catch {
    text = "";
  }

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
