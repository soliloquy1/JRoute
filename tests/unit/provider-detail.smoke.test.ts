// tests/unit/provider-detail.smoke.test.ts
// Phase 1b smoke test: the provider detail view renders models + connections + quota
// status for a configured provider.
import { test } from "node:test";
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./_stubs/navHooks.mjs", import.meta.url);

const dir = mkdtempSync(join(tmpdir(), "jroute-pd-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

test("provider detail view renders models and connections for a configured provider", async () => {
  const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
  const { upsertProvider, getProvider } = await import("../../src/lib/db/providers.ts");
  const { createConnection, updateConnection, listConnections } = await import(
    "../../src/lib/db/connections.ts"
  );
  const { createModel } = await import("../../src/lib/db/models.ts");

  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
  createModel("openai", "gpt-4o");
  const connId = createConnection("openai", "primary", "sk-x");
  updateConnection(connId, {
    quotaWindowThresholds: JSON.stringify({ requests: 2, windowMs: 60_000 }),
  });

  const { ProviderDetailView } = await import(
    "../../src/components/dashboard/ProviderDetailView.tsx"
  );
  const html = renderToStaticMarkup(
    React.createElement(ProviderDetailView, {
      provider: getProvider("openai")!,
      models: [{ providerId: "openai", modelId: "gpt-4o", clientId: "gpt-4o", enabled: true }],
      connections: listConnections("openai"),
    })
  );

  assert.ok(html.includes("OpenAI"), "view must show the provider name");
  assert.ok(html.includes("Models"), "view must render the models section");
  assert.ok(html.includes("gpt-4o"), "view must list the provider's models");
  assert.ok(html.includes("Connections"), "view must render the connections section");
  assert.ok(html.includes("primary"), "view must list the connection");

  resetDb();
  rmSync(dir, { recursive: true, force: true });
});
