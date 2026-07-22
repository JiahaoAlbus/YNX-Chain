# Migration and Compatibility

## Committed state v7 to v8

Application version 10 introduces committed-state schema v8 and an append-only fee-event ledger. Loading a mode-restricted v7 state performs these steps before accepting it:

1. Recalculate and verify the v7 AppHash using the v7 domain and exact legacy fields.
2. Reject a mismatched or tampered legacy AppHash.
3. Set schema version 8 and initialize an empty fee-event list.
4. Recalculate the v8 AppHash when the state differs from the migration anchor.
5. Validate account supply conservation and all existing application records under current rules.

Migration intentionally does not infer historical fees from balance changes. Historical fee coverage before activation is unknown; inventing events would create false chain evidence.

## Client compatibility

- Signed transfer version remains 1 and its canonical fields, signature domain, fixed fee, nonce behavior, and chain replay protection are unchanged.
- Signed application action version remains 1.
- Existing ABCI query paths and Gateway routes remain available.
- New fee queries are additive.
- Old binaries cannot interpret schema v8 and must not be used to write migrated state. Rollback requires restoring the pre-upgrade v7 state snapshot and binary together; a v8 state file must never be handed to a v7 binary.

## Required activation and rollback drill

Before staging activation, operators must back up the v7 file, verify its SHA-256 and mode, start application version 10 against a copy, query accounts and fee events, execute one approved test transfer, verify supply and fee reconciliation, stop, restart, and verify the same AppHash and event. Rollback restores the untouched v7 binary/state pair while public mutation ingress remains frozen.

Current evidence covers local migration and restart tests only. No staging or public migration has been performed.
