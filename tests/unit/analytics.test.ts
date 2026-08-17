// tests/unit/analytics.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-analytics-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection, updateConnection } = await import("../../src/lib/db/connections.ts");
const { logUsage } = await import("../../src/lib/db/usageLogs.ts");
const { recordUsage } = await import("../../src/lib/db/quotaWindows.ts");
const { getProviderUsageTotals, getProviderQuotaStatus } = await import("../../src/lib/db/analytics.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  db.prepare("DELETE FROM usage_logs").run();
  db.prepare("DELETE FROM quota_windows").run();
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
  upsertProvider({
    id: "anthropic",
    name: "Anthropic",
    kind: "apikey",
    baseUrl: "https://api.anthropic.com/v1",
    wireFormat: "anthropic",
    enabled: true,
  });
});

test("getProviderUsageTotals aggregates requests/errors/tokens per provider", () => {
  const now = Date.now();
  logUsage({ apiKeyId: null, providerId: "openai", connectionId: null, model: "gpt-4o", promptTokens: 10, outputTokens: 5, latencyMs: 100, toolRounds: 0, error: null });
  logUsage({ apiKeyId: null, providerId: "openai", connectionId: null, model: "gpt-4o", promptTokens: 20, outputTokens: 15, latencyMs: 100, toolRounds: 0, error: "boom" });
  logUsage({ apiKeyId: null, providerId: "anthropic", connectionId: null, model: "claude", promptTokens: 3, outputTokens: 2, latencyMs: 100, toolRounds: 0, error: null });

  const rows = getProviderUsageTotals(now - 60_000);
  const openai = rows.find((r) => r.providerId === "openai")!;
  const anthropic = rows.find((r) => r.providerId === "anthropic")!;
  assert.equal(openai.requests, 2);
  assert.equal(openai.errors, 1);
  assert.equal(openai.promptTokens, 30);
  assert.equal(openai.outputTokens, 20);
  assert.equal(anthropic.requests, 1);
  assert.equal(anthropic.errors, 0);
});

test("getProviderUsageTotals excludes rows older than sinceMs", () => {
  logUsage({ apiKeyId: null, providerId: "openai", connectionId: null, model: "gpt-4o", promptTokens: 1, outputTokens: 1, latencyMs: 1, toolRounds: 0, error: null });
  const rows = getProviderUsageTotals(Date.now() + 60_000);
  assert.equal(rows.find((r) => r.providerId === "openai"), undefined);
});

test("getProviderQuotaStatus reports null limits + overQuota=false for a connection with no thresholds", () => {
  createConnection("openai", "primary", "sk-1");
  const [row] = getProviderQuotaStatus("openai", Date.now());
  assert.equal(row.requestLimit, null);
  assert.equal(row.tokenLimit, null);
  assert.equal(row.overQuota, false);
});

test("getProviderQuotaStatus reflects a configured threshold and live usage", () => {
  const id = createConnection("openai", "primary", "sk-1");
  updateConnection(id, { quotaWindowThresholds: JSON.stringify({ requests: 5, windowMs: 60_000 }) });
  const now = Date.now();
  recordUsage(id, 3, 100, now, 60_000);
  const [row] = getProviderQuotaStatus("openai", now);
  assert.equal(row.requestLimit, 5);
  assert.equal(row.requests, 3);
  assert.equal(row.tokens, 100);
  assert.equal(row.overQuota, false);

  recordUsage(id, 2, 0, now, 60_000);
  const [after2] = getProviderQuotaStatus("openai", now);
  assert.equal(after2.requests, 5);
  assert.equal(after2.overQuota, true);
});
