# YNX DEX migration and compatibility

## Indexer state schema v3

Schema v3 retains the authenticated pool and Strategy Vault event sequence and adds an independent fixed-schema FairFlow event sequence. Each FairFlow record carries its chain and contract identity, block/transaction/log identity, lifecycle type, batch, actor or Intent identity, exact stage-specific fields, observation time, source, version, confidence, coverage and failure state. Pool projections ignore FairFlow records; the global sequence covers both stored lists so omission or insertion fails closed.

On first open of authenticated schema v1 or v2 state, the indexer:

1. verifies the original HMAC, every representable event and sequence continuity;
2. creates the exact mode-0600 rollback file `<state>.schema-v1.bak` or `<state>.schema-v2.bak` using exclusive creation;
3. initializes the FairFlow event list as empty; and
4. atomically writes the same legacy events as authenticated schema v3.

An existing backup with different bytes causes startup failure. A tampered source state, backup, v3 state or event fails closed. The store tests prove both forward paths, byte-exact backups, permissions, FairFlow replay idempotency/conflict rejection, persistence and rewind.

## Confirmed EVM cursor schema v3

Cursor v3 binds both configured Strategy Vault and FairFlow addresses into its HMAC. Reopening it with either substituted address fails. A valid v1 cursor migrates with an exact v1 backup; when Vault or FairFlow indexing is newly enabled it rewinds to the configured deployment start block. A valid v2 cursor migrates with an exact v2 backup; when FairFlow is newly enabled it also rewinds to the start block. The shared idempotent store is then rescanned, preventing a late-enabled source from silently missing earlier logs.

Pool discovery remains in the same cursor. Confirmed reorg recovery rewinds pool, Vault and FairFlow events at one boundary, removes affected pool discovery and rescans. Tests prove v1/v2 address binding, backups, deployment-block rescan, all ten FairFlow ABI shapes, restart and shared reorg behavior with deterministic local RPC fixtures.

## API compatibility

Existing pool, token, position, price, TWAP, fee, transaction and Vault routes retain their shapes. Analytics adds the backward-compatible `fairFlowEvents` count. `GET /v1/fairflow/events?fairFlow=<address>&batchId=<optional>&limit=25|50|100` returns `ynx-fairflow-events-api-v1` records with fixed fields and explicit provenance. Its coverage is confirmed lifecycle logs only; accepting windows, active Intent counts and current batch state require direct RPC. The SDK therefore requires fresh authoritative RPC state before building an Intent request and uses indexed events only for reconciliation.

## Rollback

Rollback is an operator-controlled recovery, not an in-place downgrade:

1. stop the v3 indexer and archive its state, cursor, logs and hashes;
2. stop serving FairFlow events, and Vault actions if rolling back to v1, so missing legacy data cannot be mistaken for empty history;
3. restore the preserved state and cursor backup to isolated paths;
4. start the exact previous binary against those copies; and
5. replay only the sources that legacy schema supports while retaining archived v3 evidence.

Schema v2 cannot represent FairFlow events. Schema v1 cannot represent Vault or FairFlow events. A rollback therefore suspends the affected reconciliation endpoints; it must never claim that archived actions did not occur. Forward recovery restarts v3 from the archived state or reindexes from the verified deployment block.

## Old-client policy

Read-only clients remain compatible on existing routes and may capability-detect the FairFlow endpoint. Old indexer binaries may read only an isolated preserved snapshot and must not share writable paths with v3. Once newer event types exist, there is intentionally no lossy conversion to v1/v2. The supported path is upgrade, endpoint capability detection, or temporary operation limited to the isolated legacy sources.
