-- Owner-supplied migration; NEVER executed by the runtime constructor.
-- Existing Catalog remains the only ACL/publisher/control-operation writer.
CREATE TABLE public.auth_ide_control_capture_schema (
  singleton integer PRIMARY KEY CHECK (singleton=1),
  revision integer NOT NULL CHECK (revision=1)
);
INSERT INTO public.auth_ide_control_capture_schema VALUES (1,1);
CREATE TABLE public.auth_ide_control_source_heads (
  source_id text NOT NULL, instance_id text NOT NULL,
  profile_sha256 text NOT NULL,
  generation bigint NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
  sequence bigint NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),
  floor bigint NOT NULL CHECK(floor BETWEEN 0 AND sequence),
  capture_head text NOT NULL,
  PRIMARY KEY(source_id,instance_id)
);
CREATE TABLE public.auth_ide_control_captures (
  source_id text NOT NULL, instance_id text NOT NULL,
  profile_sha256 text NOT NULL, capture_head text NOT NULL,
  principal_sha256 text NOT NULL, command_sha256 text NOT NULL,
  proof_sha256 text NOT NULL, confirmation_ref text NOT NULL UNIQUE,
  revocation_ref text NOT NULL, decision text NOT NULL CHECK(decision IN ('approve','reject')),
  expires_ms bigint NOT NULL CHECK(expires_ms>0),
  principal_original bytea NOT NULL, command_original bytea NOT NULL,
  proof_original bytea NOT NULL, verified_original bytea NOT NULL,
  PRIMARY KEY(source_id,instance_id,capture_head),
  UNIQUE(source_id,instance_id,proof_sha256),
  CHECK(octet_length(principal_original) BETWEEN 1 AND 16384),
  CHECK(octet_length(command_original) BETWEEN 1 AND 16384),
  CHECK(octet_length(proof_original) BETWEEN 1 AND 393216),
  CHECK(octet_length(verified_original) BETWEEN 1 AND 2097152)
);
