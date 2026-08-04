// jroute/executor.ts
import { sanitizeErrorMessage } from "./errors.ts";
import type { Provider, Connection, WireFormat } from "../src/lib/db/types.ts";

/**
 * Per-wire-format transport differences. The `openai` entry reproduces the values this
 * file hardcoded before Plan 2a, so registering a descriptor is additive for that path.
 *
 * Anthropic's three required request headers are `x-api-key`, `anthropic-version`, and
 * `content-type`; the endpoint is POST /v1/messages. Appending `/chat/completions` to any
 * baseUrl cannot reach it, which is why this indirection exists.
 */
export interface WireDescriptor {
  /** Appended to the provider's baseUrl (which has trailing slashes stripped). */
  path: string;
  /** Auth headers for this format. Kept as a function because the header NAME differs. */
  authHeaders(apiKey: string): Record<string, string>;
  /** Always-sent extra headers, e.g. Anthropic's required API version. */
  extraHeaders: Record<string, string>;
}

const ANTHROPIC_VERSION = "2023-06-01";

export const WIRE_DESCRIPTORS: Partial<Record<WireFormat, WireDescriptor>> = {
  openai: {
    path: "/chat/completions",
    authHeaders: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
    extraHeaders: {},
  },
  anthropic: {
    path: "/v1/messages",
    authHeaders: (apiKey) => ({ "x-api-key": apiKey }),
    extraHeaders: { "anthropic-version": ANTHROPIC_VERSION },
  },
  // gemini: Plan 2c.
};

export function describeWire(wireFormat: WireFormat): WireDescriptor | null {
  return WIRE_DESCRIPTORS[wireFormat] ?? null;
}

// 529 is Anthropic's `overloaded_error` — its most common transient failure. Without it
// the failover loop breaks on exactly the error failover exists for.
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);
const BASE_COOLDOWN_MS = 3000;
const MAX_COOLDOWN_MS = 300000;

export interface ExecuteParams {
  provider: Provider;
  connection: Connection;
  body: Record<string, unknown>;
  signal: AbortSignal;
}

export interface ExecuteResult {
  ok: boolean;
  status: number;
  stream: ReadableStream<Uint8Array> | null;
  json: unknown;
  errorMessage: string | null;
  retryable: boolean;
  /** Upstream `retry-after` in ms, when the header was present and parseable. */
  retryAfterMs: number | null;
}

export function classifyStatus(status: number): { retryable: boolean } {
  return { retryable: RETRYABLE.has(status) };
}

/**
 * Cooldown before this connection is retried.
 *
 * An upstream `retry-after` hint wins over local backoff when present — the provider knows
 * its own reset window better than we do. Still clamped to MAX_COOLDOWN_MS so a hostile or
 * mistaken header cannot park a connection for hours.
 */
export function cooldownMsFor(
  _status: number,
  attempt: number,
  retryAfterMs: number | null = null
): number {
  if (retryAfterMs !== null && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_COOLDOWN_MS);
  }
  return Math.min(BASE_COOLDOWN_MS * 2 ** attempt, MAX_COOLDOWN_MS);
}

/**
 * True when a rejection means "the caller went away", not "the upstream is sick".
 * Verified against Node's undici: an aborted `fetch` rejects with a `DOMException`
 * whose `name` is "AbortError" and which IS an `instanceof Error`, and `signal.aborted`
 * is already true by the time the rejection lands. Either half of the predicate alone
 * would be sufficient there; both are kept because an injected `fetchImpl` may surface
 * only one of the two.
 */
function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

function makeAbortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

/** A client that hung up has nobody left to show a message to, and must not fail over. */
function abortedResult(): ExecuteResult {
  return {
    ok: false,
    status: 0,
    stream: null,
    json: null,
    errorMessage: null,
    retryable: false,
    retryAfterMs: null,
  };
}

/**
 * Parses `retry-after`. HTTP allows either delta-seconds or an HTTP-date; both are
 * accepted here. Anything unparseable, negative, or absent yields null so the caller
 * falls back to exponential backoff.
 */
function parseRetryAfter(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;

  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds)) return seconds > 0 ? Math.round(seconds * 1000) : null;

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  const delta = at - Date.now();
  return delta > 0 ? delta : null;
}

/**
 * Reads a body with the request signal bound to the read.
 *
 * Node's own fetch already ties the body stream to the request signal, but a `Response`
 * built by an injected `fetchImpl` does not: reading one whose stream never settles hangs
 * forever, with no client left to serve. Racing the read against the signal makes the
 * deadline independent of which fetch implementation produced the response.
 */
function readWithSignal<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(makeAbortError());
  let rejectAborted!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = reject;
  });
  const onAbort = () => rejectAborted(makeAbortError());
  signal.addEventListener("abort", onAbort, { once: true });
  return Promise.race([read(), aborted]).finally(() => {
    signal.removeEventListener("abort", onAbort);
  });
}

export async function execute(
  params: ExecuteParams,
  fetchImpl: typeof fetch = fetch
): Promise<ExecuteResult> {
  const { provider, connection, body, signal } = params;

  const wire = describeWire(provider.wireFormat);
  if (!wire) {
    // A provider row whose wireFormat has no descriptor is a configuration error, not an
    // upstream failure: retrying it on another connection of the same provider would fail
    // identically, so it is terminal.
    return {
      ok: false,
      status: 0,
      stream: null,
      json: null,
      errorMessage: `Unsupported wire format: ${provider.wireFormat}`,
      retryable: false,
      retryAfterMs: null,
    };
  }

  const url = `${provider.baseUrl.replace(/\/+$/, "")}${wire.path}`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        ...wire.extraHeaders,
        ...wire.authHeaders(connection.apiKey ?? ""),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (isAbort(err, signal)) return abortedResult();
    return {
      ok: false,
      status: 0,
      stream: null,
      json: null,
      errorMessage: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
      retryable: true,
      retryAfterMs: null,
    };
  }

  if (!res.ok) {
    // An abort here must NOT be swallowed into "": the status would still be a retryable
    // 5xx, and the failover loop would bill every fallback connection for a request the
    // client already abandoned. Only non-abort read failures fall back to the empty body.
    let text: string;
    try {
      text = await readWithSignal(() => res.text(), signal);
    } catch (err) {
      if (isAbort(err, signal)) return abortedResult();
      text = "";
    }
    return {
      ok: false,
      status: res.status,
      stream: null,
      json: null,
      errorMessage: sanitizeErrorMessage(text) || `Upstream returned ${res.status}`,
      retryable: classifyStatus(res.status).retryable,
      retryAfterMs: parseRetryAfter(res),
    };
  }

  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    return {
      ok: true,
      status: res.status,
      stream: res.body,
      json: null,
      errorMessage: null,
      retryable: false,
      retryAfterMs: null,
    };
  }

  // Same unbounded-read hazard as the error branch above, so the same binding applies.
  let json: unknown;
  try {
    json = await readWithSignal(() => res.json(), signal);
  } catch (err) {
    if (isAbort(err, signal)) return abortedResult();
    json = null;
  }

  return {
    ok: true,
    status: res.status,
    stream: null,
    json,
    errorMessage: null,
    retryable: false,
    retryAfterMs: null,
  };
}
