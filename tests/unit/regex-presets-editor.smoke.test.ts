// tests/unit/regex-presets-editor.smoke.test.ts
import { test } from "node:test";
import { register } from "node:module";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./_stubs/navHooks.mjs", import.meta.url);

const { RegexPresetsEditor } = await import(
  "../../src/components/dashboard/regexPresets/RegexPresetsEditor.tsx"
);

test("RegexPresetsEditor renders the selected preset's scripts", () => {
  const html = renderToStaticMarkup(
    React.createElement(RegexPresetsEditor, {
      presets: [
        {
          id: 1,
          name: "Strip secret",
          scripts: [
            {
              scriptName: "s1",
              findRegex: "/secret/",
              replaceString: "[redacted]",
              trimStrings: [],
              placement: [1, 2],
              disabled: false,
              substituteRegex: 0,
            },
          ],
          createdAt: 0,
        },
      ],
    })
  );
  assert.ok(html.includes("Strip secret"));
  assert.ok(html.includes("s1"));
  assert.ok(html.includes("secret"));
});

test("RegexPresetsEditor shows an empty state with no presets", () => {
  const html = renderToStaticMarkup(React.createElement(RegexPresetsEditor, { presets: [] }));
  assert.ok(html.includes("No regex presets yet"));
});
