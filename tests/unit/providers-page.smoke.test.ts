// tests/unit/providers-page.smoke.test.ts
// Blocker 1 smoke test: the providers page must still expose an add-connection
// affordance for configured providers (provider management must not be dropped).
import { test } from "node:test";
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Stub next/navigation: its client hooks throw "invariant expected app router to be
// mounted" when rendered outside a Next request. The dashboard client components only
// use useRouter (for router.refresh()), which we no-op for the static render.
register("./_stubs/navHooks.mjs", import.meta.url);

const dir = mkdtempSync(join(tmpdir(), "jroute-pp-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

test("providers page exposes an add-connection affordance when a provider exists", async () => {
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

  const { default: ProvidersPage } = await import(
    "../../src/app/(dashboard)/providers/page.tsx"
  );
  const html = renderToStaticMarkup(React.createElement(ProvidersPage));

  assert.ok(
    html.includes("Your providers"),
    "page must render the configured-providers section"
  );
  assert.ok(
    html.includes("Add connection"),
    "page must expose an add-connection affordance for configured providers"
  );

  resetDb();
  rmSync(dir, { recursive: true, force: true });
});
