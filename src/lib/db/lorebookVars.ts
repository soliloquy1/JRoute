// src/lib/db/lorebookVars.ts
import { getDb } from "./bootstrap.ts";

interface LorebookVarRow {
  value: string | null;
}

export function getLorebookVar(
  lorebookId: number,
  scopeKey: string,
  varKey: string
): string | null {
  const row = getDb()
    .prepare(
      "SELECT value FROM lorebook_vars WHERE lorebook_id = ? AND scope_key = ? AND var_key = ?"
    )
    .get(lorebookId, scopeKey, varKey) as LorebookVarRow | undefined;
  return row ? row.value : null;
}

/**
 * Per-key upsert under an IMMEDIATE transaction (spec §7.3) — takes the write
 * lock up front so a concurrent writer sees SQLITE_BUSY (retried by
 * busy_timeout) rather than SQLITE_BUSY_SNAPSHOT (which busy_timeout does not
 * retry, per the design spec's correction of a DEFERRED-transaction claim).
 * `db.transaction(fn)` returns a callable carrying `.immediate`/`.deferred`/
 * `.exclusive` variants (real better-sqlite3 shape) — NOT a bare
 * `db.immediate(fn)`, which does not exist.
 */
export function setLorebookVar(
  lorebookId: number,
  scopeKey: string,
  varKey: string,
  value: string,
  now: number = Date.now()
): void {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO lorebook_vars (lorebook_id, scope_key, var_key, value, last_used_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (lorebook_id, scope_key, var_key) DO UPDATE SET
         value = excluded.value,
         last_used_at = excluded.last_used_at`
    ).run(lorebookId, scopeKey, varKey, value, now);
  });
  run.immediate();
}

export function listLorebookVars(lorebookId: number, scopeKey: string): Record<string, string> {
  const rows = getDb()
    .prepare("SELECT var_key, value FROM lorebook_vars WHERE lorebook_id = ? AND scope_key = ?")
    .all(lorebookId, scopeKey) as Array<{ var_key: string; value: string | null }>;
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (row.value !== null) out[row.var_key] = row.value;
  }
  return out;
}

export function sweepStaleLorebookVars(olderThanMs: number): number {
  const info = getDb().prepare("DELETE FROM lorebook_vars WHERE last_used_at < ?").run(olderThanMs);
  return info.changes;
}
