# YNX DEX migration and compatibility

## Indexer state schema v2

Schema v2 adds confirmed `YNXStrategyVault.ActionExecuted` records to the existing HMAC-protected event sequence. Legacy pool event JSON keeps byte-equivalent serialization because Vault-only fields use `omitempty`; nevertheless, an old strict decoder cannot represent a populated Vault action, so the durable state version is explicitly raised rather than mislabeled as v1.

On first open of authenticated schema v1 state, the indexer:

1. verifies the original HMAC and every legacy event;
2. verifies sequence continuity;
3. creates the exact mode-0600 rollback file `<state>.schema-v1.bak` using exclusive creation;
4. atomically writes the same events as authenticated schema v2.

An existing backup with different bytes causes startup failure. A tampered source state, backup, v2 state or event fails closed. `TestStoreMigratesAuthenticatedSchemaV1AndPreservesRollback` proves the forward migration, byte-exact backup and permissions.

## Confirmed EVM cursor schema v2

Cursor v2 binds the configured Strategy Vault address into its HMAC. Reopening it with another Vault address fails. When a valid v1 cursor is upgraded while Vault indexing is newly enabled, the v1 cursor is preserved at `<cursor>.schema-v1.bak`, the cursor rewinds to the configured deployment start block, and the shared idempotent event store is rescanned. This prevents a late-enabled Vault from silently missing earlier actions.

Pool discovery remains in the same cursor, and confirmed reorg recovery rewinds both pool and Vault events at the same boundary. `TestCursorMigratesV1AndRewindsWhenVaultIndexingIsEnabled` and `TestEVMPollerConfirmedDecodeRestartAndReorg` prove binding, rescan, restart and reorg behavior with local deterministic RPC fixtures.

## API compatibility

Existing pool, token, position, price, TWAP, fee and transaction routes retain their shapes. Pool projections explicitly ignore Vault events. Analytics adds the backward-compatible `vaultActions` field. The new `GET /v1/vault/actions?vault=<address>&limit=25|50|100` response is versioned `ynx-vault-actions-api-v1` and labels its source, time, confidence, coverage and null failure state. Its coverage is only confirmed `ActionExecuted`; mandate configuration and current balances require direct RPC state.

## Rollback

Rollback is an operator-controlled recovery, not an in-place downgrade:

1. stop the v2 indexer and archive its state, cursor, logs and hashes;
2. stop serving the Vault actions endpoint so clients cannot confuse missing v1 data with an empty history;
3. restore the preserved state and cursor v1 backups to isolated paths;
4. start the exact previous binary against those copies;
5. replay pool events from its preserved cursor and retain the archived v2 evidence for every Vault action.

Schema v1 cannot represent Vault actions. Rolling back therefore suspends Vault reconciliation; it must never claim that the archived actions did not occur. Forward recovery restarts v2 from its archived state or reindexes from the verified deployment block.

## Old-client policy

Read-only API clients remain compatible on existing routes. Old indexer binaries may read only the preserved v1 snapshot and must not share writable paths with v2. Once Vault actions exist, there is intentionally no lossy conversion of v2 state into v1. The supported path is upgrade, endpoint capability detection, or temporary pool-only operation using the isolated rollback snapshot.
