CREATE TABLE IF NOT EXISTS regex_presets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  scripts    TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

ALTER TABLE api_keys ADD COLUMN regex_preset_id INTEGER
  REFERENCES regex_presets(id) ON DELETE SET NULL;
