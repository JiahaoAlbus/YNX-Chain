DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ynx_fabric.events WHERE schema_version = '2.0') THEN
        RAISE EXCEPTION 'cannot roll back event envelope v2 while v2 events exist';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM ynx_fabric.events
        GROUP BY product, service, aggregate_id, sequence
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'cannot roll back event envelope v2 because aggregate identities would collide';
    END IF;
END;
$$;

DROP INDEX ynx_fabric.events_aggregate_v2_idx;

ALTER TABLE ynx_fabric.aggregate_sequences
    DROP CONSTRAINT aggregate_sequences_pkey;
ALTER TABLE ynx_fabric.aggregate_sequences
    DROP COLUMN aggregate_type;
ALTER TABLE ynx_fabric.aggregate_sequences
    ADD CONSTRAINT aggregate_sequences_pkey
    PRIMARY KEY (product, service, aggregate_id);

ALTER TABLE ynx_fabric.events
    DROP CONSTRAINT events_product_service_aggregate_sequence_key;
ALTER TABLE ynx_fabric.events
    DROP COLUMN aggregate_type;
ALTER TABLE ynx_fabric.events
    ADD CONSTRAINT events_product_service_aggregate_id_sequence_key
    UNIQUE (product, service, aggregate_id, sequence);

ALTER TABLE ynx_fabric.events
    DROP CONSTRAINT events_schema_version_check;
ALTER TABLE ynx_fabric.events
    ADD CONSTRAINT events_schema_version_check
    CHECK (schema_version = '1.0');
