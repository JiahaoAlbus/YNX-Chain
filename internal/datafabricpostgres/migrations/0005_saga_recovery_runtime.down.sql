DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM ynx_fabric.sagas
        WHERE recovery_task_id IS NOT NULL OR recovery_attempt <> 0
    ) THEN
        RAISE EXCEPTION 'cannot roll back Saga recovery runtime while recovery audit history exists';
    END IF;
END;
$$;

DROP INDEX ynx_fabric.sagas_recovery_task_id_unique;
DROP INDEX ynx_fabric.sagas_recovery_claim_idx;

ALTER TABLE ynx_fabric.sagas
    DROP CONSTRAINT saga_recovery_lease_time,
    DROP CONSTRAINT saga_recovery_lease_status,
    DROP CONSTRAINT saga_recovery_lease_complete,
    DROP COLUMN recovery_attempt,
    DROP COLUMN recovery_lease_until,
    DROP COLUMN recovery_acquired_at,
    DROP COLUMN recovery_lease_owner,
    DROP COLUMN recovery_task_id;
