// src/lib/db/quotaWindows.ts
import { getDb } from "./bootstrap.ts";
import type { Connection } from "./types.ts";

export interface QuotaThresholds {
  /** Max requests allowed within one rolling window before the connection is skipped. */
  requests?: number;
  /** Max tokens allowed within one rolling window before the connection is skipped. */
  tokens?: number;
  /** Window length in ms. Defaults to 60_000 (per-minute buckets). */
  windowMs?: number;
}

const DEFAULT_WINDOW_MS = 60_000;

export function parseQuotaThresholds(json: string | null | undefined): QuotaThresholds {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object") return parsed as QuotaThresholds;
  } catch {
    // Corrupt JSON ⇒ treat as "no thresholds" rather than crashing selection.
  }
  return {};
}

/** Start epoch of the bucket containing `now` for a given window length. */
export function windowStartFor(now: number, windowMs: number): number {
  return now - (now % windowMs);
}

interface QuotaWindowRow {
  requests: number;
  tokens: number;
}

export function getWindow(
  connectionId: number,
  windowStart: number
): { requests: number; tokens: number } | null {
  const row = getDb()
    .prepare(
      "SELECT requests, tokens FROM quota_windows WHERE connection_id = ? AND window_start = ?"
    )
    .get(connectionId, windowStart) as QuotaWindowRow | undefined;
  return row ? { requests: row.requests, tokens: row.tokens } : null;
}

/**
 * True when the connection has exhausted its configured quota window and should be
 * skipped during selection (no combo engine — pure threshold check against the active
 * rolling window). Connections with no thresholds configured are never blocked.
 */
export function isOverQuota(connection: Connection, now: number): boolean {
  const t = parseQuotaThresholds(connection.quotaWindowThresholds);
  if (!t.requests && !t.tokens) return false;
  const windowMs = t.windowMs ?? DEFAULT_WINDOW_MS;
  const start = windowStartFor(now, windowMs);
  const w = getWindow(connection.id, start);
  if (!w) return false;
  if (t.requests !== undefined && w.requests >= t.requests) return true;
  if (t.tokens !== undefined && w.tokens >= t.tokens) return true;
  return false;
}

/** Increment the rolling window counters for a connection (idempotent upsert). */
export function recordUsage(
  connectionId: number,
  requests: number,
  tokens: number,
  now: number,
  windowMs: number = DEFAULT_WINDOW_MS
): void {
  if (requests <= 0 && tokens <= 0) return;
  const start = windowStartFor(now, windowMs);
  getDb()
    .prepare(
      `INSERT INTO quota_windows (connection_id, window_start, requests, tokens)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(connection_id, window_start) DO UPDATE SET
         requests = requests + excluded.requests,
         tokens = tokens + excluded.tokens`
    )
    .run(connectionId, start, requests, tokens);
}
