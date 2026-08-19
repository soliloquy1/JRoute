-- src/lib/db/migrations/016_tavily_search_provider.sql

-- The search_providers.kind CHECK currently only admits brave/serpapi/google_cse. SQLite
-- cannot ALTER a column CHECK in place, so recreate the table preserving every existing row
-- (same pattern 013_search_providers.sql already used for mcp_servers.transport).
ALTER TABLE search_providers RENAME TO search_providers_old;

CREATE TABLE search_providers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('brave', 'serpapi', 'google_cse', 'tavily')),
  label       TEXT NOT NULL,
  api_key     TEXT NOT NULL,
  config_json TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

INSERT INTO search_providers (id, kind, label, api_key, config_json, created_at)
  SELECT id, kind, label, api_key, config_json, created_at
  FROM search_providers_old;

DROP TABLE search_providers_old;
