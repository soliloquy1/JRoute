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
  // SpiderMonkey/JavaScriptCore: "fn@/path/file.js:1:2" through end of line. The pre-"@"
  // class is any non-"@" char so function names containing spaces ("my fn@/x.js:1:2") and
  // async markers ("promise callback*handler@...") are covered.
  //
  // The ":line[:col]" tail is REQUIRED, and it is the only thing keeping this rule off
  // ordinary prose. Without it, a permissive pre-"@" class deletes any line whose last
  // token contains an "@" — which is most single-line JSON error bodies and a lot of
  // legitimate upstream text ('..."Contact admin@yourorg.io"}}', "Cannot find module
  // @scope/pkg", "model not found: @cf/meta/llama-3-8b-instruct" — @cf/... is the literal
  // shape of a Cloudflare Workers AI model id). Those all reached the chatter as a bare
  // "Internal error", because buildErrorBody substitutes the fallback for an emptied
  // message. Ending in ":<digits>" is a structural property of every SpiderMonkey/JSC
  // frame and of essentially no prose, so it separates the two populations cheaply.
  //
  // Residual over-match, stated precisely: ANY line whose final token is "…@…:<digits>"
  // is removed whole. This is a purely structural test, NOT a credential-selective one —
  // it is neither sound nor complete with respect to credentials, in both directions:
  //   - non-credential lines of that shape are eaten identically ("upstream peer
  //     admin@example.com:443", "queue worker@node1:5672" -> "");
  //   - a credential DSN survives intact whenever it is not the line's final token
  //     ("connect redis://user:pass@10.0.0.1:6379 failed" keeps "pass").
  // It is tolerated because the frame rule must end in ":<digits>" to stay off prose at
  // all (see above), not because it targets secrets. Tightening it to be credential-aware
  // was attempted and measured: the candidate both failed an existing test and still
  // leaked "pass" from the non-final-token DSN, so the pattern stays as-is.
  [/^[ \t]{0,20}[^\n@]{0,120}@[^\s]{1,300}:\d{1,7}(?::\d{1,7})?$/gm, ""],

  // --- Credentials. All run before the URL pattern so a bare token is redacted as a
  // token (not swallowed into a generic "[url]") and before path patterns so a token
  // containing "/" is not mistaken for a path.
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,400}/gi, "[redacted]"],
  // JWTs: three base64url segments. Fixed arity, single-class segments — no nesting.
  // Unanchored: "eyJ" is base64 for '{"' and does not occur in English, so a leading \b
  // would only create a bypass ("tokeneyJhbGci...") without preventing a false positive.
  [/eyJ[A-Za-z0-9_-]{6,800}\.[A-Za-z0-9_-]{6,800}\.[A-Za-z0-9_-]{6,800}/g, "[redacted]"],
  // GitHub / Slack / Google. Prefixes are distinctive enough to match unanchored.
  // github_pat_ (fine-grained PATs) is a separate rule: "gh[pousr]_" cannot match it,
  // because the char after "gh" is "i". It is now GitHub's recommended token format.
  [/github_pat_[A-Za-z0-9_]{20,100}/g, "[redacted]"],
  [/gh[pousr]_[A-Za-z0-9]{10,255}/g, "[redacted]"],
  // "e" covers Slack enterprise tokens (xoxe-, xoxe.xoxp-), hence the [-.] separator.
  [/xox[baprse][-.][A-Za-z0-9-]{10,300}/g, "[redacted]"],
  [/AIzaSy[A-Za-z0-9_-]{10,40}/g, "[redacted]"],
  // Provider-style keys, anchored at a word boundary — permissive tail.
  [/\b(?:sk|pk|jr|xai|gsk)-[A-Za-z0-9_-]{4,200}/g, "[redacted]"],
  // Same prefixes WITHOUT a boundary, to catch keys concatenated into an upstream string
  // ("...keysk-abcdef..."). A bare unanchored rule would mangle ordinary hyphenated English
  // ("task-manager" -> "ta[redacted]"), so the tail must contain a qualifying UNBROKEN
  // alphanumeric run: >=16 chars of any composition, or >=6 chars including a digit.
  // The run is what discriminates. Hyphens BREAK it, which is the whole point: real keys
  // are long unbroken strings, while hyphenated English is short dictionary words joined by
  // hyphens ("disk-space-usage-report" -> longest run "report", 6). Requiring only overall
  // tail length instead would mangle exactly those phrases, since the tail charset spans
  // hyphens. Every quantifier is bounded, so the lookahead cannot blow up.
  //
  // Two measured trade-offs are accepted here; both were re-tested in round 3.
  //
  // 1. UNBROKEN RUNS OF 6-9 CHARS whose digit sits with fewer than 5 alphanumerics on both
  //    sides ("sk-ab1cde") are not matched, so a key of that shape glued into a word still
  //    leaks. This IS a regression against the earlier "tail >=6 and contains a digit"
  //    rule. Closing it needs "any 6-wide alnum window containing a digit", which doubled
  //    over-redaction across the 85 dictionary words ending in a key prefix (ask, task,
  //    disk, risk, mask, kiosk, asterisk...) and started eating ordinary infrastructure
  //    vocabulary: md5hash, sha1sum, utf8mode, utf16le, ipv6only, eth0down, http2tls,
  //    ec2host, win32api, arm64mac, tls13err. Weighed against a 6-9 character key body,
  //    which no proxied provider issues (OpenAI 48+, Anthropic ~100, Google 39), and note
  //    the anchored rule above still catches any of these when properly delimited.
  //
  // 2. "_" deliberately does NOT break the run, so a long snake_case or CamelCase tail is
  //    over-redacted ("disk-space_usage_report", "husk-ExecutionContextDestroyed"). That is
  //    cosmetic, never a leak. Excluding "_" from the run charset was measured and rejected:
  //    it multiplies missed keys on random base64url bodies (32-char: 10 -> 45 per 20k;
  //    JRoute's own jr-: 7 -> 38) and misses underscore-delimited key bodies outright
  //    (4-char groups: 0/20000 -> 20000/20000). It also would not fix the CamelCase half,
  //    which contains no "_" at all and is indistinguishable by shape from the all-alpha
  //    key tail this rule exists to catch.
  [
    /(?:sk|pk|jr|xai|gsk)-(?=[A-Za-z0-9_-]{0,40}(?:[A-Za-z0-9_]{16,200}|[A-Za-z0-9_]{5,200}\d|\d[A-Za-z0-9_]{5,200}))[A-Za-z0-9_-]{5,200}/g,
    "[redacted]",
  ],

  // --- Locations. URLs first: a URL contains a POSIX-looking path component, so running
  // the path pattern first would emit "[path]" inside an otherwise-intact URL.
  [/\bhttps?:\/\/[^\s]{1,500}/g, "[url]"],
  // Bare IPv4 host, optional ":port". Node surfaces the operator's private address
  // verbatim in the most common upstream failure there is ("connect ECONNREFUSED
  // 10.0.0.7:443"), and JanitorAI renders that body straight to whoever is chatting.
  // Runs after the URL rule so an IP inside an http(s) URL is already "[url]".
  // Four dot-separated groups is the discriminator: three-group versions ("1.2.3",
  // "semver 10.20.30"), "utf-8", "covid-19", "HTTP/1.1 404", ISO dates, UUIDs and
  // model ids ("gpt-4o-mini") all lack the fourth group and survive byte-identical.
  // Bounded on every quantifier. IPv6 and bare DNS names are NOT covered — separating
  // an internal hostname from ordinary dotted prose is a genuinely harder call and is
  // deliberately left open rather than guessed at.
  [/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g, "[address]"],
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
