// tests/unit/import-provider-models.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pullProviderModelIds } from "../../src/lib/dashboard/importProviderModels.ts";
import type { Provider } from "../../src/lib/db/types.ts";

const provider: Provider = {
  id: "openai",
  name: "openai",
  kind: "apikey",
  baseUrl: "https://api.openai.com/v1",
  wireFormat: "openai",
  enabled: true,
  modelPrefix: "",
};

test("pullProviderModelIds redacts the api key if the provider echoes it back in an error body", async () => {
  const apiKey = "sk-super-secret-key";
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 401,
    text: async () => `{"error":"invalid key ${apiKey} was rejected"}`,
  })) as unknown as typeof fetch;
  try {
    await assert.rejects(
      () => pullProviderModelIds(provider, apiKey),
      (err: Error) => {
        assert.ok(!err.message.includes(apiKey), "error message must not contain the raw api key");
        assert.ok(err.message.includes("[redacted]"));
        return true;
      }
    );
  } finally {
    globalThis.fetch = original;
  }
});
