-- Auth-owned catalog only. Existing account/device/session authority remains
-- the original Auth service. Explicit owner migration; never run at startup.
CREATE TABLE developer_catalog_current(singleton integer PRIMARY KEY CHECK(singleton=1),revision bigint NOT NULL CHECK(revision>0));
INSERT INTO developer_catalog_current(singleton,revision) VALUES(1,1);
CREATE TABLE developer_projects (
 id text PRIMARY KEY, owner_account text NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 revoked boolean NOT NULL DEFAULT false, runtime_origin text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX developer_runtime_origin_unique ON developer_projects(runtime_origin) WHERE runtime_origin<>'';
CREATE TABLE developer_teams (id text PRIMARY KEY, owner_account text NOT NULL, revision bigint NOT NULL CHECK(revision>0), revoked boolean NOT NULL DEFAULT false);
CREATE TABLE developer_team_members (
 team_id text NOT NULL REFERENCES developer_teams(id), account text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), expires_ms bigint NOT NULL, revoked boolean NOT NULL,
 PRIMARY KEY(team_id,account)
);
CREATE TABLE developer_project_members (
 project_id text NOT NULL REFERENCES developer_projects(id), account text NOT NULL,
 can_read boolean NOT NULL, can_publish boolean NOT NULL, can_runtime boolean NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), expires_ms bigint NOT NULL, revoked boolean NOT NULL,
 PRIMARY KEY(project_id,account)
);
CREATE TABLE developer_project_teams (
 project_id text NOT NULL REFERENCES developer_projects(id), team_id text NOT NULL REFERENCES developer_teams(id),
 can_read boolean NOT NULL, can_publish boolean NOT NULL, can_runtime boolean NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), expires_ms bigint NOT NULL, revoked boolean NOT NULL,
 PRIMARY KEY(project_id,team_id)
);
CREATE TABLE developer_publishers (
 project_id text NOT NULL REFERENCES developer_projects(id), publisher_id text NOT NULL,
 account text NOT NULL, key_role text NOT NULL CHECK(key_role='ide-artifact-publisher'),
 public_original bytea NOT NULL, public_sha256 text NOT NULL, registration_ref text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), expires_ms bigint NOT NULL, revoked boolean NOT NULL,
 PRIMARY KEY(project_id,publisher_id)
);
CREATE TABLE developer_control_operations (
 account text NOT NULL, request_id text NOT NULL, binding_sha256 text NOT NULL,
 proof_sha256 text NOT NULL, confirmation_ref text NOT NULL, revocation_ref text NOT NULL,
 principal_original bytea NOT NULL,command_original bytea NOT NULL,action text NOT NULL,
 object_id text NOT NULL, state text NOT NULL CHECK(state IN ('committed')),
 revision bigint NOT NULL CHECK(revision>0), expires_ms bigint NOT NULL,
 PRIMARY KEY(account,request_id)
);
CREATE TABLE developer_identity_recoveries (
 account text NOT NULL,request_id text NOT NULL,binding_sha256 text NOT NULL,
 request_original bytea NOT NULL,proof_sha256 text NOT NULL,
 confirmation_ref text NOT NULL,revocation_ref text NOT NULL,
 state text NOT NULL CHECK(state IN ('unknown','recovered')),
 result_original bytea,result_sha256 text,
 PRIMARY KEY(account,request_id)
);
