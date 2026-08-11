// src/lib/db/usageLogs.ts
import { getDb } from "./bootstrap.ts";

export interface UsageEntry {
  apiKeyId: number | null;
  providerId: string | null;
  connectionId: number | null;
  model: string | null;
  promptTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  toolRounds: number;
  error: string | null;
}

export function logUsage(entry: UsageEntry): void {
  getDb()
    .prepare(
      `INSERT INTO usage_logs
         (api_key_id, provider_id, connection_id, model, prompt_tokens,
          output_tokens, latency_ms, tool_rounds, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.apiKeyId,
      entry.providerId,
      entry.connectionId,
      entry.model,
      entry.promptTokens,
      entry.outputTokens,
      entry.latencyMs,
      entry.toolRounds,
      entry.error,
      Date.now()
    );
}

export interface UsageLogRow {
  id: number;
  apiKeyId: number | null;
  providerId: string | null;
  connectionId: number | null;
  model: string | null;
  promptTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  toolRounds: number;
  error: string | null;
  createdAt: number;
}

export interface UsageSummary {
  requestCount: number;
  errorCount: number;
  totalPromptTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
}

interface UsageLogDbRow {
  id: number;
  api_key_id: number | null;
  provider_id: string | null;
  connection_id: number | null;
  model: string | null;
  prompt_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  tool_rounds: number;
  error: string | null;
  created_at: number;
}

function toRow(r: UsageLogDbRow): UsageLogRow {
  return {
    id: r.id,
    apiKeyId: r.api_key_id,
    providerId: r.provider_id,
    connectionId: r.connection_id,
    model: r.model,
    promptTokens: r.prompt_tokens,
    outputTokens: r.output_tokens,
    latencyMs: r.latency_ms,
    toolRounds: r.tool_rounds,
    error: r.error,
    createdAt: r.created_at,
  };
}

export function getUsageByApiKey(apiKeyId: number, limit = 50): UsageLogRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM usage_logs WHERE api_key_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(apiKeyId, limit) as UsageLogDbRow[];
  return rows.map(toRow);
}

export function getUsageByProvider(providerId: string, limit = 50): UsageLogRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM usage_logs WHERE provider_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(providerId, limit) as UsageLogDbRow[];
  return rows.map(toRow);
}

export function getUsageSummary(sinceMs: number): UsageSummary {
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) as requestCount,
         COALESCE(SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END), 0) as errorCount,
         COALESCE(SUM(prompt_tokens), 0) as totalPromptTokens,
         COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
         COALESCE(AVG(latency_ms), 0) as avgLatencyMs
       FROM usage_logs WHERE created_at >= ?`
    )
    .get(sinceMs) as {
    requestCount: number;
    errorCount: number;
    totalPromptTokens: number;
    totalOutputTokens: number;
    avgLatencyMs: number;
  };
  return row;
}

export interface DailyCount {
  day: string;
  count: number;
}

export function getDailyRequestCounts(sinceMs: number): DailyCount[] {
  return getDb()
    .prepare(
      `SELECT date(created_at / 1000, 'unixepoch') as day, COUNT(*) as count
       FROM usage_logs WHERE created_at >= ? GROUP BY day ORDER BY day ASC`
    )
    .all(sinceMs) as DailyCount[];
}
