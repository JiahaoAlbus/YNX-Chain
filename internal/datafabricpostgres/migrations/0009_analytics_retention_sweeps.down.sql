DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ynx_analytics.retention_sweeps) THEN
        RAISE EXCEPTION 'cannot roll back analytics retention sweeps while audit history exists';
    END IF;
END;
$$;

DROP TABLE ynx_analytics.retention_sweeps;
