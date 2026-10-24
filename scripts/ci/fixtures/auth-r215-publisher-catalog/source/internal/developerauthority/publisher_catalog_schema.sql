-- Explicit unapplied migration. Publisher activation/revoke is committed only
-- in the original Catalog serializable ACL transaction, never by capture IO.
CREATE TABLE public.auth_ide_publisher_catalog_schema (
 singleton integer PRIMARY KEY CHECK(singleton=1),
 revision integer NOT NULL CHECK(revision=1)
);
INSERT INTO public.auth_ide_publisher_catalog_schema VALUES(1,1);
CREATE TABLE public.auth_ide_publisher_catalog_bindings (
 project_id text NOT NULL, publisher_id text NOT NULL,
 account text NOT NULL, public_sha256 text NOT NULL, registration_ref text NOT NULL,
 publisher_revision bigint NOT NULL CHECK(publisher_revision>=1),
 source_id text NOT NULL, instance_id text NOT NULL,
 profile_sha256 text NOT NULL, capture_head text NOT NULL,
 capture_execution_id text NOT NULL, grant_expires_ms bigint NOT NULL,
 binding_state text NOT NULL CHECK(binding_state IN ('active','revoked')),
 registry_revision bigint NOT NULL CHECK(registry_revision>=1),
 PRIMARY KEY(project_id,publisher_id),
 UNIQUE(source_id,instance_id,capture_execution_id)
);
