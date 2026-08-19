// tests/unit/key-table-regex-column.smoke.test.ts
import { test } from "node:test";
import { register } from "node:module";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./_stubs/navHooks.mjs", import.meta.url);

const { KeyTable } = await import("../../src/components/dashboard/KeyTable.tsx");

test("KeyTable renders a Regex column with the assigned preset name selected", () => {
  const html = renderToStaticMarkup(
    React.createElement(KeyTable, {
      keys: [
        {
          id: 1,
          keyHash: "h",
          label: "K1",
          presetId: null,
          richPresetId: null,
          logitBiasPresetId: null,
          regexPresetId: 7,
          toolMode: "off",
          rateLimitPerMin: 60,
          createdAt: 0,
        },
      ],
      presets: [],
      richPresets: [],
      logitBiasPresets: [],
      regexPresets: [{ id: 7, name: "Strip secret", scripts: [], createdAt: 0 }],
    })
  );
  assert.ok(html.includes("Regex"));
  assert.ok(html.includes("Strip secret"));
});
