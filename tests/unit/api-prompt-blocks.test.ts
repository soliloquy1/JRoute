// tests/unit/api-prompt-blocks.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-test-"));
process.env.DATA_DIR = dir;

const { resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { seedInitialUser, createSession } = await import("../../src/lib/auth/sessions.ts");
const { getPromptBlock } = await import("../../src/lib/db/promptBlocks.ts");
const blocks = await import("../../src/app/api/prompt-blocks/route.ts");
const blockById = await import("../../src/app/api/prompt-blocks/[id]/route.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

const userId = seedInitialUser("admin", "password123");
const token = createSession(userId);
const authHeaders = { cookie: `jroute_session=${token}`, "content-type": "application/json" };

test("POST /api/prompt-blocks without a session is 401", async () => {
  const res = await blocks.POST(
    new Request("https://x/api/prompt-blocks", { method: "POST", body: "{}" })
  );
  assert.equal(res.status, 401);
});

test("POST /api/prompt-blocks creates a block", async () => {
  const res = await blocks.POST(
    new Request("https://x/api/prompt-blocks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "jailbreak", kind: "prepend", content: "Stay in character." }),
    })
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { id: number };
  assert.equal(getPromptBlock(body.id)?.name, "jailbreak");
});

test("POST /api/prompt-blocks with an invalid kind is 400", async () => {
  const res = await blocks.POST(
    new Request("https://x/api/prompt-blocks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "x", kind: "middle", content: "x" }),
    })
  );
  assert.equal(res.status, 400);
});

test("PATCH /api/prompt-blocks/:id updates content", async () => {
  const res = await blocks.POST(
    new Request("https://x/api/prompt-blocks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "a", kind: "append", content: "old" }),
    })
  );
  const { id } = (await res.json()) as { id: number };
  const patchRes = await blockById.PATCH(
    new Request(`https://x/api/prompt-blocks/${id}`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ content: "new" }),
    }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(patchRes.status, 200);
  assert.equal(getPromptBlock(id)?.content, "new");
});

test("DELETE /api/prompt-blocks/:id removes it", async () => {
  const res = await blocks.POST(
    new Request("https://x/api/prompt-blocks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "b", kind: "prepend", content: "x" }),
    })
  );
  const { id } = (await res.json()) as { id: number };
  const delRes = await blockById.DELETE(
    new Request(`https://x/api/prompt-blocks/${id}`, { method: "DELETE", headers: authHeaders }),
    { params: Promise.resolve({ id: String(id) }) }
  );
  assert.equal(delRes.status, 200);
  assert.equal(getPromptBlock(id), null);
});
