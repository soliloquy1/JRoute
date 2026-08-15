// tests/unit/provider-modals.smoke.test.ts
// Phase 1c smoke test: the add-connection and add-compatible-provider modals render their
// fields (and require the nav stub for useRouter).
import { test } from "node:test";
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./_stubs/navHooks.mjs", import.meta.url);

const dir = mkdtempSync(join(tmpdir(), "jroute-modals-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

test("AddApiKeyModal renders connection fields", async () => {
  const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
  const { AddApiKeyModal } = await import("../../src/components/dashboard/AddApiKeyModal.tsx");
  const { ToastProvider } = await import("../../src/components/dashboard/ui.tsx");
  const html = renderToStaticMarkup(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(AddApiKeyModal, {
        providerId: "openai",
        providerName: "OpenAI",
        onClose: () => {},
      })
    )
  );
  assert.ok(html.includes("Add connection"), "modal title present");
  assert.ok(html.includes("API key"), "api key field present");
  assert.ok(html.includes("Priority"), "priority field present");
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

test("AddCompatibleProviderModal renders provider fields", async () => {
  const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
  const { AddCompatibleProviderModal } = await import(
    "../../src/components/dashboard/AddCompatibleProviderModal.tsx"
  );
  const { ToastProvider } = await import("../../src/components/dashboard/ui.tsx");
  const html = renderToStaticMarkup(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(AddCompatibleProviderModal, { existingIds: ["openai"], onClose: () => {} })
    )
  );
  assert.ok(html.includes("Add compatible provider"), "modal title present");
  assert.ok(html.includes("Provider id"), "id field present");
  assert.ok(html.includes("Base URL"), "base url field present");
  assert.ok(html.includes("Wire format"), "wire format field present");
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});
