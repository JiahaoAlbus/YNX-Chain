# Migration and compatibility

Registry v1 entries migrate deterministically to v2 P-256 bindings; central product registrations use schema v3 and remain disabled until approved. Store schema v1 requires exact nonce/request/challenge/session coverage and a valid audit hash chain. Unknown versions fail closed.

Old clients may complete only the exact accepted protocol version and registered tuple. Legacy bearer login, wildcard scope, old Social bundle/callback aliases and reordered scopes are rejected. During rollout, the Gateway must dual-read only explicitly versioned old records, write the current schema, expose deprecation metrics, and never silently widen old authorization.

Rollback restores the prior application binary and compatible read path, not old authorization semantics. New sessions issued after a schema cutover are revoked before rollback if the old verifier cannot enforce their fields. Backup/restore must preserve consumed replay domains, revoke sets, logout cutoffs and audit chain atomically. Export is versioned canonical JSON; deletion is tombstoned/audited according to retention policy. Service shutdown requires artifact/export availability, sponsor disablement, mandate revoke, capital exit guidance and user notice.

Current Gateway recovery verification at source `a5c99e4e26e150aa6cf4138f4ecf8ac6d1ea8b2f` accepts the legacy timestamped state envelope only after digest/schema validation, atomically rewrites it to the canonical state-schema-v1 envelope, then proves exact encrypted backup/restore and consumed-proof replay rejection. A state envelope advertising an unsupported future schema version is rejected with `STATE_TAMPERED`; no silent downgrade, field dropping or optimistic compatibility path exists.
