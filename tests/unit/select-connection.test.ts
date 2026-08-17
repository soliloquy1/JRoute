import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleConnections } from "../../jroute/selectConnection.ts";
import type { Connection } from "../../src/lib/db/types.ts";

const conn = (id: number, priority: number, cooldownUntil: number | null): Connection => ({
  id,
  providerId: "openai",
  label: `c${id}`,
  apiKey: "k",
  priority,
  cooldownUntil,
  lastError: null,
  credentialDecryptFailed: false,
  enabled: true,
});

const NOW = 1_000_000;

// This module is DB-free (housekeeping: isOverQuota is injected, not imported from
// src/lib/db/ — mirrors executor.ts's injected tokenResolver, plan step 13). Quota
// behavior itself is covered by tests/unit/quota-routing.test.ts; here a stub that
// never blocks keeps these tests focused on cooldown/priority ordering.
const neverOverQuota = () => false;

test("returns connections in priority order", () => {
  const out = eligibleConnections([conn(1, 20, null), conn(2, 10, null)], NOW, neverOverQuota);
  assert.deepEqual(
    out.map((c) => c.id),
    [2, 1]
  );
});

test("skips connections still cooling down", () => {
  const out = eligibleConnections([conn(1, 10, NOW + 5000), conn(2, 20, null)], NOW, neverOverQuota);
  assert.deepEqual(
    out.map((c) => c.id),
    [2]
  );
});

test("an expired cooldown makes a connection eligible again", () => {
  const out = eligibleConnections([conn(1, 10, NOW - 1)], NOW, neverOverQuota);
  assert.deepEqual(
    out.map((c) => c.id),
    [1]
  );
});

test("returns empty when every connection is cooling down", () => {
  assert.deepEqual(eligibleConnections([conn(1, 10, NOW + 1)], NOW, neverOverQuota), []);
});

test("breaks priority ties by id for determinism", () => {
  const out = eligibleConnections([conn(3, 10, null), conn(1, 10, null)], NOW, neverOverQuota);
  assert.deepEqual(
    out.map((c) => c.id),
    [1, 3]
  );
});

test("excludes disabled connections regardless of cooldown state", () => {
  const conns: Connection[] = [
    { ...conn(1, 1, null), enabled: false },
    { ...conn(2, 2, null), enabled: true },
  ];
  const result = eligibleConnections(conns, NOW, neverOverQuota);
  assert.deepEqual(
    result.map((c) => c.id),
    [2]
  );
});

test("respects an injected isOverQuota predicate", () => {
  const alwaysOverQuota = () => true;
  const out = eligibleConnections([conn(1, 10, null), conn(2, 20, null)], NOW, alwaysOverQuota);
  assert.deepEqual(out, []);
});
