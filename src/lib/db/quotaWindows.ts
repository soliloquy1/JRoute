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

/** A window length must be a positive, finite number of ms — anything else makes
 * `windowStartFor` produce a `NaN` key and silently breaks bucketing on the hot path. */
function clampWindowMs(windowMs: unknown): number | undefined {
  if (typeof windowMs !== "number" || !Number.isFinite(windowMs) || windowMs <= 0) return undefined;
  return Math.floor(windowMs);
}

/** Positive, finite integer counters; non-numeric/non-positive values are dropped. */
function clampCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const n = Math.floor(value);
  return n > 0 ? n : undefined;
}

export function parseQuotaThresholds(json: string | null | undefined): QuotaThresholds {
  if (!json) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // Corrupt JSON ⇒ treat as "no thresholds" rather than crashing selection.
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const raw = parsed as Record<string, unknown>;
  const out: QuotaThresholds = {};
  const requests = clampCount(raw.requests);
  if (requests !== undefined) out.requests = requests;
  const tokens = clampCount(raw.tokens);
  if (tokens !== undefined) out.tokens = tokens;
  const windowMs = clampWindowMs(raw.windowMs);
  if (windowMs !== undefined) out.windowMs = windowMs;
  return out;
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

/**
 * Increment the rolling window counters for a connection (idempotent upsert).
 * `windowMs` MUST match the connection's configured window — callers thread it through
 * from `parseQuotaThresholds(connection.quotaWindowThresholds).windowMs` so a non-60s
 * threshold actually trips `isOverQuota`. A `NaN`/`<=0` windowMs is clamped to the
 * default to avoid writing a `NaN` bucket key (which would never be read back).
 */
export function recordUsage(
  connectionId: number,
  requests: number,
  tokens: number,
  now: number,
  windowMs: number = DEFAULT_WINDOW_MS
): void {
  if (requests <= 0 && tokens <= 0) return;
  const safeWindowMs = clampWindowMs(windowMs) ?? DEFAULT_WINDOW_MS;
  const start = windowStartFor(now, safeWindowMs);
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

/**
 * Drop quota-window rows whose bucket start is older than `before` (a unix-ms epoch).
 * The table otherwise grows one row per connection per active window forever; callers
 * should schedule this (e.g. from a periodic maintenance tick) to bound its size.
 */
export function pruneQuotaWindows(before: number): number {
  const info = getDb()
    .prepare("DELETE FROM quota_windows WHERE window_start < ?")
    .run(before);
  return info.changes;
}
