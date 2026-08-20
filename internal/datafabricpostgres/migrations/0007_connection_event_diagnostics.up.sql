-- Privacy-safe, fixed-cardinality aggregates for accepted Connection Events.
-- This table deliberately contains no event ID, account, connection pseudonym,
-- endpoint URL, client patch version, source payload, credential, or funding data.
CREATE TABLE ynx_fabric.connection_diagnostics (
    metric text NOT NULL CHECK (metric ~ '^[a-z][a-z0-9_]{2,95}$'),
    dimension text NOT NULL CHECK (dimension ~ '^[A-Za-z0-9._:-]{1,127}$'),
    count bigint NOT NULL CHECK (count >= 0),
    PRIMARY KEY (metric, dimension)
);
