-- src/lib/db/migrations/012_deleted_catalog_providers.sql
-- Housekeeping fix: seedCatalogProviders() runs on every process boot (not just the
-- first) and uses INSERT OR IGNORE, so a catalog provider the operator explicitly
-- deleted silently resurrects on the next restart. Track deletions here and have
-- seedCatalogProviders() skip any id present in this table.
CREATE TABLE IF NOT EXISTS deleted_catalog_provider_ids (
  provider_id TEXT PRIMARY KEY
);
