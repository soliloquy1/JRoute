// tests/unit/model-manager-pagination.smoke.test.ts
// ModelManager's model list paginates at 20/page instead of rendering everything at once
// (was an endless-scroll page for providers with hundreds of imported models).
import { test } from "node:test";
import { register } from "node:module";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./_stubs/navHooks.mjs", import.meta.url);

const { ModelManager } = await import("../../src/components/dashboard/ModelManager.tsx");
const { ToastProvider } = await import("../../src/components/dashboard/ui.tsx");

function makeModels(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    providerId: "openrouter",
    modelId: `model-${i}`,
    clientId: `or/model-${i}`,
    enabled: true,
  }));
}

function renderManager(models: ReturnType<typeof makeModels>) {
  return renderToStaticMarkup(
    React.createElement(ToastProvider, null, React.createElement(ModelManager, { providerId: "openrouter", models }))
  );
}

test("25 models: page 1 shows only 20 rows and pagination controls appear", () => {
  const html = renderManager(makeModels(25));
  assert.ok(html.includes("Page 1 of 2"), "must show page indicator");
  for (let i = 0; i < 20; i++) assert.ok(html.includes(`or/model-${i}`), `model-${i} should be on page 1`);
  for (let i = 20; i < 25; i++) assert.ok(!html.includes(`or/model-${i}<`), `model-${i} should not render until page 2`);
  assert.ok(html.includes("Search models"), "search input present");
});

test("15 models: no pagination controls (fits on one page)", () => {
  const html = renderManager(makeModels(15));
  assert.ok(!html.includes("Page 1 of"), "pagination controls must not render for a single page");
  for (let i = 0; i < 15; i++) assert.ok(html.includes(`or/model-${i}`));
});

test("0 models: empty state, no search bar or pagination", () => {
  const html = renderManager([]);
  assert.ok(html.includes("No models yet"));
  assert.ok(!html.includes("Search models"));
});
