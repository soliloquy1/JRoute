// tests/unit/migration-016-tavily-search-provider.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("migration 016 widens search_providers.kind CHECK to admit 'tavily'", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "jroute-migration-016-"));
  process.env.DATA_DIR = tmpDir;
  process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);
  const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
  const { createSearchProvider, getSearchProvider, listSearchProviders } =
    await import("../../src/lib/db/searchProviders.ts");

  const braveId = createSearchProvider("brave", "existing brave", "brave-secret");
  const tavilyId = createSearchProvider("tavily", "my tavily", "tavily-secret");

  assert.equal(getSearchProvider(braveId)?.kind, "brave", "the pre-existing kinds still work");
  assert.equal(getSearchProvider(tavilyId)?.kind, "tavily");
  assert.equal(getSearchProvider(tavilyId)?.apiKey, "tavily-secret");
  assert.equal(listSearchProviders().length, 2);

  const schemaRow = getDb()
    .prepare("SELECT sql FROM sqlite_master WHERE name = 'search_providers'")
    .get() as { sql: string };
  assert.ok(schemaRow.sql.includes("'tavily'"), "CHECK constraint must admit 'tavily'");

  resetDb();
  rmSync(tmpDir, { recursive: true, force: true });
});
