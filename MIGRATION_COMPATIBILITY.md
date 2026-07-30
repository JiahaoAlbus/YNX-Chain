# Migration and Compatibility

Platform policy, truth records, secret metadata, artifact records, backup manifests, and release records are versioned. Readers must reject unknown major schema versions and preserve unknown additive fields when forwarding records.

Each migration requires forward and rollback transformations, a backup made before mutation, dry-run output, row/object counts, checksums where stable, old-client behavior, deprecation date, and an owner. Rollback is prohibited after an irreversible business event unless the migration plan explicitly reconciles that event.

Old clients may read a release only when required security semantics are unchanged. Authentication, mandate, signature, nonce, revocation, or authority changes require a fail-closed minimum-client gate. Data export and deletion workflows must state retention exceptions for security, legal, and audit records.

Service retirement requires advance communication, export availability, revocation of service identities, artifact and endpoint disposition, backup retention decision, and a user exit path. Restart persistence is not restore evidence.

## Executable record migration

`scripts/security-record-migration.mjs` implements the machine-readable record boundary above. It:

- rejects unknown schema versions and skips no major version;
- preserves unknown additive fields in both directions;
- records before/after bytes, SHA-256 digests, and recursive object counts;
- distinguishes dry-run from mutation;
- creates an exclusive, byte-exact backup before atomic file replacement;
- binds rollback to the exact plan and prohibits rollback after any declared irreversible event;
- requires a fail-closed minimum-client gate whenever security semantics change.

The current additive fixture and plan are:

- `security-platform/migrations/platform-status-v1-v2.plan.json`
- `security-platform/migrations/fixtures/platform-status-v1.json`

Dry-run example:

```bash
npm run security:migration -- dry-run \
  --direction forward \
  --plan security-platform/migrations/platform-status-v1-v2.plan.json \
  --input security-platform/migrations/fixtures/platform-status-v1.json
```

Never run `apply` against an authoritative record without an explicit output and backup path, reviewed dry-run evidence, and the named owner’s approval.
