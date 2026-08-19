// tests/unit/rich-presets-editor-reasoning-tags.smoke.test.ts
import { test } from "node:test";
import { register } from "node:module";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./_stubs/navHooks.mjs", import.meta.url);

const { RichPresetsEditor } = await import(
  "../../src/components/dashboard/richPresets/RichPresetsEditor.tsx"
);

test("RichPresetsEditor renders configured reasoning tag rows", () => {
  const html = renderToStaticMarkup(
    React.createElement(RichPresetsEditor, {
      presets: [
        {
          id: 1,
          name: "Izumi",
          raw: { prompts: [{ identifier: "p1", name: "System", role: "system" }], prompt_order: [] },
          charName: "",
          userName: "",
          createdAt: 0,
          lorebookIds: [],
          reasoningTags: [
            { openTag: "<konatan_planning~>", closeTag: "</konatan_planning~>", expectImplicitOpen: false },
          ],
        },
      ],
      lorebooks: [],
      keyLabelsByPreset: {},
    })
  );
  assert.ok(html.includes("Reasoning tags"));
  assert.ok(html.includes("konatan_planning"));
});
