// jroute/executor.ts
import { sanitizeErrorMessage } from "./errors.ts";
import type { Provider, Connection } from "../src/lib/db/types.ts";

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
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
}

export function classifyStatus(status: number): { retryable: boolean } {
  return { retryable: RETRYABLE.has(status) };
}

export function cooldownMsFor(_status: number, attempt: number): number {
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
  return { ok: false, status: 0, stream: null, json: null, errorMessage: null, retryable: false };
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
  const url = `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${connection.apiKey ?? ""}`,
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
  };
}
