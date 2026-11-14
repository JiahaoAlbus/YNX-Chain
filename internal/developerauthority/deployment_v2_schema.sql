-- Auth owner migration supplier ONLY. Not startup DDL; do not execute merely
-- because code was installed. Existing Root/provisioning DB role owns intake.
BEGIN;
ALTER TABLE public.auth_ide_original_source_records DROP CONSTRAINT auth_ide_original_source_records_kind_check;
ALTER TABLE public.auth_ide_original_source_records ADD CONSTRAINT auth_ide_original_source_records_kind_check CHECK(kind IN ('catalog','project','control','artifact','resource','deployment-v2','deployment-v2-read'));
UPDATE public.auth_ide_original_source_schema SET revision=2 WHERE singleton=1 AND revision=1;
CREATE TABLE public.auth_ide_deployment_v2_registered_currents (
 source_id text NOT NULL,instance_id text NOT NULL,kind text NOT NULL CHECK(kind IN ('publisher','issuer','project','resource')),
 full_ref_sha256 text NOT NULL CHECK(full_ref_sha256 ~ '^[a-f0-9]{64}$'),current_reference text NOT NULL,
 original bytea NOT NULL CHECK(octet_length(original)>0 AND octet_length(original)<=32768),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(source_id,instance_id,kind,full_ref_sha256)
);
CREATE TABLE public.auth_ide_deployment_v2_handoffs (
 source_id text NOT NULL,instance_id text NOT NULL,request_id text NOT NULL,
 scope_sha256 text NOT NULL CHECK(scope_sha256 ~ '^[a-f0-9]{64}$'),member_sha256 text NOT NULL CHECK(member_sha256 ~ '^[a-f0-9]{64}$'),
 phase text NOT NULL CHECK(phase IN ('entered','terminal')),original bytea,original_sha256 text,
 PRIMARY KEY(source_id,instance_id,request_id),CHECK(phase='entered' OR (octet_length(original)>0 AND original_sha256 ~ '^[a-f0-9]{64}$'))
);
COMMIT;
