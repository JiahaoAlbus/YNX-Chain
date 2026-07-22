# Migration and Compatibility

## Committed state v7 to v9

Application version 11 uses committed-state schema v9. It preserves the v8 fee-event ledger and adds staking delegations and unbonding liabilities. Loading a mode-restricted v7 state verifies the v7 hash domain before moving directly to v9. Loading v8 verifies the v8 hash domain and preserves all fee events before adding empty staking collections.

1. Recalculate and verify the v7 AppHash using the v7 domain and exact legacy fields.
2. Reject a mismatched or tampered legacy AppHash.
3. Initialize only fields that did not exist in the source schema; never infer historical fee or staking records.
4. Recalculate the v9 AppHash when the state differs from the migration anchor.
5. Validate account supply conservation and all existing application records under current rules.

Migration intentionally does not infer historical fees, delegations, or unbondings from balance changes. Coverage before activation is unknown; inventing records would create false chain evidence.

## Client compatibility

- Signed transfer version remains 1 and its canonical fields, signature domain, fixed fee, nonce behavior, and chain replay protection are unchanged.
- Signed application action version remains 1.
- Existing ABCI query paths and Gateway routes remain available.
- New fee queries are additive.
- Old binaries cannot interpret schema v9 and must not write migrated state. Rollback requires restoring the matching pre-upgrade binary/state pair; a v9 state file must never be handed to a v7 or v8 binary.

## Required activation and rollback drill

Before staging activation, operators must back up the source state, verify its SHA-256 and mode, start application version 11 against a copy, query accounts, fees, delegations, and unbondings, execute one approved delegation/unbond/withdrawal lifecycle, verify liquid + staked + queued-unbonding supply reconciliation, stop, restart, and verify the same AppHash and records. Rollback restores the untouched matching binary/state pair while public mutation ingress remains frozen.

Current evidence covers local migration and restart tests only. No staging or public migration has been performed.
