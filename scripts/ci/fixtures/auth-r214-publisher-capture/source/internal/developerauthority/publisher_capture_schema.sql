-- Explicit operator migration, never executed by an Auth constructor.
-- This journal stores verified observations only. Catalog remains the sole
-- publisher/ACL activation writer; a row here is NOT a protected registration.
CREATE TABLE public.auth_ide_publisher_capture_schema (
 singleton integer PRIMARY KEY CHECK(singleton=1),
 revision integer NOT NULL CHECK(revision=1)
);
INSERT INTO public.auth_ide_publisher_capture_schema VALUES(1,1);
CREATE TABLE public.auth_ide_publisher_captures (
 source_id text NOT NULL, instance_id text NOT NULL,
 profile_sha256 text NOT NULL, capture_head text NOT NULL,
 registration_ref text NOT NULL, execution_id text NOT NULL,
 registration_nonce text NOT NULL,
 principal_sha256 text NOT NULL, command_sha256 text NOT NULL,
 public_sha256 text NOT NULL, proof_sha256 text NOT NULL,
 grant_expires_ms bigint NOT NULL CHECK(grant_expires_ms>0),
 observation_expires_ms bigint NOT NULL CHECK(observation_expires_ms>0),
 captured_ms bigint NOT NULL CHECK(captured_ms>0),
 capture_state text NOT NULL DEFAULT 'captured' CHECK(capture_state IN ('captured','revoked')),
 capture_revision bigint NOT NULL DEFAULT 1 CHECK(capture_revision>=1),
 principal_original bytea NOT NULL, command_original bytea NOT NULL,
 public_original bytea NOT NULL, proof_original bytea NOT NULL,
 verified_original bytea NOT NULL, source_before bytea NOT NULL, source_after bytea NOT NULL,
 PRIMARY KEY(source_id,instance_id,registration_ref),
 UNIQUE(source_id,instance_id,registration_nonce),
 UNIQUE(source_id,instance_id,execution_id),
 CHECK(octet_length(principal_original) BETWEEN 1 AND 16384),
 CHECK(octet_length(command_original) BETWEEN 1 AND 16384),
 CHECK(octet_length(public_original) BETWEEN 1 AND 8192),
 CHECK(octet_length(proof_original) BETWEEN 1 AND 786432),
 CHECK(octet_length(verified_original) BETWEEN 1 AND 1048576),
 CHECK(octet_length(source_before) BETWEEN 1 AND 1048576),
 CHECK(octet_length(source_after) BETWEEN 1 AND 1048576)
);
