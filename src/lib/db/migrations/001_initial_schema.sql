CREATE TABLE IF NOT EXISTS providers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('apikey','oauth')),
  base_url     TEXT NOT NULL,
  wire_format  TEXT NOT NULL CHECK (wire_format IN ('openai','anthropic','gemini')),
  enabled      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS connections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id     TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  api_key         TEXT,
  priority        INTEGER NOT NULL DEFAULT 100,
  cooldown_until  INTEGER,
  last_error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_connections_provider ON connections(provider_id, priority);

CREATE TABLE IF NOT EXISTS api_keys (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash           TEXT NOT NULL UNIQUE,
  label              TEXT NOT NULL,
  preset_id          INTEGER,
  tool_mode          TEXT NOT NULL DEFAULT 'off' CHECK (tool_mode IN ('native','trigger','off')),
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  created_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  must_change   INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS usage_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id    INTEGER,
  provider_id   TEXT,
  connection_id INTEGER,
  model         TEXT,
  prompt_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms    INTEGER,
  tool_rounds   INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at);
