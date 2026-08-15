-- src/lib/db/migrations/010_quota_usage.sql
-- Per-connection provider-specific bag + quota-window threshold config.
ALTER TABLE connections ADD COLUMN provider_specific_data TEXT;
ALTER TABLE connections ADD COLUMN quota_window_thresholds_json TEXT;

-- Rolling quota windows per connection. window_start is a truncated epoch (e.g. the
-- start of the current minute/day bucket). Selection in Phase 4 skips connections whose
-- accumulated `requests`/`tokens` in the active window exceed their thresholds.
CREATE TABLE IF NOT EXISTS quota_windows (
  connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  window_start  INTEGER NOT NULL,
  requests      INTEGER NOT NULL DEFAULT 0,
  tokens        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (connection_id, window_start)
);
CREATE INDEX IF NOT EXISTS idx_quota_windows_start ON quota_windows(window_start);
