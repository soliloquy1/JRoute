// tests/unit/api-rich-presets-reasoning-tags.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-api-rich-presets-reasoning-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { createRichPreset } = await import("../../src/lib/db/richPresets.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const DASHBOARD_AUTH_HEADER = {
  cookie: `jroute_session=${token}`,
  "content-type": "application/json",
};
const MINIMAL_RAW = { prompts: [{ identifier: "p1" }], prompt_order: [] };

test("PATCH /api/rich-presets/:id updates reasoningTags", async () => {
  const id = createRichPreset("Izumi", MINIMAL_RAW);

  const { PATCH, GET } = await import("../../src/app/api/rich-presets/[id]/route.ts");
  const res = await PATCH(
    new Request(`http://localhost/api/rich-presets/${id}`, {
      method: "PATCH",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({
        reasoningTags: [{ openTag: "<konatan_planning~>", closeTag: "</konatan_planning~>" }],
      }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 200);

  const got = await GET(
    new Request(`http://localhost/api/rich-presets/${id}`, { headers: DASHBOARD_AUTH_HEADER }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  const preset = (await got.json()) as { reasoningTags: Array<{ openTag: string }> };
  assert.equal(preset.reasoningTags[0].openTag, "<konatan_planning~>");
});

test("PATCH /api/rich-presets/:id rejects an invalid reasoningTags entry", async () => {
  const id = createRichPreset("Bad", MINIMAL_RAW);
  const { PATCH } = await import("../../src/app/api/rich-presets/[id]/route.ts");
  const res = await PATCH(
    new Request(`http://localhost/api/rich-presets/${id}`, {
      method: "PATCH",
      headers: DASHBOARD_AUTH_HEADER,
      body: JSON.stringify({ reasoningTags: [{ openTag: "<a>", closeTag: "<a>" }] }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(res.status, 400);
});
