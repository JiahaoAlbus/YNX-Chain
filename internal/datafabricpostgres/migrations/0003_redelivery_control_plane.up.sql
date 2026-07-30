ALTER TABLE ynx_fabric.dead_letters
    ADD CONSTRAINT dead_letters_requeue_audit_check
    CHECK ((requeued_at IS NULL AND requeue_audit_id IS NULL) OR (requeued_at IS NOT NULL AND length(requeue_audit_id) > 0));

CREATE TABLE ynx_fabric.redelivery_runs (
    run_id text PRIMARY KEY,
    request_id text NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    mode text NOT NULL CHECK (mode IN ('replay', 'backfill')),
    product text NOT NULL,
    scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
    preview_hash char(64) NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
    reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 512),
    approval_id text NOT NULL,
    approval_status text NOT NULL CHECK (approval_status = 'approved'),
    confirmed boolean NOT NULL CHECK (confirmed),
    audit_id text NOT NULL,
    requested_by text NOT NULL,
    control_version text NOT NULL CHECK (control_version = '1.0'),
    source_commit char(40) NOT NULL CHECK (source_commit ~ '^[0-9a-f]{40}$'),
    source_release text NOT NULL CHECK (length(source_release) > 0),
    status text NOT NULL CHECK (status = 'completed'),
    candidate_count integer NOT NULL CHECK (candidate_count >= 0),
    enqueued_count integer NOT NULL CHECK (enqueued_count >= 0),
    skipped_pending integer NOT NULL CHECK (skipped_pending >= 0),
    started_at timestamptz NOT NULL,
    completed_at timestamptz NOT NULL CHECK (completed_at >= started_at),
    CHECK (candidate_count = enqueued_count + skipped_pending)
);

CREATE TABLE ynx_fabric.redelivery_run_events (
    run_id text NOT NULL REFERENCES ynx_fabric.redelivery_runs(run_id),
    event_id text NOT NULL REFERENCES ynx_fabric.events(event_id),
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    action text NOT NULL CHECK (action IN ('enqueued', 'skipped-pending')),
    PRIMARY KEY (run_id, event_id),
    UNIQUE (run_id, ordinal)
);

CREATE INDEX redelivery_runs_product_completed_idx
    ON ynx_fabric.redelivery_runs(product, completed_at DESC);

CREATE OR REPLACE FUNCTION ynx_fabric.reject_redelivery_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'redelivery audit history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER redelivery_runs_append_only
BEFORE UPDATE OR DELETE ON ynx_fabric.redelivery_runs
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_redelivery_mutation();

CREATE TRIGGER redelivery_run_events_append_only
BEFORE UPDATE OR DELETE ON ynx_fabric.redelivery_run_events
FOR EACH ROW EXECUTE FUNCTION ynx_fabric.reject_redelivery_mutation();
