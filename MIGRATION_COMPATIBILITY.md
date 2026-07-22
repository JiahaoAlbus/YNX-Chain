# YNX DEX migration and compatibility

## Indexer state schema v4

Schema v4 retains the authenticated pool, Strategy Vault and fixed-schema FairFlow sequences and adds an independent fixed-schema LP Protection event sequence. Each LP Protection record carries chain and contract identity, block/transaction/log identity, event type, pool, token or config fields, exact fee components, Oracle time/source hash, realized fee amount, explicit zero incentive amount, observation time and provenance. Pool projections ignore protocol-policy records; the global sequence covers all three stored lists so omission or insertion fails closed.

On first open of authenticated schema v1, v2 or v3 state, the indexer:

1. verifies the original HMAC, every representable event and sequence continuity;
2. creates the exact mode-0600 rollback file `<state>.schema-v1.bak`, `<state>.schema-v2.bak` or `<state>.schema-v3.bak` using exclusive creation;
3. preserves representable FairFlow records from v3, initializes unsupported newer lists as empty; and
4. atomically writes the same legacy events as authenticated schema v4.

An existing backup with different bytes causes startup failure. A tampered source state, backup, v4 state or event fails closed. Store tests prove all forward paths, byte-exact backups, permissions, replay idempotency/conflict rejection, LP Protection persistence, analytics and shared rewind.

## Confirmed EVM cursor schema v4

Cursor v4 binds the configured Strategy Vault, FairFlow and LP Protection addresses into its HMAC. Reopening it with any substituted address fails. Valid v1/v2/v3 cursors migrate only after exact versioned backups. Any newly enabled source, including LP Protection when upgrading from v3, rewinds the shared cursor to the configured deployment start block. The idempotent store is then rescanned, preventing a late-enabled source from silently missing earlier logs.

Pool discovery remains in the same cursor. Confirmed reorg recovery rewinds pool, Vault, FairFlow and LP Protection events at one boundary, removes affected pool discovery and rescans. Tests prove legacy address binding, backups, deployment-block rescan, all ten FairFlow and all four LP Protection ABI shapes, fee-cap substitution rejection, restart and shared reorg behavior with deterministic local RPC fixtures.

## API compatibility

Existing pool, token, position, price, TWAP, fee, transaction, Vault and FairFlow routes retain their shapes. Analytics adds the backward-compatible `lpProtectionEvents` count. `GET /v1/lp-protection/events?lpProtection=<address>&pool=<optional>&type=<optional>&limit=25|50|100` returns `ynx-lp-protection-events-api-v1` records with fixed fields and explicit provenance. Coverage is confirmed logs only; current policy and Oracle state require direct RPC. The SDK binds a fresh authoritative protection quote to the exact pool, token and amount, then uses indexed `ProtectionAssessed` only for post-confirmation reconciliation. It never signs or submits a swap.

## Rollback

Rollback is an operator-controlled recovery, not an in-place downgrade:

1. stop the v4 indexer and archive its state, cursor, logs and hashes;
2. stop serving LP Protection events, FairFlow events, and Vault actions where unsupported by the target schema, so missing legacy data cannot be mistaken for empty history;
3. restore the preserved state and cursor backup to isolated paths;
4. start the exact previous binary against those copies; and
5. replay only the sources that legacy schema supports while retaining archived v4 evidence.

Schema v3 cannot represent LP Protection events. Schema v2 cannot represent FairFlow or LP Protection events. Schema v1 cannot represent Vault, FairFlow or LP Protection events. A rollback therefore suspends affected reconciliation endpoints; it must never claim archived actions did not occur. Forward recovery restarts v4 from archived state or reindexes from the verified deployment block.

## Old-client policy

Read-only clients remain compatible on existing routes and may capability-detect the FairFlow and LP Protection endpoints. Old indexer binaries may read only an isolated preserved snapshot and must not share writable paths with v4. Once newer event types exist, there is intentionally no lossy conversion. The supported path is upgrade, endpoint capability detection, or temporary operation limited to isolated legacy sources.
