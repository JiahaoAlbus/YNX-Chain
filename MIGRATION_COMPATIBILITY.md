# Migration and compatibility

## State schema

The public Oracle schema remains `ynx.oracle.v1`. The durable store has an independent integer `storeVersion`; current code writes version 2.

Version 1 stored raw signed observations, correction events, reporter sequences, and an integrity/event-chain envelope. Version 2 adds normalized events, durable aggregate decisions, emergency control events, and explicit store versioning.

## v1 to v2 migration

`OpenStore` performs the following bounded sequence:

1. Strictly decode the v1 envelope.
2. Verify schema, nonce domain, HMAC integrity, and the v1 event chain before changing data.
3. Create the original byte-for-byte state at `<state>.v1.backup` with exclusive creation and mode `0600`. An existing backup causes migration to fail closed rather than overwrite evidence.
4. Deterministically normalize every original observation and every corrected observation.
5. Set `storeVersion=2`, advance generation once, construct empty aggregate/control histories, and calculate the v2 event chain.
6. Atomically persist the v2 envelope through a same-directory temporary file and rename.
7. Reopen verification checks v2 integrity and its event chain.

`TestV1StoreMigratesWithBackupAndReopen` directly proves the sequence, backup existence, normalized event reconstruction, generation transition, and successful second reopen.

## Rollback migration

The `.v1.backup` file is the rollback source. Rollback is safe only before accepting any v2 observation, correction, aggregate, or control event. An operator must stop the daemon, preserve the v2 file separately, verify the backup with the v1-compatible release and the same nonce domain/integrity key, atomically restore it, and record an audit event outside the rolled-back state.

After v2 has accepted data, restoring v1 would discard valid events and is prohibited. Recovery must instead repair or replay v2 from its raw observations and correction history. No automated destructive rollback command is shipped.

## API and client compatibility

- `/health`, `/version`, `/prices`, `/v1/providers`, and `/v1/replay` retain their v1 paths.
- Existing required price fields are unchanged. `quality.status` adds `emergency_pause`; old clients that reject unknown enum values fail closed, as required.
- The Go SDK rejects unknown JSON fields and therefore must be upgraded before a future schema adds response fields. Schema changes require a new versioned endpoint or coordinated SDK release.
- Signed observation payloads do not include server-authoritative `receivedAt`; the server assigns it at ingestion. Reporter signatures cover the provider-authored observation fields.

## Deprecation policy

Schema or policy versions remain readable for at least one published Testnet compatibility window after a successor is available. A deprecation notice must identify last-ingest, last-read, export, and deletion dates. No current API or store version is deprecated.

## Data export, deletion, and service stop

`Store.Export` emits the full versioned state including originals, corrections, normalized events, aggregate decisions, controls, sequences, and chain hash. Provider-specific retention rights still govern whether exported third-party data may be retained or redistributed.

Oracle data is not user-profile data and cannot be selectively deleted without breaking public lineage. Legally required provider-data deletion is handled by stopping new ingestion, exporting permitted audit metadata, publishing a versioned discontinuity, and rebuilding a new lineage that does not silently claim continuity. Service shutdown must publish the last safe value as stale/unavailable, retain export access for the permitted period, and never imply live pricing.
