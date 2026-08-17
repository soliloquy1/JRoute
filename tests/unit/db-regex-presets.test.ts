// tests/unit/db-regex-presets.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegexScriptSchema } from "../../src/lib/prompts/regexScriptSchema.ts";

let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "jroute-regex-presets-"));
  process.env.DATA_DIR = tmpDir;
});

after(async () => {
  const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
  resetDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

// Build a fully-typed RegexScript from a partial literal. The literals intentionally pass
// patterns that `createRegexPreset` rejects at runtime (unsafe / non-compiling); the
// schema only requires a non-empty `findRegex` string, so parse here is purely for typing.
function s(obj: Record<string, unknown>) {
  return RegexScriptSchema.parse(obj) as import("../../src/lib/prompts/regexScriptSchema.ts").RegexScript;
}

test("createRegexPreset + getRegexPreset round-trip", async () => {
  const { createRegexPreset, getRegexPreset } = await import("../../src/lib/db/regexPresets.ts");
  const id = createRegexPreset("Strip brackets", [
    s({ scriptName: "s", findRegex: "/\\[.*?\\]/g", replaceString: "" }),
  ]);
  const got = getRegexPreset(id);
  assert.ok(got);
  assert.equal(got?.name, "Strip brackets");
  assert.equal(got?.scripts[0].scriptName, "s");
});

test("createRegexPreset rejects a script with an unsafe pattern", async () => {
  const { createRegexPreset, InvalidRegexScriptError } = await import(
    "../../src/lib/db/regexPresets.ts"
  );
  assert.throws(
    () =>
      createRegexPreset("Evil", [
        s({ scriptName: "s", findRegex: "/(a+)+$/", replaceString: "" }),
      ]),
    InvalidRegexScriptError
  );
});

test("createRegexPreset rejects a script whose findRegex does not compile", async () => {
  const { createRegexPreset, InvalidRegexScriptError } = await import(
    "../../src/lib/db/regexPresets.ts"
  );
  assert.throws(
    () => createRegexPreset("Broken", [s({ scriptName: "s", findRegex: "/[/", replaceString: "" })]),
    InvalidRegexScriptError
  );
});

test("createRegexPreset rejects a duplicate name", async () => {
  const { createRegexPreset } = await import("../../src/lib/db/regexPresets.ts");
  createRegexPreset("Dup", []);
  assert.throws(() => createRegexPreset("Dup", []));
});

test("listRegexPresets returns all, ordered by id", async () => {
  const { createRegexPreset, listRegexPresets } = await import("../../src/lib/db/regexPresets.ts");
  const a = createRegexPreset("A", []);
  const b = createRegexPreset("B", []);
  const ids = listRegexPresets().map((p) => p.id);
  assert.ok(ids.indexOf(a) < ids.indexOf(b));
});

test("updateRegexPreset replaces scripts and re-validates", async () => {
  const { createRegexPreset, updateRegexPreset, getRegexPreset } = await import(
    "../../src/lib/db/regexPresets.ts"
  );
  const id = createRegexPreset("E", [s({ scriptName: "a", findRegex: "/x/", replaceString: "y" })]);
  updateRegexPreset(id, {
    scripts: [s({ scriptName: "b", findRegex: "/z/", replaceString: "w" })],
  });
  const got = getRegexPreset(id);
  assert.equal(got?.scripts.length, 1);
  assert.equal(got?.scripts[0].scriptName, "b");
});

test("updateRegexPreset renames without touching scripts", async () => {
  const { createRegexPreset, updateRegexPreset, getRegexPreset } = await import(
    "../../src/lib/db/regexPresets.ts"
  );
  const id = createRegexPreset("F", [s({ scriptName: "a", findRegex: "/x/", replaceString: "y" })]);
  updateRegexPreset(id, { name: "F2" });
  const got = getRegexPreset(id);
  assert.equal(got?.name, "F2");
  assert.equal(got?.scripts.length, 1);
});

test("deleteRegexPreset removes the row", async () => {
  const { createRegexPreset, deleteRegexPreset, getRegexPreset } = await import(
    "../../src/lib/db/regexPresets.ts"
  );
  const id = createRegexPreset("G", []);
  deleteRegexPreset(id);
  assert.equal(getRegexPreset(id), null);
});

test("getRegexPreset returns null for an unknown id", async () => {
  const { getRegexPreset } = await import("../../src/lib/db/regexPresets.ts");
  assert.equal(getRegexPreset(999999), null);
});
