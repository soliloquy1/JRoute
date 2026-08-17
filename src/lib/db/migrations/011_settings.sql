-- src/lib/db/migrations/011_settings.sql
-- Generic key/value settings store (Phase 4 step 21: a single global
-- fallback-strategy enum — priority | round-robin. No combo engine.)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Per-provider round-robin cursor: the last connection successfully dialed, so the
-- NEXT request rotates to a different one instead of always preferring the same
-- lowest-priority connection. Only consulted when the "round-robin" strategy is active.
CREATE TABLE IF NOT EXISTS provider_routing_state (
  provider_id        TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  last_connection_id INTEGER
);
