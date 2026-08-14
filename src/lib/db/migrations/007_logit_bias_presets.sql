-- src/lib/db/migrations/007_logit_bias_presets.sql
CREATE TABLE IF NOT EXISTS logit_bias_presets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  entries    TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

ALTER TABLE api_keys ADD COLUMN logit_bias_preset_id INTEGER
  REFERENCES logit_bias_presets(id) ON DELETE SET NULL;
