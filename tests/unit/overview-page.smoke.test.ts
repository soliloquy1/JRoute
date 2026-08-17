// tests/unit/overview-page.smoke.test.ts
// Housekeeping regression: catalog providers are auto-seeded at boot, so a raw
// provider-row count was always > 0 — the "getting started" checklist could read as
// fully satisfied (and disappear) with keys/presets configured but zero connections,
// since providerCount was never actually zero. It must key off real connections.
import { test } from "node:test";
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./_stubs/navHooks.mjs", import.meta.url);

const dir = mkdtempSync(join(tmpdir(), "jroute-overview-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const minimalPreset = {
  temperature: 1,
  top_p: 0.99,
  prompts: [
    { identifier: "main", name: "Main Prompt", role: "system", content: "Write a reply.", system_prompt: true },
  ],
  prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
};

test("getting-started checklist stays up when catalog rows + keys + presets exist but there is still no connection", async () => {
  const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
  const { seedCatalogProviders } = await import("../../src/lib/db/providers.ts");
  const { issueApiKey } = await import("../../src/lib/auth/apiKeys.ts");
  const { createRichPreset } = await import("../../src/lib/db/richPresets.ts");

  seedCatalogProviders(); // many provider ROWS from the boot-time seed, but 0 connections
  issueApiKey("client");
  createRichPreset("preset", minimalPreset);

  const { default: OverviewPage } = await import("../../src/app/(dashboard)/page.tsx");
  const html = renderToStaticMarkup(React.createElement(OverviewPage));

  // With the old `listProviders().length` bug this block would be entirely absent
  // here (providerCount was already > 0 from the catalog seed, and keys/presets are
  // both configured too, so setupIncomplete would be false).
  assert.ok(
    html.includes("Add a provider"),
    "checklist must still surface until an actual connection exists, not just a catalog row"
  );

  resetDb();
  rmSync(dir, { recursive: true, force: true });
});
