# YNX Card Migration Compatibility

Source commit: `01415dc4413dd8d4e33756a52682ca0f2a6675ec`

## Current formats

- Primary state version: `1`
- Backup envelope: `ynx.card.backup.v1`
- Backup integrity domain: `YNX_CARD_BACKUP_V1`
- Verification size ceiling: 64 MiB
- Unknown state or backup versions fail closed.

## Tested compatibility path

A bounded v0 fixture without notifications migrates to state v1 by creating an empty notifications map. This fixture proves migration and rollback mechanics; it is not evidence that v0 was previously deployed in production.

The local drill verifies:

1. v1 state is exported into an integrity-bound backup.
2. A v0 fixture is verified and migrated to v1.
3. A pre-migration v1 rollback backup is created before mutation.
4. Restoring that rollback backup reproduces the original v1 snapshot hash.
5. Unsupported versions, wrong keys, tampered payloads, inconsistent indexes and broken audit chains are rejected before primary-state mutation.

## Compatibility truth

- Existing state-v1 clients remain the only supported runtime clients.
- Account-scoped export/delete, retention enforcement and old-mobile-client API compatibility are separate open gates.
- No destructive migration may run without a verified rollback destination on a distinct absolute path.
