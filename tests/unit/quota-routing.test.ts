// tests/unit/quota-routing.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jroute-quota-"));
process.env.DATA_DIR = dir;
process.env.STORAGE_ENCRYPTION_KEY = "0".repeat(64);

const { getDb, resetDb } = await import("../../src/lib/db/bootstrap.ts");
const { upsertProvider } = await import("../../src/lib/db/providers.ts");
const { createConnection, updateConnection, listConnections } = await import(
  "../../src/lib/db/connections.ts"
);
const { eligibleConnections } = await import("../../jroute/selectConnection.ts");
const { isOverQuota, recordUsage, getWindow, parseQuotaThresholds, pruneQuotaWindows } =
  await import("../../src/lib/db/quotaWindows.ts");

after(() => {
  resetDb();
  rmSync(dir, { recursive: true, force: true });
});

function freshProvider() {
  const db = getDb();
  db.prepare("DELETE FROM connections").run();
  db.prepare("DELETE FROM providers").run();
  upsertProvider({
    id: "openai",
    name: "OpenAI",
    kind: "apikey",
    baseUrl: "https://api.openai.com/v1",
    wireFormat: "openai",
    enabled: true,
  });
}

test("parseQuotaThresholds tolerates garbage", () => {
  assert.deepEqual(parseQuotaThresholds(null), {});
  assert.deepEqual(parseQuotaThresholds("{not json"), {});
  assert.deepEqual(parseQuotaThresholds(JSON.stringify({ requests: 5 })), { requests: 5 });
});

test("isOverQuota: no thresholds ⇒ never blocked", () => {
  freshProvider();
  const id = createConnection("openai", "a", "sk-a");
  const conn = listConnections("openai").find((c) => c.id === id)!;
  assert.equal(isOverQuota(conn, Date.now()), false);
});

test("isOverQuota: request threshold blocks once window is exhausted", () => {
  freshProvider();
  const id = createConnection("openai", "a", "sk-a");
  updateConnection(id, { quotaWindowThresholds: JSON.stringify({ requests: 2, windowMs: 60000 }) });
  const conn = listConnections("openai").find((c) => c.id === id)!;
  const now = Date.now();
  assert.equal(isOverQuota(conn, now), false);
  recordUsage(id, 2, 0, now);
  assert.equal(isOverQuota(conn, now), true);
});

test("eligibleConnections skips an over-quota connection and keeps healthy ones", () => {
  freshProvider();
  const healthy = createConnection("openai", "healthy", "sk-1");
  const limited = createConnection("openai", "limited", "sk-2");
  updateConnection(limited, {
    quotaWindowThresholds: JSON.stringify({ requests: 1, windowMs: 60000 }),
  });
  recordUsage(limited, 1, 0, Date.now());
  const eligible = eligibleConnections(listConnections("openai"), Date.now(), isOverQuota);
  assert.deepEqual(
    eligible.map((c) => c.id),
    [healthy]
  );
});

test("recordUsage accumulates within the same window bucket", () => {
  freshProvider();
  const id = createConnection("openai", "a", "sk-a");
  const now = Date.now();
  recordUsage(id, 1, 10, now);
  recordUsage(id, 1, 5, now);
  const w = getWindow(id, now - (now % 60000))!;
  assert.equal(w.requests, 2);
  assert.equal(w.tokens, 15);
});

test("recordUsage isolates buckets by window start", () => {
  freshProvider();
  const id = createConnection("openai", "a", "sk-a");
  const now = 61_000; // window start 60_000
  const later = 121_000; // window start 120_000
  recordUsage(id, 1, 0, now);
  recordUsage(id, 1, 0, later);
  assert.equal(getWindow(id, 60_000)!.requests, 1);
  assert.equal(getWindow(id, 120_000)!.requests, 1);
});

test("recordUsage respects a non-60s configured window (windowMs = 3_600_000)", () => {
  freshProvider();
  const id = createConnection("openai", "a", "sk-a");
  updateConnection(id, {
    quotaWindowThresholds: JSON.stringify({ requests: 100, windowMs: 3_600_000 }),
  });
  // Anchor both requests inside the same 1h bucket, but >60s apart so the default
  // 60s window would have split them — proving the configured 1h windowMs is honored.
  const start = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const t1 = start + 1_000;
  const t2 = start + 120_000;
  recordUsage(id, 1, 0, t1, 3_600_000);
  recordUsage(id, 1, 0, t2, 3_600_000);
  const w = getWindow(id, start)!;
  assert.equal(w.requests, 2, "both requests share the 1h bucket");
});

test("isOverQuota trips a non-60s window because recordUsage and read agree on windowMs", () => {
  freshProvider();
  const id = createConnection("openai", "a", "sk-a");
  updateConnection(id, {
    quotaWindowThresholds: JSON.stringify({ requests: 1, windowMs: 3_600_000 }),
  });
  const conn = listConnections("openai").find((c) => c.id === id)!;
  const now = Date.now();
  assert.equal(isOverQuota(conn, now), false);
  recordUsage(id, 1, 0, now, 3_600_000);
  assert.equal(isOverQuota(conn, now), true);
});

test("parseQuotaThresholds clamps a zero/negative/NaN windowMs to default", () => {
  const zero = parseQuotaThresholds(JSON.stringify({ requests: 5, windowMs: 0 }));
  assert.equal(zero.windowMs, undefined);
  const neg = parseQuotaThresholds(JSON.stringify({ windowMs: -1000 }));
  assert.equal(neg.windowMs, undefined);
  const nan = parseQuotaThresholds(JSON.stringify({ windowMs: "nope" }));
  assert.equal(nan.windowMs, undefined);
  const ok = parseQuotaThresholds(JSON.stringify({ windowMs: 3600000 }));
  assert.equal(ok.windowMs, 3600000);
});

test("pruneQuotaWindows deletes buckets older than the cutoff", () => {
  freshProvider();
  const id = createConnection("openai", "a", "sk-a");
  // now=1000 → default 60s bucket start 0; now=2_000_000 → bucket start 1_980_000.
  const oldStart = 0;
  const recentStart = 1_980_000;
  recordUsage(id, 1, 0, 1000);
  recordUsage(id, 1, 0, 2_000_000);
  assert.equal(getWindow(id, oldStart)?.requests, 1);
  assert.equal(getWindow(id, recentStart)?.requests, 1);
  const removed = pruneQuotaWindows(1_000_000);
  assert.equal(removed, 1);
  assert.equal(getWindow(id, oldStart), null);
  assert.equal(getWindow(id, recentStart)?.requests, 1);
});
