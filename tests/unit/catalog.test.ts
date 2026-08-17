// tests/unit/catalog.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-catalog-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { listProviders, getProvider, upsertProvider, seedCatalogProviders } = await import(
  "../../src/lib/db/providers.ts"
);
const { createConnection, updateConnection } = await import("../../src/lib/db/connections.ts");
const { CATALOG_PROVIDERS, DEFERRED_OAUTH_PROVIDERS } = await import(
  "../../src/lib/catalog/providers.ts"
);
const { WIRE_DESCRIPTORS } = await import("../../jroute/executor.ts");
const { logUsage } = await import("../../src/lib/db/usageLogs.ts");
const { recordUsage } = await import("../../src/lib/db/quotaWindows.ts");
const { getProviderUsageTotals, getCostOverTime, getProviderQuotaStatus } = await import(
  "../../src/lib/db/analytics.ts"
);

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().prepare("DELETE FROM usage_logs").run();
  getDb().prepare("DELETE FROM quota_windows").run();
  getDb().prepare("DELETE FROM connections").run();
  getDb().prepare("DELETE FROM providers").run();
  seedCatalogProviders();
});

// ── Catalog seeding gate ──────────────────────────────────────────────────────

test("seedCatalogProviders is idempotent", () => {
  const first = listProviders();
  const firstClaude = getProvider("claude");
  // Re-run seeding (simulates process restart) — must not duplicate or overwrite rows.
  seedCatalogProviders();
  const second = listProviders();
  assert.equal(second.length, first.length, "row count must be stable across re-seeds");
  const secondClaude = getProvider("claude");
  assert.equal(secondClaude?.baseUrl, firstClaude?.baseUrl, "re-seed must not alter existing rows");
});

test("seedCatalogProviders does not resurrect a provider the operator explicitly deleted", async () => {
  const { deleteProvider } = await import("../../src/lib/db/providers.ts");
  assert.ok(getProvider("claude"), "precondition: claude is seeded");
  deleteProvider("claude");
  assert.equal(getProvider("claude"), null);
  // A restart re-seeds — the deletion must survive it.
  seedCatalogProviders();
  assert.equal(getProvider("claude"), null, "deleted catalog provider must not resurrect on reseed");
});

test("re-adding a deleted catalog provider un-blocks future reseeds for that id", async () => {
  const { deleteProvider } = await import("../../src/lib/db/providers.ts");
  deleteProvider("claude");
  seedCatalogProviders();
  assert.equal(getProvider("claude"), null);

  // Operator manually re-adds it (e.g. re-picks it from the catalog grid).
  upsertProvider({
    id: "claude",
    name: "Claude Code",
    kind: "oauth",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    enabled: true,
    oauthProvider: "claude",
  });
  // If the operator now also deletes it via some OTHER path (a raw purge, not through
  // deleteProvider()), the id is no longer in deleted_catalog_provider_ids, so a
  // reseed restores it from the catalog rather than leaving it gone forever.
  getDb().prepare("DELETE FROM providers WHERE id = 'claude'").run();
  seedCatalogProviders();
  assert.ok(getProvider("claude"), "un-blocked id reseeds normally");
});

test("seedCatalogProviders never overwrites an operator-edited row", () => {
  // Operator edits a seeded provider's baseUrl.
  upsertProvider({
    id: "claude",
    name: "Claude (edited)",
    kind: "oauth",
    baseUrl: "https://example.invalid/v1",
    wireFormat: "anthropic",
    enabled: false,
    oauthProvider: "claude",
  });
  // A restart re-seeds (INSERT OR IGNORE) — the operator's edit must survive.
  seedCatalogProviders();
  const after = getProvider("claude");
  assert.equal(after?.baseUrl, "https://example.invalid/v1");
  assert.equal(after?.name, "Claude (edited)");
  assert.equal(after?.enabled, false);
});

test("every DEFERRED_OAUTH_PROVIDERS entry is absent from providers", () => {
  const present = DEFERRED_OAUTH_PROVIDERS.filter((d) => getProvider(d.id) !== null).map((d) => d.id);
  assert.deepEqual(present, [], `deferred providers must not be seeded: ${present.join(", ")}`);
});

test("every shipped catalog entry has an expressible wireFormat", () => {
  const valid = new Set(["openai", "anthropic", "gemini"]);
  for (const c of CATALOG_PROVIDERS) {
    if (c.wireFormat === null) continue; // deferred — not seeded, not a catalog row
    assert.ok(valid.has(c.wireFormat), `${c.id} has unsupported wireFormat ${c.wireFormat}`);
    assert.ok(getProvider(c.id) !== null, `${c.id} should be seeded as a providers row`);
  }
});

// Expected upstream endpoint per catalog id, re-derived from
// open-sse/config/providers/registry/<id>/index.ts. The composition must equal this,
// catching any catalog baseUrl that drops the version segment or points at a guessed host.
const EXPECTED_ENDPOINT: Record<string, string> = {
  claude: "https://api.anthropic.com/v1/messages",
  anthropic: "https://api.anthropic.com/v1/messages",
  "xai-oauth": "https://api.x.ai/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
  "kimi-coding": "https://api.moonshot.ai/v1/chat/completions",
  kilocode: "https://api.kilo.ai/api/openrouter/chat/completions",
  cline: "https://api.cline.bot/api/v1/chat/completions",
  clinepass: "https://api.cline.bot/api/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent",
};

