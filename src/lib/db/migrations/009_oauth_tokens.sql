-- src/lib/db/migrations/009_oauth_tokens.sql
-- Encrypted OAuth tokens, keyed by (provider, connection_id). Values are stored
-- ciphertext via the existing enc:v1: helper (src/lib/db/encryption.ts) — this
-- migration only defines the schema; writers encrypt before persisting.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  provider      TEXT    NOT NULL,
  connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    INTEGER,
  PRIMARY KEY (provider, connection_id)
);

-- Extend the pre-existing usage_logs (created in 001) with analytics/quota fields.
-- Do NOT recreate the table; it already carries api_key_id/provider_id/connection_id/
-- model/prompt_tokens/output_tokens/latency_ms/tool_rounds/error/created_at.
ALTER TABLE usage_logs ADD COLUMN status TEXT;
ALTER TABLE usage_logs ADD COLUMN cost_us REAL;
ALTER TABLE usage_logs ADD COLUMN request_id TEXT;
