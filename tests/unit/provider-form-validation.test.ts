// tests/unit/provider-form-validation.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAddCompatibleProvider,
  validateAddApiKey,
  PROVIDER_ID_RE,
  MODEL_PREFIX_RE,
} from "../../src/components/dashboard/providerFormValidation.ts";

test("PROVIDER_ID_RE accepts lowercase/digits/dashes, rejects others", () => {
  assert.ok(PROVIDER_ID_RE.test("openai"));
  assert.ok(PROVIDER_ID_RE.test("my-provider-1"));
  assert.ok(!PROVIDER_ID_RE.test("OpenAI"));
  assert.ok(!PROVIDER_ID_RE.test("my_provider"));
  assert.ok(!PROVIDER_ID_RE.test("has space"));
});

test("MODEL_PREFIX_RE allows empty or lowercase/digits", () => {
  assert.ok(MODEL_PREFIX_RE.test(""));
  assert.ok(MODEL_PREFIX_RE.test("or"));
  assert.ok(!MODEL_PREFIX_RE.test("OR"));
  assert.ok(!MODEL_PREFIX_RE.test("or/"));
});

test("validateAddCompatibleProvider: valid openai passes", () => {
  const errs = validateAddCompatibleProvider(
    { id: "my-prov", name: "My Prov", baseUrl: "https://api.example.com/v1", wireFormat: "openai", modelPrefix: "" },
    ["openai"]
  );
  assert.deepEqual(errs, {});
});

test("validateAddCompatibleProvider: id, name, baseUrl, prefix, duplicate", () => {
  const base = {
    id: "x",
    name: "X",
    baseUrl: "https://api.example.com/v1",
    wireFormat: "openai" as const,
    modelPrefix: "",
  };
  assert.equal(validateAddCompatibleProvider({ ...base, id: "" }, ["openai"]).id, "Provider id is required");
  assert.equal(
    validateAddCompatibleProvider({ ...base, id: "Bad_ID" }, ["openai"]).id,
    "Id must be lowercase letters, digits, or dashes (a-z0-9-)"
  );
  assert.equal(
    validateAddCompatibleProvider({ ...base, id: "openai" }, ["openai"]).id,
    "A provider with this id already exists"
  );
  assert.equal(validateAddCompatibleProvider({ ...base, name: "" }, ["openai"]).name, "Display name is required");
  assert.equal(
    validateAddCompatibleProvider({ ...base, baseUrl: "" }, ["openai"]).baseUrl,
    "Base URL is required"
  );
  assert.equal(
    validateAddCompatibleProvider({ ...base, baseUrl: "ftp://x" }, ["openai"]).baseUrl,
    "Base URL must start with http(s)://"
  );
  assert.equal(
    validateAddCompatibleProvider({ ...base, baseUrl: "not a url" }, ["openai"]).baseUrl,
    "Base URL must be a valid http(s) URL"
  );
  assert.equal(
    validateAddCompatibleProvider({ ...base, modelPrefix: "OR/" }, ["openai"]).modelPrefix,
    "Prefix must be empty or lowercase letters/digits"
  );
});

test("validateAddApiKey: required label/key and non-negative integer priority", () => {
  assert.equal(validateAddApiKey({ label: "", apiKey: "", priority: "" }).label, "Label is required");
  assert.equal(validateAddApiKey({ label: "a", apiKey: "", priority: "" }).apiKey, "API key is required");
  assert.equal(validateAddApiKey({ label: "a", apiKey: "k", priority: "-1" }).priority, "Priority must be a non-negative integer");
  assert.equal(validateAddApiKey({ label: "a", apiKey: "k", priority: "x" }).priority, "Priority must be a non-negative integer");
  assert.deepEqual(validateAddApiKey({ label: "a", apiKey: "k", priority: "100" }), {});
  assert.deepEqual(validateAddApiKey({ label: "a", apiKey: "k", priority: "" }), {});
});
