// tests/unit/analytics-page.smoke.test.ts
import { test } from "node:test";
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./_stubs/navHooks.mjs", import.meta.url);

const dir = mkdtempSync(join(tmpdir(), "jroute-analytics-page-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

test("analytics page renders usage totals and quota status sections", async () => {
  const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
  const { upsertProvider } = await import("../../src/lib/db/providers.ts");
  const { createConnection, updateConnection } = await import("../../src/lib/db/connections.ts");
  const { logUsage } = await import("../../src/lib/db/usageLogs.ts");
  const { recordUsage } = await import("../../src/lib/db/quotaWindows.ts");

  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
  const connId = createConnection("openai", "primary", "sk-x");
  updateConnection(connId, { quotaWindowThresholds: JSON.stringify({ requests: 100, windowMs: 60_000 }) });
  recordUsage(connId, 1, 50, Date.now(), 60_000);
  logUsage({
    apiKeyId: null,
    providerId: "openai",
    connectionId: connId,
    model: "gpt-4o",
    promptTokens: 10,
    outputTokens: 5,
    latencyMs: 42,
    toolRounds: 0,
    error: null,
  });

  const { default: AnalyticsPage } = await import("../../src/app/(dashboard)/analytics/page.tsx");
  const html = renderToStaticMarkup(React.createElement(AnalyticsPage));

  assert.ok(html.includes("Analytics"), "page must render its heading");
  assert.ok(html.includes("Usage by provider"), "page must render the usage-by-provider section");
  assert.ok(html.includes("Quota status"), "page must render the quota-status section");
  assert.ok(html.includes("openai"), "page must list the seeded provider's usage row");
  assert.ok(html.includes("primary"), "page must list the seeded connection's quota row");

  resetDb();
  rmSync(dir, { recursive: true, force: true });
});
