// tests/unit/db-usage-logs.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { logUsage, getUsageByApiKey, getUsageByProvider, getUsageSummary, getDailyRequestCounts } =
  await import("../../src/lib/db/usageLogs.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM usage_logs").run();
});

test("getUsageByApiKey returns only that key's rows, newest first", () => {
  logUsage({
    apiKeyId: 1,
    providerId: "openai",
    connectionId: 1,
    model: "gpt-4o",
    promptTokens: 10,
    outputTokens: 5,
    latencyMs: 100,
    toolRounds: 0,
    error: null,
  });
  logUsage({
    apiKeyId: 2,
    providerId: "openai",
    connectionId: 1,
    model: "gpt-4o",
    promptTokens: 1,
    outputTokens: 1,
    latencyMs: 50,
    toolRounds: 0,
    error: null,
  });
  logUsage({
    apiKeyId: 1,
    providerId: "openai",
    connectionId: 1,
    model: "gpt-4o",
    promptTokens: 20,
    outputTokens: 8,
    latencyMs: 120,
    toolRounds: 0,
    error: null,
  });
  const rows = getUsageByApiKey(1);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.apiKeyId === 1));
  assert.ok(rows[0].createdAt >= rows[1].createdAt, "must be newest first");
});

test("getUsageByApiKey respects the limit", () => {
  for (let i = 0; i < 5; i += 1) {
    logUsage({
      apiKeyId: 1,
      providerId: "openai",
      connectionId: 1,
      model: "gpt-4o",
      promptTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      toolRounds: 0,
      error: null,
    });
  }
  assert.equal(getUsageByApiKey(1, 2).length, 2);
});

test("getUsageByProvider returns only that provider's rows", () => {
  logUsage({
    apiKeyId: 1,
    providerId: "openai",
    connectionId: 1,
    model: "gpt-4o",
    promptTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
    toolRounds: 0,
    error: null,
  });
  logUsage({
    apiKeyId: 1,
    providerId: "anthropic",
    connectionId: 2,
    model: "claude",
    promptTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
    toolRounds: 0,
    error: null,
  });
  const rows = getUsageByProvider("anthropic");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].providerId, "anthropic");
});

test("getUsageSummary aggregates requests, errors, and tokens since a timestamp", () => {
  logUsage({
    apiKeyId: 1,
    providerId: "openai",
    connectionId: 1,
    model: "gpt-4o",
    promptTokens: 10,
    outputTokens: 5,
    latencyMs: 100,
    toolRounds: 0,
    error: null,
  });
  logUsage({
    apiKeyId: 1,
    providerId: "openai",
    connectionId: 1,
    model: "gpt-4o",
    promptTokens: null,
    outputTokens: null,
    latencyMs: 50,
    toolRounds: 0,
    error: "upstream 503",
  });
  const summary = getUsageSummary(0);
  assert.equal(summary.requestCount, 2);
  assert.equal(summary.errorCount, 1);
  assert.equal(summary.totalPromptTokens, 10);
  assert.equal(summary.totalOutputTokens, 5);
  assert.equal(summary.avgLatencyMs, 75);
});

test("getUsageSummary excludes rows before the cutoff", () => {
  logUsage({
    apiKeyId: 1,
    providerId: "openai",
    connectionId: 1,
    model: "gpt-4o",
    promptTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
    toolRounds: 0,
    error: null,
  });
  const summary = getUsageSummary(Date.now() + 60_000);
  assert.equal(summary.requestCount, 0);
});

test("getUsageSummary on an empty table returns zeros, not null", () => {
  // SQLite's bare SUM()/AVG() over zero matched rows returns NULL, not 0 — only
  // COUNT(*) is naturally 0. Every aggregate column here must be COALESCE-wrapped.
  const summary = getUsageSummary(0);
  assert.deepEqual(summary, {
    requestCount: 0,
    errorCount: 0,
    totalPromptTokens: 0,
    totalOutputTokens: 0,
    avgLatencyMs: 0,
  });
});

function insertLog(createdAt: number): void {
  getDb()
    .prepare("INSERT INTO usage_logs (latency_ms, tool_rounds, created_at) VALUES (?, ?, ?)")
    .run(10, 0, createdAt);
}

test("getDailyRequestCounts groups by day and orders ascending", () => {
  const day1 = Date.UTC(2026, 0, 1, 12);
  const day2 = Date.UTC(2026, 0, 2, 12);
  insertLog(day1);
  insertLog(day1);
  insertLog(day2);

  const rows = getDailyRequestCounts(day1 - 1000);
  assert.deepEqual(rows, [
    { day: "2026-01-01", count: 2 },
    { day: "2026-01-02", count: 1 },
  ]);
});

test("getDailyRequestCounts excludes rows before the cutoff", () => {
  insertLog(Date.UTC(2025, 11, 1, 0));
  insertLog(Date.UTC(2026, 0, 5, 0));

  const rows = getDailyRequestCounts(Date.UTC(2026, 0, 1, 0));
  assert.deepEqual(rows, [{ day: "2026-01-05", count: 1 }]);
});
