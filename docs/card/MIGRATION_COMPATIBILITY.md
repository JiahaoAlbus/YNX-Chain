# YNX Card Migration Compatibility

Source commit: `d79872f5df4da0566e11ef40e5314ea68d9846f4`

## Current formats

- Primary state version: `1`
- Backup envelope: `ynx.card.backup.v1`
- Backup integrity domain: `YNX_CARD_BACKUP_V1`
- Verification size ceiling: 64 MiB
- Unknown state or backup versions fail closed.

## Tested compatibility path

A bounded v0 fixture without notifications or deletion receipts migrates to state v1 by creating empty maps for both. Existing state-v1 documents written before the data-lifecycle slice also normalize a missing `deletionReceipts` field to an empty map before subsequent persistence. These paths prove migration and rollback mechanics; they are not evidence that v0 was previously deployed in production.

The local drill verifies:

1. v1 state is exported into an integrity-bound backup.
2. A v0 fixture is verified and migrated to v1.
3. A pre-migration v1 rollback backup is created before mutation.
4. Restoring that rollback backup reproduces the original v1 snapshot hash.
5. Unsupported versions, wrong keys, tampered payloads, inconsistent indexes and broken audit chains are rejected before primary-state mutation.

## Compatibility truth

- Existing state-v1 clients remain the only supported runtime clients.
- Account export, retention and deletion are additive HTTP routes; existing Card routes and persisted state version remain unchanged.
- Older Wallet/Gateway integrations must not call account deletion until they support the dedicated `card:data:delete` scope. Requests signed with only the default Card scopes fail closed.
- Old-mobile-client API compatibility remains a separate open gate.
- No destructive migration may run without a verified rollback destination on a distinct absolute path.
