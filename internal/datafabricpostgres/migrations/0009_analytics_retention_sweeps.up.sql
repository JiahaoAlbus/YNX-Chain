-- Retention sweeps are permitted to remove only payload-free derived Analytics
-- facts classified transient or operational. The immutable audit row contains
-- no event, account, pseudonym, payload, or authoritative-record identity.
CREATE TABLE ynx_analytics.retention_sweeps (
    audit_id text PRIMARY KEY,
    executed_at timestamptz NOT NULL,
    transient_before timestamptz NOT NULL,
    operational_before timestamptz NOT NULL,
    transient_deleted bigint NOT NULL CHECK (transient_deleted >= 0),
    operational_deleted bigint NOT NULL CHECK (operational_deleted >= 0),
    CHECK (transient_before <= executed_at AND operational_before <= executed_at)
);

CREATE TRIGGER analytics_retention_sweeps_append_only
BEFORE UPDATE OR DELETE ON ynx_analytics.retention_sweeps
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_mutation();
