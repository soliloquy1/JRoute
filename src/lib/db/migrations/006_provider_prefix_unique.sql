-- Enforce prefix uniqueness at the DB level. The app-side check in
-- upsertProvider() (prefixOwner) is check-then-insert and not atomic under
-- concurrent writers; this index is the actual guarantee. Empty prefix is
-- excluded so any number of legacy (unprefixed) providers can coexist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_model_prefix_unique
  ON providers(model_prefix)
  WHERE model_prefix != '';
