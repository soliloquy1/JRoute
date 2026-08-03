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
    const text = await res.text().catch(() => "");
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

  return {
    ok: true,
    status: res.status,
    stream: null,
    json: await res.json().catch(() => null),
    errorMessage: null,
    retryable: false,
  };
}
