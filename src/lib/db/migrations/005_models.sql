-- Per-provider, operator-editable model catalog (replaces the static MODEL_MAP).
-- Each provider gets an optional model_prefix; a model is requested as
-- `prefix/nativeId` and routes only to that provider.

ALTER TABLE providers ADD COLUMN model_prefix TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS models (
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id    TEXT NOT NULL,
  max_tokens  INTEGER NOT NULL DEFAULT 8192,
  enabled     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (provider_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);
