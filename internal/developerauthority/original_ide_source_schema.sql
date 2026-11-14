-- Explicit protected Auth migration; never executed by the constructor.
-- Root owns role grants/capture commissioning. HTTP, Catalog and publication
-- executor roles MUST NOT insert/replace Source originals or initial heads.
CREATE TABLE public.auth_ide_original_source_schema(singleton integer PRIMARY KEY CHECK(singleton=1),revision integer NOT NULL CHECK(revision=1));
INSERT INTO public.auth_ide_original_source_schema VALUES(1,1);
CREATE TABLE public.auth_ide_original_source_records(
 source_id text NOT NULL,instance_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('catalog','project','control','artifact','resource')),
 subject text NOT NULL,binding text NOT NULL,original bytea NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(source_id,instance_id,kind,subject,binding),
 CHECK(octet_length(original)>0 AND octet_length(original)<=1572864)
);
CREATE TABLE public.auth_ide_original_source_heads(
 source_id text NOT NULL,instance_id text NOT NULL,profile_sha256 text NOT NULL CHECK(profile_sha256 ~ '^[a-f0-9]{64}$'),
 previous_original bytea NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(source_id,instance_id,profile_sha256),CHECK(octet_length(previous_original)>0 AND octet_length(previous_original)<=16384)
);
CREATE TABLE public.auth_ide_original_approval_heads(
 source_id text NOT NULL,instance_id text NOT NULL,kind text NOT NULL CHECK(kind IN ('artifact','resource')),approval_ref text NOT NULL,
 previous_original bytea NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(source_id,instance_id,kind,approval_ref),CHECK(octet_length(previous_original)>0 AND octet_length(previous_original)<=16384)
);
CREATE TABLE public.auth_ide_original_source_observations(
 source_id text NOT NULL,instance_id text NOT NULL,kind text NOT NULL CHECK(kind IN ('source','artifact','resource')),reference text NOT NULL,
 original bytea NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(source_id,instance_id,kind,reference,sha256),CHECK(octet_length(original)>0 AND octet_length(original)<=1048576)
);
REVOKE ALL ON public.auth_ide_original_source_schema,public.auth_ide_original_source_records,public.auth_ide_original_source_heads,public.auth_ide_original_approval_heads,public.auth_ide_original_source_observations FROM PUBLIC;
-- No default trust rows/zero watermarks. Root commissions actual pre-existing
-- Native captures and signed original history. The factory only SELECTs the
-- immutable originals and performs exact CAS on already commissioned heads.
