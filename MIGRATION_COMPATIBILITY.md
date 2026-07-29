# Migration and Compatibility

Platform policy, truth records, secret metadata, artifact records, backup manifests, and release records are versioned. Readers must reject unknown major schema versions and preserve unknown additive fields when forwarding records.

Each migration requires forward and rollback transformations, a backup made before mutation, dry-run output, row/object counts, checksums where stable, old-client behavior, deprecation date, and an owner. Rollback is prohibited after an irreversible business event unless the migration plan explicitly reconciles that event.

Old clients may read a release only when required security semantics are unchanged. Authentication, mandate, signature, nonce, revocation, or authority changes require a fail-closed minimum-client gate. Data export and deletion workflows must state retention exceptions for security, legal, and audit records.

Service retirement requires advance communication, export availability, revocation of service identities, artifact and endpoint disposition, backup retention decision, and a user exit path. Restart persistence is not restore evidence.
