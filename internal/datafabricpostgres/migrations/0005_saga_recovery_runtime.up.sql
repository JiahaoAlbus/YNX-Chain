ALTER TABLE ynx_fabric.sagas
    ADD COLUMN recovery_task_id text,
    ADD COLUMN recovery_lease_owner text,
    ADD COLUMN recovery_acquired_at timestamptz,
    ADD COLUMN recovery_lease_until timestamptz,
    ADD COLUMN recovery_attempt integer NOT NULL DEFAULT 0 CHECK (recovery_attempt >= 0),
    ADD CONSTRAINT saga_recovery_lease_complete CHECK (
        (recovery_task_id IS NULL) = (recovery_lease_owner IS NULL)
        AND (recovery_task_id IS NULL) = (recovery_acquired_at IS NULL)
        AND (recovery_task_id IS NULL) = (recovery_lease_until IS NULL)
    ),
    ADD CONSTRAINT saga_recovery_lease_status CHECK (
        recovery_task_id IS NULL OR status = 'compensating'
    ),
    ADD CONSTRAINT saga_recovery_lease_time CHECK (
        recovery_lease_until IS NULL OR recovery_lease_until > recovery_acquired_at
    );

CREATE INDEX sagas_recovery_claim_idx
ON ynx_fabric.sagas (product, deadline, saga_id)
WHERE status = 'compensating';

CREATE UNIQUE INDEX sagas_recovery_task_id_unique
ON ynx_fabric.sagas (recovery_task_id)
WHERE recovery_task_id IS NOT NULL;
