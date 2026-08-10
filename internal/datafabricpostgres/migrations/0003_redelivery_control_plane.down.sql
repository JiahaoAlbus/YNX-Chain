DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ynx_fabric.redelivery_runs) THEN
        RAISE EXCEPTION 'cannot roll back redelivery control plane while audit history exists';
    END IF;
END;
$$;

DROP TRIGGER redelivery_run_events_append_only ON ynx_fabric.redelivery_run_events;
DROP TRIGGER redelivery_runs_append_only ON ynx_fabric.redelivery_runs;
DROP FUNCTION ynx_fabric.reject_redelivery_mutation();
DROP TABLE ynx_fabric.redelivery_run_events;
DROP TABLE ynx_fabric.redelivery_runs;
ALTER TABLE ynx_fabric.dead_letters DROP CONSTRAINT dead_letters_requeue_audit_check;
