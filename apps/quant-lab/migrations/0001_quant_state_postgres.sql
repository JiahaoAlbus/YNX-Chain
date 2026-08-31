-- Quant Lab PostgreSQL state backend.
-- One row per stable StateNamespace (including tenant-derived namespaces).
-- revision is an optimistic concurrency fence; payload integrity is checked by
-- the service before load and after every write.
CREATE TABLE IF NOT EXISTS ynx_quant_state (
  state_key TEXT PRIMARY KEY,
  revision BIGINT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
