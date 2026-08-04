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
});

const NOW = 1_000_000;

test("returns connections in priority order", () => {
  const out = eligibleConnections([conn(1, 20, null), conn(2, 10, null)], NOW);
  assert.deepEqual(
    out.map((c) => c.id),
    [2, 1]
  );
});

test("skips connections still cooling down", () => {
  const out = eligibleConnections([conn(1, 10, NOW + 5000), conn(2, 20, null)], NOW);
  assert.deepEqual(
    out.map((c) => c.id),
    [2]
  );
});

test("an expired cooldown makes a connection eligible again", () => {
  const out = eligibleConnections([conn(1, 10, NOW - 1)], NOW);
  assert.deepEqual(
    out.map((c) => c.id),
    [1]
  );
});

test("returns empty when every connection is cooling down", () => {
  assert.deepEqual(eligibleConnections([conn(1, 10, NOW + 1)], NOW), []);
});

test("breaks priority ties by id for determinism", () => {
  const out = eligibleConnections([conn(3, 10, null), conn(1, 10, null)], NOW);
  assert.deepEqual(
    out.map((c) => c.id),
    [1, 3]
  );
});
