-- src/lib/db/migrations/004_rich_presets.sql
CREATE TABLE IF NOT EXISTS rich_presets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  raw_json   TEXT NOT NULL,
  char_name  TEXT NOT NULL DEFAULT '',
  user_name  TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rich_preset_lorebooks (
  rich_preset_id INTEGER NOT NULL REFERENCES rich_presets(id) ON DELETE CASCADE,
  lorebook_id    INTEGER NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  PRIMARY KEY (rich_preset_id, lorebook_id)
);

ALTER TABLE api_keys ADD COLUMN rich_preset_id INTEGER REFERENCES rich_presets(id) ON DELETE SET NULL;
