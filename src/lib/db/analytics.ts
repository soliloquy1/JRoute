// src/lib/db/analytics.ts
import { getDb } from "./bootstrap.ts";
import { listConnections } from "./connections.ts";
import { isOverQuota, parseQuotaThresholds, getWindow } from "./quotaWindows.ts";

export interface ProviderUsageRow {
  providerId: string;
  requests: number;
  errors: number;
  promptTokens: number;
  outputTokens: number;
  costUs: number;
}

export interface CostOverTimePoint {
  bucket: string;
  requests: number;
  costUs: number;
  promptTokens: number;
  outputTokens: number;
}

export interface ConnectionQuotaStatus {
  connectionId: number;
  label: string;
  windowStart: number | null;
  requests: number;
  tokens: number;
  requestLimit: number | null;
  tokenLimit: number | null;
  overQuota: boolean;
}

/**
 * Aggregate request/error/token/cost counts per provider since `sinceMs`.
 *
 * Named distinctly from `usageLogs.ts`'s `getUsageByProvider` (a same-name, different
 * shape function: per-provider raw log ROWS, not aggregated totals) — the collision
 * meant importing both together silently shadowed one or the other. Plan Phase 3 calls
 * this out; this one owns the "totals" name since it's the newer of the two.
 */
export function getProviderUsageTotals(sinceMs: number): ProviderUsageRow[] {
  const rows = getDb()
    .prepare(
      `SELECT
         provider_id,
         COUNT(*) as requests,
         COALESCE(SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END), 0) as errors,
         COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
         COALESCE(SUM(output_tokens), 0) as output_tokens,
         COALESCE(SUM(cost_us), 0) as cost_us
       FROM usage_logs
       WHERE created_at >= ? AND provider_id IS NOT NULL
       GROUP BY provider_id
       ORDER BY requests DESC`
    )
    .all(sinceMs) as Array<{
    provider_id: string;
    requests: number;
    errors: number;
    prompt_tokens: number;
    output_tokens: number;
    cost_us: number;
  }>;
  return rows.map((r) => ({
    providerId: r.provider_id,
    requests: r.requests,
    errors: r.errors,
    promptTokens: r.prompt_tokens,
    outputTokens: r.output_tokens,
    costUs: r.cost_us,
  }));
}

/**
 * Bucketed cost / token / request series over time. Points are grouped by calendar day
 * for stable dashboard charts.
 */
export function getCostOverTime(sinceMs: number): CostOverTimePoint[] {
  const rows = getDb()
    .prepare(
      `SELECT
         date(created_at / 1000, 'unixepoch') as bucket,
         COUNT(*) as requests,
         COALESCE(SUM(cost_us), 0) as cost_us,
         COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
         COALESCE(SUM(output_tokens), 0) as output_tokens
       FROM usage_logs
       WHERE created_at >= ?
       GROUP BY bucket
       ORDER BY bucket ASC`
    )
    .all(sinceMs) as Array<{
    bucket: string;
    requests: number;
    cost_us: number;
    prompt_tokens: number;
    output_tokens: number;
  }>;
  return rows.map((r) => ({
    bucket: r.bucket,
    requests: r.requests,
    costUs: r.cost_us,
    promptTokens: r.prompt_tokens,
    outputTokens: r.output_tokens,
  }));
}

/** Live quota status for every connection of a provider against its configured thresholds. */
export function getProviderQuotaStatus(providerId: string, now: number): ConnectionQuotaStatus[] {
  return listConnections(providerId).map((c) => {
    const t = parseQuotaThresholds(c.quotaWindowThresholds);
    const windowMs = t.windowMs ?? 60_000;
    const start = now - (now % windowMs);
    const w = getWindow(c.id, start);
    return {
      connectionId: c.id,
      label: c.label,
      windowStart: w ? start : null,
      requests: w?.requests ?? 0,
      tokens: w?.tokens ?? 0,
      requestLimit: t.requests ?? null,
      tokenLimit: t.tokens ?? null,
      overQuota: isOverQuota(c, now),
    };
  });
}
