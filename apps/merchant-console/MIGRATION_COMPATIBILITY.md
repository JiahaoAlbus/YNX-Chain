# Migration and compatibility

Current state schema is envelope version 1 and snapshot version 1. The store verifies an HMAC before decoding, uses strict JSON decoding, writes a temporary file, then atomically renames it.

The current forward migration removes obsolete product-local `walletChallenges` and `walletSessions`; canonical Gateway sessions are reconstructed and never migrated. Missing Merchant RBAC maps are normalized to empty maps. Unknown fields fail closed.

Release gates still open:

- Add an explicit schema migration registry and golden fixtures for every supported prior version.
- Add CLI backup, verify, restore and rollback-migration commands with audit IDs.
- Prove old-client compatibility and publish deprecation windows.
- Define retention, export/delete, legal hold and service-shutdown exit behavior.
- Run a timed restore drill against a copy; never overwrite live state during verification.

Rollback must restore both the prior binary and its compatible state backup. Replacing only the binary is not a rollback proof.
