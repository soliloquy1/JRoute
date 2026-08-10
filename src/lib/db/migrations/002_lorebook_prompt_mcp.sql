ALTER TABLE connections ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS prompt_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('prepend','append')),
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS presets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE,
  prepend_block_id INTEGER REFERENCES prompt_blocks(id) ON DELETE SET NULL,
  append_block_id  INTEGER REFERENCES prompt_blocks(id) ON DELETE SET NULL,
  tool_mode        TEXT NOT NULL DEFAULT 'off' CHECK (tool_mode IN ('native','trigger','off')),
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lorebooks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  source         TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  trigger_config TEXT,
  scope          TEXT NOT NULL DEFAULT 'character' CHECK (scope IN ('character','global')),
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS preset_lorebooks (
  preset_id   INTEGER NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
  lorebook_id INTEGER NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  PRIMARY KEY (preset_id, lorebook_id)
);

CREATE TABLE IF NOT EXISTS lorebook_vars (
  lorebook_id  INTEGER NOT NULL REFERENCES lorebooks(id) ON DELETE CASCADE,
  scope_key    TEXT NOT NULL,
  var_key      TEXT NOT NULL,
  value        TEXT,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (lorebook_id, scope_key, var_key)
);
CREATE INDEX IF NOT EXISTS idx_lorebook_vars_last_used ON lorebook_vars(last_used_at);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  transport      TEXT NOT NULL CHECK (transport IN ('http','sse','stdio')),
  target         TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  tool_allowlist TEXT,
  confirmed_at   INTEGER
);
