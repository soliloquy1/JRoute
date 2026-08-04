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
