// src/lib/auth/guard.ts
import { verifyApiKey } from "./apiKeys.ts";
import { verifySession, SESSION_COOKIE } from "./sessions.ts";
import type { ApiKeyRecord } from "../db/types.ts";

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

/** Proxy surface: API key only. A dashboard cookie is never accepted here. */
export function authenticateProxy(req: Request): ApiKeyRecord | null {
  const bearer = req.headers.get("authorization");
  const raw = bearer?.startsWith("Bearer ")
    ? bearer.slice(7).trim()
    : req.headers.get("x-api-key")?.trim();
  if (!raw) return null;
  return verifyApiKey(raw);
}

/** Dashboard surface: session cookie only. A proxy API key is never accepted here. */
export function authenticateDashboard(req: Request): number | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  return verifySession(token);
}

export function corsHeadersFor(pathname: string, _origin: string | null): Record<string, string> {
  if (!pathname.startsWith("/v1/")) return {};
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Max-Age": "86400",
  };
}
