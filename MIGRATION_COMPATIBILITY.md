# YNX Data Fabric Migration and Compatibility

## Versioned surfaces

- Canonical envelope schema: `1.0`.
- Persistent store schema: `1`.
- Backup Manifest schema: `1`.
- Release record schema: `1`.
- Journal JSON Schema: v1.
- PostgreSQL schema migration: `0001`.

Unknown fields fail closed in envelopes, persistent state, key registries, API write bodies and backup Manifests. Unsupported envelope versions are rejected before persistence. A producer must not emit a new version until registry compatibility tests and all affected consumer tests pass.

## Compatibility policy

Additive optional payload fields are allowed only inside a product event schema that has passed consumer compatibility tests. Envelope fields cannot be added under version `1.0` because strict decoders reject them. Removing or changing meaning, type, units, authority, privacy classification, ordering, retention, or required fields is a breaking change and requires a new schema version and parallel consumer window.

Financial amounts remain integer minor units. Asset and currency semantics cannot be changed in place. Corrections are new journal entries, never data migrations that rewrite history.

## Current migration truth

There is no predecessor Data Fabric store, so file schema `1` and PostgreSQL migration `0001` are initial formats. Restart and backup/restore tests cover file schema `1`. The PostgreSQL migrator uses a dedicated session advisory lock, serializable per-migration transaction, ordered versions and SHA-256 drift detection; API and Worker startup reject an absent or drifted migration. Isolated PostgreSQL 17.10 tests directly apply/verify migration `0001`, exercise database guards, and complete a hash/catalog-verified logical dump plus empty-target single-transaction restore followed by full checksum/integrity/count audit. Forward migration, rollback migration, mixed-version cluster, old-client window, replica/PITR failure and production-size drills do not yet exist. This document does not claim those gates are complete.

## Required upgrade procedure

1. Add a pure, deterministic migration from the prior schema to the new schema.
2. Add fixture tests for valid prior state, corrupted state, unknown fields, large state, interrupted migration and retry.
3. Back up and verify the source before migration.
4. Write migrated state to a new path, fsync, reopen and run full integrity and ledger verification.
5. Run both old and new consumers against a compatibility fixture set.
6. Switch atomically only after verification; retain the verified pre-migration backup for the approved rollback window.
7. Rollback restores the pre-migration backup. It must never silently coerce newer journal or event history into an older schema.

## Deprecation

Breaking versions require an announced support window, producer inventory, consumer owner, observed usage, migration guide, final acceptance evidence and an explicit removal release. Analytics consumers cannot be used as evidence that authoritative product consumers are compatible.
