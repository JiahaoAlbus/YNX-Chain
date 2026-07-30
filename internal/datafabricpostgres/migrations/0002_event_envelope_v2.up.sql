ALTER TABLE ynx_fabric.events
    DROP CONSTRAINT events_schema_version_check;

ALTER TABLE ynx_fabric.events
    ADD CONSTRAINT events_schema_version_check
    CHECK (schema_version IN ('1.0', '2.0'));

ALTER TABLE ynx_fabric.events
    ADD COLUMN aggregate_type text NOT NULL DEFAULT '';

ALTER TABLE ynx_fabric.events
    DROP CONSTRAINT events_product_service_aggregate_id_sequence_key;

ALTER TABLE ynx_fabric.events
    ADD CONSTRAINT events_product_service_aggregate_sequence_key
    UNIQUE (product, service, aggregate_type, aggregate_id, sequence);

ALTER TABLE ynx_fabric.aggregate_sequences
    ADD COLUMN aggregate_type text NOT NULL DEFAULT '';

ALTER TABLE ynx_fabric.aggregate_sequences
    DROP CONSTRAINT aggregate_sequences_pkey;

ALTER TABLE ynx_fabric.aggregate_sequences
    ADD CONSTRAINT aggregate_sequences_pkey
    PRIMARY KEY (product, service, aggregate_type, aggregate_id);

CREATE INDEX events_aggregate_v2_idx
    ON ynx_fabric.events (product, service, aggregate_type, aggregate_id, sequence);
