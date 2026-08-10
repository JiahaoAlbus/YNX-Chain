# Migration and compatibility

## State schema

The public Oracle schema remains `ynx.oracle.v1`. The durable store has an independent integer `storeVersion`; current code writes version 3.

Version 1 stored raw signed observations, correction events, reporter sequences, and an integrity/event-chain envelope. Version 2 added normalized events, durable aggregate decisions, emergency control events, and explicit store versioning. Version 3 adds strict structured OHLCV, trades, CLOB order books, DEX pool state, provider health, and an explicit effective time for each normalized original/correction event.

## v1/v2 to v3 migration

`OpenStore` performs the following bounded sequence:

1. Strictly decode the v1 envelope.
2. Verify schema, nonce domain, HMAC integrity, and the v1 event chain before changing data.
3. Create the original byte-for-byte state at `<state>.v1.backup` or `<state>.v2.backup` with exclusive creation and mode `0600`. An existing backup causes migration to fail closed rather than overwrite evidence.
4. Deterministically normalize every original observation and every corrected observation.
5. For v2, derive each normalized event effective time from the original observation or referenced correction and recalculate its normalized hash.
6. Set `storeVersion=3`, advance generation once, and calculate the v3 event chain.
7. Atomically persist the v3 envelope through a same-directory temporary file and rename.
8. Reopen verification checks v3 integrity and its event chain.

`TestV1StoreMigratesWithBackupAndReopen` and `TestV2StoreMigratesStructuredEffectiveTimeWithBackup` directly prove both paths, backup existence, normalized reconstruction/effective time, generation transitions, and successful second reopen.

## Rollback migration

The matching `.v1.backup` or `.v2.backup` file is the rollback source. Rollback is safe only before accepting any v3 observation, correction, aggregate, or control event. An operator must stop the daemon, preserve the v3 file separately, verify the backup with the compatible release and the same nonce domain/integrity key, atomically restore it, and record an audit event outside the rolled-back state.

After v3 has accepted data, restoring an older state would discard valid events and is prohibited. Recovery must instead repair or replay v3 from its raw observations and correction history. No automated destructive rollback command is shipped.

## API and client compatibility

- `/health`, `/version`, `/prices`, `/v1/providers`, and `/v1/replay` retain their v1 paths; `/v1/market-data` adds the typed structured live feed.
- Existing required price fields are unchanged. `quality.status` adds `emergency_pause`; old clients that reject unknown enum values fail closed, as required.
- The Go SDK rejects unknown JSON fields and therefore must be upgraded before a future schema adds response fields. Schema changes require a new versioned endpoint or coordinated SDK release.
- Signed observation payloads do not include server-authoritative `receivedAt`; the server assigns it at ingestion. Reporter signatures cover the provider-authored observation fields.

## Deprecation policy

Schema or policy versions remain readable for at least one published Testnet compatibility window after a successor is available. A deprecation notice must identify last-ingest, last-read, export, and deletion dates. No current API or store version is deprecated.

## Data export, deletion, and service stop

`Store.Export` emits the full versioned state including originals, corrections, normalized events, aggregate decisions, controls, sequences, and chain hash. Provider-specific retention rights still govern whether exported third-party data may be retained or redistributed.

Oracle data is not user-profile data and cannot be selectively deleted without breaking public lineage. Legally required provider-data deletion is handled by stopping new ingestion, exporting permitted audit metadata, publishing a versioned discontinuity, and rebuilding a new lineage that does not silently claim continuity. Service shutdown must publish the last safe value as stale/unavailable, retain export access for the permitted period, and never imply live pricing.
