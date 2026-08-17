-- src/lib/db/migrations/008_provider_catalog.sql
-- Provider catalog extension: OAuth provider key + arbitrary provider-specific bag.
-- Reuses the existing `kind` column ("apikey"|"oauth") — no redundant auth_type added.
ALTER TABLE providers ADD COLUMN oauth_provider TEXT;
ALTER TABLE providers ADD COLUMN provider_specific_data TEXT;
