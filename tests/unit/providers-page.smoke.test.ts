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

test("models page offers to re-add a deleted catalog provider, and hides that button once every catalog id is present", async () => {
  const dir2 = mkdtempSync(join(tmpdir(), "jroute-pp2-"));
  process.env.DATA_DIR = dir2;

  const { resetDb, getDb } = await import("../../src/lib/db/bootstrap.ts");
  const { seedCatalogProviders, deleteProvider } = await import("../../src/lib/db/providers.ts");
  seedCatalogProviders();
  deleteProvider("claude");

  const { default: ModelsPage } = await import("../../src/app/(dashboard)/models/page.tsx");
  const withGap = renderToStaticMarkup(React.createElement(ModelsPage));
  assert.ok(withGap.includes("From catalog"), "must offer to re-add a deleted catalog provider");

  getDb().prepare("DELETE FROM deleted_catalog_provider_ids WHERE provider_id = 'claude'").run();
  seedCatalogProviders();
  const withoutGap = renderToStaticMarkup(React.createElement(ModelsPage));
  assert.ok(
    !withoutGap.includes("From catalog"),
    "must not show the re-add affordance once every catalog id is present"
  );

  resetDb();
  rmSync(dir2, { recursive: true, force: true });
});
