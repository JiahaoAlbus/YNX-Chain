BEGIN;

CREATE TABLE IF NOT EXISTS ynx_exchange_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  schema_version INTEGER NOT NULL,
  integrity_hash CHAR(64) NOT NULL CHECK (integrity_hash ~ '^[0-9a-f]{64}$'),
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
