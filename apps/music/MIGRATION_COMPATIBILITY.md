# YNX Music migration and compatibility

Runtime source commit: `74716a19d95fc191b54102adc02000a91fafec24`

## Current persisted schema

- State schema version: `1`
- Format: JSON with SHA-256 integrity field
- Save behavior: temporary file, mode `0600`, atomic rename
- In-memory publication: copy-on-write after successful durable save
- Audit: append-only hash chain in the state document
- Private media paths: omitted from JSON and reconstructed from track IDs after load

## Compatibility already verified

- Existing schema-v1 state can restart and recover profiles, tracks, listener state, usage, allocations, settlements, cases, AI proposals, idempotency and audit.
- Pre-atomic global Trust and Pay idempotency keys remain readable for exact replay.
- Private WAV paths are reconstructed without exposing local server paths in API JSON.
- A tampered state integrity hash fails closed.
- A failed save does not publish partial memory state or append an audit event.

## Missing migration gates

The product does not yet have:

- a versioned migration registry;
- schema-v1 golden fixtures committed for forward compatibility;
- schema-v2 implementation;
- rollback migration or downgrade guard;
- old-client request/response compatibility matrix;
- field deprecation windows and removal telemetry;
- consistent state-plus-media backup;
- restore drill with integrity reconciliation and measured RTO/RPO;
- account export/delete migration semantics;
- service-stop export and creator media recovery package.

## Required next implementation

1. Add a migration registry keyed by `SchemaVersion` and refuse unknown future versions.
2. Commit sanitized v1 golden fixtures that include published/private tracks, media hashes, listener state, Trust/Pay idempotency and audit chain.
3. Introduce a no-semantic-change v2 migration that externalizes durable media object descriptors while retaining API privacy.
4. Add rollback support where lossless; otherwise fail with an explicit minimum-compatible version and a backup requirement.
5. Back up state and media under one manifest containing source commit, schema version, file hashes and byte counts.
6. Restore into a clean directory, verify state integrity, audit chain, media hashes, authorization and replay behavior.
7. Measure backup/restore duration and storage growth before assigning RTO/RPO.

Until those gates pass, migration and restore status remain `notStarted` in the full-goal coverage matrix, regardless of ordinary restart success.
