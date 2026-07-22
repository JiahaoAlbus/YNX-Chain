# Migration and Compatibility

## Committed state v7/v8/v9 to v10

Application version 12 uses committed-state schema v10. It preserves the v8 fee-event ledger and either v9 candidate layout, then combines sorted StrategyMandate/StrategyVault/audit state with staking delegations and queued-unbonding liabilities. Loading a mode-restricted older state always verifies that version's exact hash domain before conversion.

1. Recalculate and verify the v7 AppHash using the v7 domain and exact legacy fields.
2. Reject a mismatched or tampered legacy AppHash.
3. Initialize only fields that did not exist in the source schema; never infer historical fee, asset-authorization, or staking records.
4. Recalculate the v10 AppHash when the state differs from the migration anchor.
5. Validate account supply conservation and all existing application records under current rules.

Migration intentionally does not infer historical fees, mandates, vaults, lot provenance, delegations, or unbondings from balance changes. Coverage before activation is unknown; inventing records would create false chain evidence.

## Client compatibility

- Signed transfer version remains 1 and its canonical fields, signature domain, fixed fee, nonce behavior, and chain replay protection are unchanged.
- Signed application action version remains 1.
- Existing ABCI query paths and Gateway routes remain available.
- New fee, Quant mandate/vault/audit, and staking queries are additive.
- Old binaries cannot interpret a newer schema and must not write it. Rollback requires restoring the matching pre-upgrade state snapshot and binary together; a v10 state file must never be handed to a v7, v8, or v9 binary.

## Supply and atomicity invariants

Vault YNXT is removed from the depositor account and retained as a separately reconciled liquid-supply component. Queued unbonding YNXT is removed from account stake and remains an explicit liability until withdrawal. Account liquid + account stake + vault balances + queued unbonding must equal the migration supply anchor. Each vault's traceable lots must sum exactly to its balance, each vault mandate must exist, and all staking records must bind to an active migration validator.

A failed transaction runs on an isolated execution-state copy and cannot persist a charged fee, consumed nonce, moved lot, delegation, unbonding, or partially updated record.

## Required activation and rollback drill

Before staging activation, operators must back up the source state, verify its SHA-256 and mode, start application version 12 against a copy, and query accounts, fees, Quant collections, delegations, and unbondings. The drill executes approved mandate/vault/deposit/owner-withdraw plus delegation/unbond/mature-withdraw lifecycles, verifies liquid/staked/vault/unbonding supply and lot/audit reconciliation, restarts, and verifies the same AppHash and records. Rollback restores the untouched matching binary/state pair while public mutation ingress remains frozen.

Current evidence covers local migration and restart tests only. No staging or public migration has been performed.

## Smart Account candidate boundary

UserOperation remains an additive version-1 candidate format. Existing signed native transfer and application-action envelope versions remain unchanged. StrategyMandate, StrategyVault, delegation, unbonding, and withdrawal use signed application actions and v10 ABCI persistence; no existing account is silently reinterpreted.

Smart Account activation still requires a future committed-state version with explicit account, session, paymaster, recovery, and audit collections; canonical genesis/migration defaults; old-client query compatibility; replay vectors; and state-root differential tests. Rollback must restore the pre-activation binary/state pair. A newer state must never be written by an older binary.

## YUSD sandbox state v1

The YUSD sandbox uses an independent schema-version-1 JSON state file and never reads or writes consensus or stablecoin-issuer state. Startup validates the whole-file integrity hash, audit chain, reserve liabilities, account supply, redemptions, daily limits, and idempotency records before serving. No earlier YUSD sandbox schema exists, so no migration is claimed. A future schema change must use an explicit offline converter and retain the original file and binary for rollback; old binaries must not write newer schema files.

Restart persistence and tamper rejection are tested locally. An operator stop/copy/hash/restore drill has not yet been recorded, and no staging or public YUSD sandbox state exists.
