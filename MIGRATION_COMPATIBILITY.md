# YNX DEX migration and compatibility

## Indexer state schema v5

Schema v5 retains the authenticated pool, Strategy Vault, FairFlow and LP Protection sequences and admits typed `ynx-stableswap-v1` pool events alongside `ynx-dex-cpmm-v1`. Stable events retain the same strict event identity and amount fields while their contract version prevents reserve/fee history from being presented as CPMM. Pool, position, fee and reserve-ratio TWAP projections accept both typed fungible-LP families. The global sequence still covers all three stored lists so omission or insertion fails closed.

On first open of authenticated schema v1, v2, v3 or v4 state, the indexer:

1. verifies the original HMAC, every representable event and sequence continuity;
2. creates the exact mode-0600 rollback file `<state>.schema-vN.bak` using exclusive creation;
3. preserves every representable FairFlow and LP Protection record, initializing only lists absent from that legacy schema; and
4. atomically writes the same authenticated events as schema v5.

An existing backup with different bytes causes startup failure. A tampered source state, backup, v5 state or event fails closed. The v4 migration test proves LP Protection history is retained and an already-valid Stable event remains typed.

## Confirmed EVM cursor schema v5

Cursor v5 binds the configured Strategy Vault, FairFlow, LP Protection and Stable Factory addresses into its HMAC. Each discovered pool now binds its contract version and immutable swap fee. Legacy discovered pools migrate explicitly to CPMM/30 BPS; enabling Stable indexing from v4 rewinds to the deployment start block after an exact v4 backup. Reopening with a substituted Stable Factory or typed-pool metadata fails.

CPMM and Stable discovery share the cursor but scan distinct verified Factory addresses. Stable fee BPS is read from the pool at its creation block; later event fees use that bound value. Protected CPMM swap fees instead require an exact same-transaction `ProtectionAssessed` match and fail closed when absent or duplicated. Confirmed reorg recovery rewinds every pool family and policy source at one boundary.

## API compatibility

Existing API routes retain their shapes; pool `contractVersion` now capability-identifies StableSwap. Reserve-ratio price/TWAP fields do not claim a marginal StableSwap price or external peg. The SDK requires fresh confirmed RPC state containing reserves, A, fee and decimal multipliers for Stable quotes; indexed history alone is insufficient. Existing LP Protection API semantics remain unchanged.

## Rollback

Rollback is an operator-controlled recovery, not an in-place downgrade:

1. stop the v5 indexer and archive its state, cursor, logs and hashes;
2. stop serving LP Protection events, FairFlow events, and Vault actions where unsupported by the target schema, so missing legacy data cannot be mistaken for empty history;
3. restore the preserved state and cursor backup to isolated paths;
4. start the exact previous binary against those copies; and
5. replay only the sources that legacy schema supports while retaining archived v5 evidence.

Schema v4 cannot safely discover or fee-label Stable pools. Schema v3 cannot represent LP Protection, schema v2 cannot represent FairFlow, and schema v1 cannot represent Vault actions. A rollback therefore suspends Stable endpoints and any other unsupported reconciliation source; it must never reinterpret Stable events as CPMM or claim archived actions did not occur. Forward recovery restarts v5 or reindexes from verified deployment blocks.

## Old-client policy

Read-only clients remain compatible and may capability-detect `contractVersion`. Clients that only implement CPMM must hide or reject `ynx-stableswap-v1` rather than apply constant-product math. Old indexers may read only isolated preserved snapshots and must not share writable paths with v5. There is intentionally no lossy typed-pool downgrade.
