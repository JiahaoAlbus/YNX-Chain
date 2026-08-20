DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ynx_fabric.connection_diagnostics WHERE count > 0) THEN
        RAISE EXCEPTION 'cannot roll back connection diagnostics while aggregate evidence exists';
    END IF;
END;
$$;

DROP TABLE ynx_fabric.connection_diagnostics;
