// tests/unit/providers-page.smoke.test.ts
// Regression guard (originally "Blocker 1"): the provider/model management page must
// still expose the add/manage affordances. /providers is now a redirect to /models
// (single consolidated grid page, category-grouped) — this test follows that move.
import { test } from "node:test";
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./_stubs/navHooks.mjs", import.meta.url);

const dir = mkdtempSync(join(tmpdir(), "jroute-pp-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

test("models page groups configured providers by category and exposes add/test affordances", async () => {
  const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
  const { upsertProvider } = await import("../../src/lib/db/providers.ts");
  const { createConnection } = await import("../../src/lib/db/connections.ts");

  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
  createConnection("openai", "primary", "sk-x");

  const { default: ModelsPage } = await import("../../src/app/(dashboard)/models/page.tsx");
  const html = renderToStaticMarkup(React.createElement(ModelsPage));

  assert.ok(html.includes("API Key Providers"), "page must render the API Key category section");
  assert.ok(html.includes("OpenAI"), "page must list the seeded provider");
  assert.ok(html.includes("Add provider"), "page must expose an add-provider affordance");
  assert.ok(html.includes("Test"), "page must expose a test affordance on the provider card");

  resetDb();
  rmSync(dir, { recursive: true, force: true });
});
