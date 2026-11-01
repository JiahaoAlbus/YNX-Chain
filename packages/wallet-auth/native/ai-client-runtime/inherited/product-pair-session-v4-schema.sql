-- Private Auth service storage, NOT an authority/grant or public SQL endpoint.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS issuer_v4_meta (
 namespace TEXT PRIMARY KEY, schema_version INTEGER NOT NULL CHECK(schema_version=4),
 clock_floor_ms INTEGER NOT NULL CHECK(clock_floor_ms>=0)
) STRICT;
CREATE TABLE IF NOT EXISTS issuer_v4_operations (
 namespace TEXT NOT NULL, operation_id TEXT NOT NULL, actor_digest TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('PAIR','CHALLENGE','COMPLETE','REVOKE','CANCEL')),
 input_sha256 TEXT NOT NULL, input_original TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN('ENTERED','COMMITTED','CANCELLED','UNKNOWN')),
 result_original TEXT, created_ms INTEGER NOT NULL, terminal_ms INTEGER,
 PRIMARY KEY(namespace,operation_id),
 CHECK(length(operation_id)=64 AND length(actor_digest)=64 AND length(input_sha256)=64),
 CHECK(length(input_original)>0 AND length(input_original)<=393216),
 CHECK((phase='COMMITTED' AND result_original IS NOT NULL) OR phase<>'COMMITTED'),
 FOREIGN KEY(namespace) REFERENCES issuer_v4_meta(namespace)
) STRICT;
CREATE TABLE IF NOT EXISTS issuer_v4_pairs (
 namespace TEXT NOT NULL, registration_id TEXT NOT NULL, actor_digest TEXT NOT NULL,
 registration_digest TEXT NOT NULL, original TEXT NOT NULL,
 expires_ms INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN('ACTIVE','REVOKED')),
 PRIMARY KEY(namespace,registration_id), UNIQUE(namespace,registration_digest),
 FOREIGN KEY(namespace) REFERENCES issuer_v4_meta(namespace)
) STRICT;
CREATE TABLE IF NOT EXISTS issuer_v4_challenges (
 namespace TEXT NOT NULL, challenge_id TEXT NOT NULL, actor_digest TEXT NOT NULL,
 request_digest TEXT NOT NULL, nonce TEXT NOT NULL, state TEXT NOT NULL,
 registration_id TEXT NOT NULL, original TEXT NOT NULL,
 expires_ms INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN('ISSUED','CONSUMED','CANCELLED')),
 PRIMARY KEY(namespace,challenge_id), UNIQUE(namespace,request_digest),
 UNIQUE(namespace,nonce), UNIQUE(namespace,state),
 FOREIGN KEY(namespace,registration_id) REFERENCES issuer_v4_pairs(namespace,registration_id)
) STRICT;
CREATE TABLE IF NOT EXISTS issuer_v4_sessions (
 namespace TEXT NOT NULL, session_binding TEXT NOT NULL, actor_digest TEXT NOT NULL,
 registration_id TEXT NOT NULL, challenge_id TEXT NOT NULL, original TEXT NOT NULL,
 expires_ms INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN('ACTIVE','REVOKED')),
 PRIMARY KEY(namespace,session_binding), UNIQUE(namespace,challenge_id),
 FOREIGN KEY(namespace,registration_id) REFERENCES issuer_v4_pairs(namespace,registration_id),
 FOREIGN KEY(namespace,challenge_id) REFERENCES issuer_v4_challenges(namespace,challenge_id)
) STRICT;
CREATE TABLE IF NOT EXISTS issuer_v4_http_nonces (
 namespace TEXT NOT NULL, replay_key TEXT NOT NULL, actor_digest TEXT NOT NULL,
 session_binding TEXT NOT NULL, expires_ms INTEGER NOT NULL,
 PRIMARY KEY(namespace,replay_key),
 FOREIGN KEY(namespace,session_binding) REFERENCES issuer_v4_sessions(namespace,session_binding)
) STRICT;
CREATE TABLE IF NOT EXISTS issuer_v4_audit (
 sequence INTEGER PRIMARY KEY, namespace TEXT NOT NULL, operation_id TEXT NOT NULL,
 actor_digest TEXT NOT NULL, kind TEXT NOT NULL, result_sha256 TEXT NOT NULL,
 at_ms INTEGER NOT NULL,
 FOREIGN KEY(namespace,operation_id) REFERENCES issuer_v4_operations(namespace,operation_id)
) STRICT;
PRAGMA user_version=4;
