// src/lib/mcp/ssrfFetch.ts
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import ssrfFilterModule from "ssrf-req-filter";

/**
 * `ssrf-req-filter` (CLAUDE.md-recommended, design spec §8's mandated SSRF control) ships
 * no TypeScript declarations. Its real, verified shape (read from
 * `node_modules/ssrf-req-filter/lib/index.js`): `(url: string) => http.Agent | https.Agent`
 * — a classic Node Agent whose patched `createConnection` blocks non-unicast (private/
 * loopback/link-local/multicast) resolved IPs, both synchronously and via a `'lookup'`
 * listener for DNS-resolved hostnames.
 */
const ssrfFilter: (url: string) => import("node:http").Agent = ssrfFilterModule as never;

/**
 * Bridges a classic Node `http`/`https` request into a WHATWG `Response`, using
 * `ssrf-req-filter`'s Agent for real. Node's native global `fetch` (undici-based, used
 * everywhere else in this codebase) does NOT accept a classic `http.Agent` — undici uses
 * `dispatcher`, a different interface — so `ssrf-req-filter`'s Agent cannot be wired into
 * native `fetch` at all. This function exists specifically to actually use the mandated
 * library rather than silently dropping SSRF protection to keep using native `fetch`.
 *
 * Scoped to what the MCP SDK's transports actually send (GET/POST, string or JSON body,
 * plain header objects) — not a general-purpose fetch polyfill.
 */
function rawFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = typeof url === "string" ? new URL(url) : url;
    const isHttps = target.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const agent = ssrfFilter(target.toString());

    const headers: Record<string, string> = {};
    if (init.headers) {
      const h = new Headers(init.headers as HeadersInit);
      h.forEach((value, key) => {
        headers[key] = value;
      });
    }

    const req = requestFn(
      target,
      { method: init.method ?? "GET", headers, agent },
      (res: IncomingMessage) => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
        resolve(
          new Response(body, {
            status: res.statusCode ?? 502,
            statusText: res.statusMessage ?? "",
            headers: responseHeaders,
          })
        );
      }
    );
    req.on("error", reject);

    if (typeof init.body === "string") {
      req.end(init.body);
    } else if (init.body === undefined || init.body === null) {
      req.end();
    } else {
      req.destroy();
      reject(new Error("mcpSafeFetch: only string or empty request bodies are supported"));
    }
  });
}

/** SSRF-filtered fetch for MCP server connections. Rejects before any connection attempt
 * reaches a private/loopback/link-local target — `ssrf-req-filter`'s `createConnection`
 * hook throws synchronously inside the classic `http`/`https` client when the target's
 * resolved address fails the unicast check, which surfaces here as a rejected Promise.
 */
export const mcpSafeFetch: (url: string | URL, init?: RequestInit) => Promise<Response> = (
  url,
  init
) => rawFetch(url, init);

/** Test-only escape hatch: the same request/response bridging as `mcpSafeFetch`, but without
 * routing through `ssrf-req-filter`'s Agent — used to test the HTTP<->Response bridging
 * mechanics in isolation against a local test server bound to loopback, which the real SSRF
 * gate would (correctly) reject. Never import this outside tests.
 */
export function unsafeFetchForTesting(url: string | URL, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = typeof url === "string" ? new URL(url) : url;
    const requestFn = target.protocol === "https:" ? httpsRequest : httpRequest;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers as HeadersInit);
      h.forEach((value, key) => {
        headers[key] = value;
      });
    }
    const req = requestFn(target, { method: init?.method ?? "GET", headers }, (res) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined) continue;
        responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
      resolve(new Response(body, { status: res.statusCode ?? 502, headers: responseHeaders }));
    });
    req.on("error", reject);
    if (typeof init?.body === "string") req.end(init.body);
    else req.end();
  });
}
