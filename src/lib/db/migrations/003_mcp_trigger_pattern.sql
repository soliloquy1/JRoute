-- src/lib/db/migrations/003_mcp_trigger_pattern.sql
ALTER TABLE mcp_servers ADD COLUMN trigger_pattern TEXT;
