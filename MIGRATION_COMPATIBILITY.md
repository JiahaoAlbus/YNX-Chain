# YNX Shop Migration and Compatibility

Updated: 2026-07-29

Implementation commits:

- Forward and rollback migration: `d2a55ecffb8800df6046bfa7bd152c1bc956cbcc`
- Migration evidence checkpoint: `c929056bfd083d124dff7998166bc1ee86d71393`

## Persistence versions

- Schema v1: legacy commerce snapshot without persisted buyer profiles, carts, or rate windows.
- Schema v2: current schema, including buyer profiles, carts, and bounded request-rate windows.
- Integrity envelope version: 1. The envelope is separate from the commerce schema version.

A missing or zero schema version is interpreted as v1 for compatibility. Versions below v1 or above the current v2 fail closed with `ErrPersistenceVersion`.

## Forward migration

Opening a valid v1 snapshot performs an in-memory normalization to v2, initializes absent maps, and persists the migrated snapshot atomically. With an HMAC key, the integrity envelope is verified before migration and regenerated for the v2 snapshot. A wrong key, tampered state, malformed envelope, or unsupported schema stops startup.

Forward migration preserves stores, catalog, inventory, orders, idempotency, audits, AI jobs, and seller roles. Fields not present in v1 are initialized empty.

## Rollback to v1

`RollbackCommercePersistence(path, key, 1)` is the only supported downgrade target.

The operation:

1. Reads and verifies the current persisted state.
2. Normalizes and validates it as a supported schema.
3. Writes an exact current-state recovery point at `<state-path>.schema-rollback`.
4. Sets the downgraded snapshot version to v1.
5. Omits buyer profiles, carts, and request-rate windows because v1 cannot represent them.
6. Atomically writes the downgraded state.
7. Returns counts for every omitted v2 record class.

The rollback does not silently claim lossless compatibility. Stores, products, orders, idempotency records, audits, AI jobs, and seller roles remain represented. Buyer profile/address data, carts, and rate windows require the v2 recovery point for exact restoration.

## Restore after rollback

`RestoreCommercePersistenceRollback(path, key)` reads `<state-path>.schema-rollback`, verifies its integrity, requires the recovery point to be current schema v2, normalizes it, and atomically restores it to the active state path.

The recovery point is not a substitute for environment backup policy. Operators must protect state files and integrity keys separately and must not commit either one.

## Old-client boundary

A v1 reader can consume the explicit v1 downgrade output because v2-only fields are absent. It cannot observe buyer profiles, carts, or rate windows. The Shop API and Web/native surfaces must therefore treat those capabilities as unavailable when connected to a v1 runtime; they must not infer empty buyer data as successful v2 migration.

A v2 runtime can open v1 state and migrate it forward. It rejects future schema versions rather than guessing their semantics.

## Verification

The migration and rollback suite covers:

- v1 open and automatic v2 persistence
- map initialization
- v2 reopen
- unsupported future schema rejection
- exact recovery-point creation
- omission counts for v2-only records
- v1 downgrade readability
- restoration of the exact v2 state
- HMAC verification and wrong-key/tamper rejection
- old-client compatibility vectors

Current evidence is local. No current-source Staging migration, rollback drill, production data migration, or public restore is claimed.
