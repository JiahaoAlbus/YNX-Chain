# Migration and compatibility

Current state schema is envelope version 1 and snapshot version 2. The store verifies an HMAC before decoding, uses strict JSON decoding, writes a temporary file, then atomically renames it.

The current forward migration accepts snapshot v1, removes obsolete product-local `walletChallenges` and `walletSessions`, initializes the Provider Hub map, and writes v2 on the next mutation. Canonical Gateway sessions are reconstructed and never migrated. Missing Merchant RBAC maps are normalized to empty maps. Unknown fields and future snapshot versions fail closed. `TestSnapshotV1MigratesProvidersAndFutureVersionFails` proves both directions.

Release gates still open:

- Add an explicit schema migration registry and golden fixtures for every supported prior version.
- Add explicit rollback-migration commands and audit-ID integration. Backup, verify and guarded restore CLI commands are implemented and tested.
- Prove old-client compatibility and publish deprecation windows.
- Define retention, export/delete, legal hold and service-shutdown exit behavior.
- Publish recurring remote restore-drill evidence; never overwrite live state during verification.

Rollback must restore both the prior binary and its compatible state backup. Replacing only the binary is not a rollback proof.
