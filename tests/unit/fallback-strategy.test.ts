// tests/unit/fallback-strategy.test.ts
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-fallback-strategy-"));
process.env.DATA_DIR = dir;

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection } = await import("../../src/lib/db/connections.ts");
const { getFallbackStrategy, setFallbackStrategy } = await import("../../src/lib/db/settings.ts");
const { getLastConnectionId, setLastConnectionId } = await import(
  "../../src/lib/db/providerRoutingState.ts"
);
const { applyFallbackStrategy } = await import("../../jroute/selectConnection.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  db.prepare("DELETE FROM settings").run();
  db.prepare("DELETE FROM provider_routing_state").run();
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
});

test("getFallbackStrategy defaults to priority", () => {
  assert.equal(getFallbackStrategy(), "priority");
});

test("setFallbackStrategy persists and round-trips", () => {
  setFallbackStrategy("round-robin");
  assert.equal(getFallbackStrategy(), "round-robin");
  setFallbackStrategy("priority");
  assert.equal(getFallbackStrategy(), "priority");
});

test("provider_routing_state: unset ⇒ null, set ⇒ round-trips, upsert overwrites", () => {
  assert.equal(getLastConnectionId("openai"), null);
  setLastConnectionId("openai", 7);
  assert.equal(getLastConnectionId("openai"), 7);
  setLastConnectionId("openai", 9);
  assert.equal(getLastConnectionId("openai"), 9);
});

test("applyFallbackStrategy: priority strategy is a no-op", () => {
  const a = createConnection("openai", "a", "sk-a");
  const b = createConnection("openai", "b", "sk-b");
  const list = [{ id: a }, { id: b }] as never;
  const out = applyFallbackStrategy(list, "priority", "openai");
  assert.deepEqual(out, list);
});

test("applyFallbackStrategy: round-robin with no cursor is a no-op (starts at priority order)", () => {
  const a = createConnection("openai", "a", "sk-a");
  const b = createConnection("openai", "b", "sk-b");
  const list = [{ id: a }, { id: b }] as never;
  const out = applyFallbackStrategy(list, "round-robin", "openai");
  assert.deepEqual(
    out.map((c: { id: number }) => c.id),
    [a, b]
  );
});

test("applyFallbackStrategy: round-robin rotates to start after the last-used connection", () => {
  const a = createConnection("openai", "a", "sk-a");
  const b = createConnection("openai", "b", "sk-b");
  const c = createConnection("openai", "c", "sk-c");
  setLastConnectionId("openai", a);
  const list = [{ id: a }, { id: b }, { id: c }] as never;
  const out = applyFallbackStrategy(list, "round-robin", "openai");
  assert.deepEqual(
    out.map((x: { id: number }) => x.id),
    [b, c, a],
    "starts right after 'a', wraps around to keep 'a' as the last fallback"
  );
});

test("applyFallbackStrategy: round-robin falls back to natural order when the cursor connection no longer exists", () => {
  const a = createConnection("openai", "a", "sk-a");
  const b = createConnection("openai", "b", "sk-b");
  setLastConnectionId("openai", 99999); // deleted/never-existed connection id
  const list = [{ id: a }, { id: b }] as never;
  const out = applyFallbackStrategy(list, "round-robin", "openai");
  assert.deepEqual(
    out.map((x: { id: number }) => x.id),
    [a, b]
  );
});
