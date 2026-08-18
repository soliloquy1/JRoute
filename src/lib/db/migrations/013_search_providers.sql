-- src/lib/db/migrations/013_search_providers.sql

CREATE TABLE search_providers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('brave', 'serpapi', 'google_cse')),
  label       TEXT NOT NULL,
  api_key     TEXT NOT NULL,
  config_json TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

-- The mcp_servers.transport CHECK currently only admits http/sse/stdio. The new
-- in-process 'builtin' transport must be allowed there too. SQLite cannot ALTER a
-- column CHECK in place, so recreate the table preserving every existing row.
ALTER TABLE mcp_servers RENAME TO mcp_servers_old;

CREATE TABLE mcp_servers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  transport       TEXT NOT NULL CHECK (transport IN ('http', 'sse', 'stdio', 'builtin')),
  target          TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  tool_allowlist  TEXT,
  confirmed_at    INTEGER,
  trigger_pattern TEXT
);

INSERT INTO mcp_servers (id, name, transport, target, enabled, tool_allowlist, confirmed_at, trigger_pattern)
  SELECT id, name, transport, target, enabled, tool_allowlist, confirmed_at, trigger_pattern
  FROM mcp_servers_old;

DROP TABLE mcp_servers_old;

-- Seed the first-party web search server, disabled until an operator opts in.
INSERT INTO mcp_servers (name, transport, target, enabled, tool_allowlist, trigger_pattern)
VALUES ('JRoute Web Search', 'builtin', '', 0, 'web_search,web_fetch', NULL);