test("baseUrl + wire path composes to the upstream registry URL", () => {
  for (const c of CATALOG_PROVIDERS) {
    if (c.wireFormat === null) continue;
    const wire = WIRE_DESCRIPTORS[c.wireFormat];
    assert.ok(wire, `${c.id}: no wire descriptor for ${c.wireFormat}`);
    const path = wire.buildPath
      ? wire.buildPath({ model: "m", stream: false })
      : wire.path;
    const composed = `${c.baseUrl.replace(/\/+$/, "")}${path}`;
    const expected = EXPECTED_ENDPOINT[c.id];
    assert.ok(expected, `${c.id}: missing expected endpoint in test fixture`);
    assert.equal(composed, expected, `${c.id}: composed ${composed} != registry ${expected}`);
  }
});

// ── Analytics aggregation ─────────────────────────────────────────────────────

function insertUsage(opts: {
  providerId: string;
  connectionId: number | null;
  prompt?: number;
  output?: number;
  costUs?: number;
  error?: string | null;
  ageMs?: number;
}) {
  getDb()
    .prepare(
      `INSERT INTO usage_logs
        (api_key_id, provider_id, connection_id, model, prompt_tokens, output_tokens, latency_ms, tool_rounds, error, cost_us, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      1,
      opts.providerId,
      opts.connectionId,
      "gpt-x",
      opts.prompt ?? 10,
      opts.output ?? 5,
      100,
      0,
      opts.error ?? null,
      opts.costUs ?? 0,
      Date.now() - (opts.ageMs ?? 0)
    );
}

test("getProviderUsageTotals aggregates requests, errors, tokens and cost", () => {
  insertUsage({ providerId: "openai", connectionId: 1, prompt: 10, output: 5, costUs: 0.02 });
  insertUsage({ providerId: "openai", connectionId: 1, prompt: 20, output: 10, costUs: 0.04 });
  insertUsage({ providerId: "openai", connectionId: 1, error: "boom" });
  insertUsage({ providerId: "anthropic", connectionId: 2, prompt: 1, output: 1, costUs: 0.01 });

  const rows = getProviderUsageTotals(Date.now() - 60_000);
  const byId = new Map(rows.map((r) => [r.providerId, r]));

  const oai = byId.get("openai")!;
  assert.equal(oai.requests, 3);
  assert.equal(oai.errors, 1);
  assert.equal(oai.promptTokens, 40);
  assert.equal(oai.outputTokens, 20);
  assert.ok(Math.abs(oai.costUs - 0.06) < 1e-9);

  const ant = byId.get("anthropic")!;
  assert.equal(ant.requests, 1);
  assert.equal(ant.costUs, 0.01);
});

test("getProviderUsageTotals excludes rows older than sinceMs", () => {
  insertUsage({ providerId: "openai", connectionId: 1, ageMs: 0 });
  insertUsage({ providerId: "openai", connectionId: 1, ageMs: 10 * 24 * 60 * 60 * 1000 });
  const recent = getProviderUsageTotals(Date.now() - 60_000);
  assert.equal(recent.find((r) => r.providerId === "openai")?.requests, 1);
});

test("getCostOverTime buckets by calendar day", () => {
  insertUsage({ providerId: "openai", connectionId: 1, costUs: 0.1 });
  const rows = getCostOverTime(Date.now() - 60_000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requests, 1);
  assert.ok(Math.abs(rows[0].costUs - 0.1) < 1e-9);
});

test("getProviderQuotaStatus reflects configured thresholds and live window", () => {
  upsertProvider({
    id: "claude",
    name: "Claude Code",
    kind: "oauth",
    baseUrl: "https://api.anthropic.com",
    wireFormat: "anthropic",
    enabled: true,
    oauthProvider: "claude",
  });
  const id = createConnection("claude", "a", "sk-a");
  updateConnection(id, {
    quotaWindowThresholds: JSON.stringify({ requests: 1, windowMs: 60_000 }),
  });
  const now = Date.now();
  // Healthy before any usage.
  assert.equal(getProviderQuotaStatus("claude", now)[0].overQuota, false);
  recordUsage(id, 1, 0, now);
  const status = getProviderQuotaStatus("claude", now);
  assert.equal(status.length, 1);
  assert.equal(status[0].requestLimit, 1);
  assert.equal(status[0].requests, 1);
  assert.equal(status[0].overQuota, true);
});

test("analytics aggregation uses logUsage shape end-to-end", () => {
  logUsage({
    apiKeyId: 1,
    providerId: "openai",
    connectionId: 1,
    model: "gpt-x",
    promptTokens: 7,
    outputTokens: 3,
    latencyMs: 50,
    toolRounds: 0,
    error: null,
  });
  const rows = getProviderUsageTotals(Date.now() - 60_000);
  const oai = rows.find((r) => r.providerId === "openai");
  assert.ok(oai);
  assert.equal(oai.requests, 1);
  assert.equal(oai.promptTokens, 7);
  assert.equal(oai.outputTokens, 3);
});
