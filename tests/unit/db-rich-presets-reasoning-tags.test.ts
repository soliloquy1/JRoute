// tests/unit/db-rich-presets-reasoning-tags.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "jroute-rich-presets-reasoning-"));
  process.env.DATA_DIR = tmpDir;
});

after(async () => {
  const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
  resetDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

const MINIMAL_RAW = { prompts: [{ identifier: "p1" }], prompt_order: [] };

test("createRichPreset stores and round-trips reasoningTags", async () => {
  const { createRichPreset, getRichPreset } = await import("../../src/lib/db/richPresets.ts");
  const id = createRichPreset("Izumi", MINIMAL_RAW, {
    reasoningTags: [{ openTag: "<konatan_planning~>", closeTag: "</konatan_planning~>" }],
  });
  const got = getRichPreset(id);
  assert.equal(got?.reasoningTags.length, 1);
  assert.equal(got?.reasoningTags[0].openTag, "<konatan_planning~>");
  assert.equal(got?.reasoningTags[0].expectImplicitOpen, false);
});

test("createRichPreset defaults reasoningTags to an empty list", async () => {
  const { createRichPreset, getRichPreset } = await import("../../src/lib/db/richPresets.ts");
  const id = createRichPreset("Plain", MINIMAL_RAW);
  assert.deepEqual(getRichPreset(id)?.reasoningTags, []);
});

test("createRichPreset rejects an invalid reasoningTags entry (openTag === closeTag)", async () => {
  const { createRichPreset } = await import("../../src/lib/db/richPresets.ts");
  assert.throws(() =>
    createRichPreset("Bad", MINIMAL_RAW, {
      reasoningTags: [{ openTag: "<a>", closeTag: "<a>" }],
    })
  );
});

test("updateRichPreset replaces reasoningTags", async () => {
  const { createRichPreset, updateRichPreset, getRichPreset } = await import(
    "../../src/lib/db/richPresets.ts"
  );
  const id = createRichPreset("Editable", MINIMAL_RAW, {
    reasoningTags: [{ openTag: "<a>", closeTag: "</a>" }],
  });
  updateRichPreset(id, { reasoningTags: [{ openTag: "<b>", closeTag: "</b>", expectImplicitOpen: true }] });
  const got = getRichPreset(id);
  assert.equal(got?.reasoningTags.length, 1);
  assert.equal(got?.reasoningTags[0].openTag, "<b>");
  assert.equal(got?.reasoningTags[0].expectImplicitOpen, true);
});
