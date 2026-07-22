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
- New fee and Quant mandate/vault/audit queries are additive.
- Old binaries cannot interpret a newer schema and must not write it. Rollback requires restoring the matching pre-upgrade state snapshot and binary together; a v9 state file must never be handed to a v7 or v8 binary.

## Committed state v8 to v9

Application version 11 introduces committed-state schema v9 with sorted StrategyMandate and StrategyVault collections plus an append-only asset-authorization audit ledger. Loading v8 first verifies the exact v8 AppHash using the v8 domain. It then initializes only empty v9 collections and recalculates the v9 AppHash when application records exist. Migration never fabricates historical mandates, vault balances, lot provenance, or audit events.

Vault YNXT is removed from the depositor account and retained as a separately reconciled liquid-supply component. Each vault's sorted traceable lots must sum exactly to its balance, its mandate must exist, and account balances plus vault balances plus stake must equal the migration supply anchor. A failed transaction runs on an isolated execution-state copy and cannot persist a charged fee, consumed nonce, moved lot, or partially updated record.

## Required activation and rollback drill

Before staging activation, operators must back up the active state file, verify its SHA-256 and mode, start application version 11 against a copy, query accounts, fee events, and empty Quant collections, execute approved mandate/vault/deposit/owner-withdraw test actions, verify supply/lot/audit reconciliation, stop, restart, and verify the same AppHash and records. Rollback restores the untouched pre-upgrade binary/state pair while public mutation ingress remains frozen.

Current evidence covers local migration and restart tests only. No staging or public migration has been performed.

## Smart Account candidate boundary

UserOperation remains an additive version-1 candidate format. Existing signed native transfer and application-action envelope versions remain unchanged. StrategyMandate and StrategyVault now use signed application actions and v9 ABCI persistence; no existing account is silently reinterpreted.

Smart Account activation still requires a future committed-state version with explicit account, session, paymaster, recovery, and audit collections; canonical genesis/migration defaults; old-client query compatibility; replay vectors; and state-root differential tests. Rollback must restore the pre-activation binary/state pair. A newer state must never be written by an older binary.
