# Migration and compatibility

Current state schema is envelope version 1 and snapshot version 4. The store verifies an HMAC before decoding, uses strict JSON decoding, writes a temporary file, then atomically renames it.

The current forward migration accepts snapshot v1, v2 and v3. It removes obsolete product-local `walletChallenges` and `walletSessions`, initializes Provider Hub, merchant data-request and bulk-operation maps, and writes v4 on the next mutation. Canonical Gateway sessions are reconstructed and never migrated. Missing Merchant RBAC maps are normalized to empty maps. Unknown fields and future snapshot versions fail closed. `TestLegacySnapshotsMigrateAndFutureVersionFails` proves legacy forward migration and future-version rejection.

Snapshot v3 adds merchant-scoped deletion-request state. The request record is versioned by `policyVersion`; backup and restore counts now include `dataRequests`. Old v1/v2 snapshots contain no deletion requests and normalize safely to an empty map. Rollback to a v2 binary is not safe after v3 data requests are written unless the operator restores a compatible pre-v3 backup; silent field loss is prohibited.

Snapshot v4 adds persisted bulk webhook operation state. Old snapshots normalize
the map empty. A pre-v4 binary must not open or rewrite v4 state because it would
discard idempotency-linked progress; rollback requires a compatible pre-v4 backup.

The guarded recovery workflow is locally proven in `evidence/backup-restore-drill.json`: archive and nested store verification, exact-current-SHA confirmation, operation-lock exclusion, atomic replacement, post-restore verification and rollback-byte preservation all passed against source commit `53adf12dde18c4e6d0ca3602a528d3efe8c19aef`.

Reconciliation export declares schema version 1 in `X-YNX-Reconciliation-Schema`.
Its ten-column order and pending/committed evidence representation are fixed by
`TestReconciliationCSVGoldenSchemaAndEvidenceFields`; any incompatible change
requires a new header version, fixture and consumer migration note.

Merchant data export declares schema version 1 in `X-YNX-Data-Export-Schema`.
Its tenant boundary and redaction contract are fixed by
`TestMerchantDataExportRedactsRuntimeMaterialAndRequiresOwner`. Any incompatible
shape or redaction change requires a new schema header and consumer migration
note.

Release gates still open:

- Add an explicit schema migration registry and golden fixtures for every supported prior version.
- Add explicit rollback-migration commands and audit-ID integration. Backup, verify and guarded restore CLI commands are implemented and tested.
- Prove old-client compatibility and publish deprecation windows.
- Complete approved deletion execution, legal-hold disposition and orderly service-shutdown exit behavior; current routes intentionally stop at audited request/cancel states.
- Publish recurring remote restore-drill evidence; never overwrite live state during verification.

Rollback must restore both the prior binary and its compatible state backup. Replacing only the binary is not a rollback proof.
