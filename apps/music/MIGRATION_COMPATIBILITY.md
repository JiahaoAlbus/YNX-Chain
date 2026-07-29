# YNX Music migration and compatibility

Runtime source commit: `22653153c62529f782f44b0a35177b531ae7e8af`

## Current persisted schema

- State schema version: `2`
- Format: JSON with a SHA-256 integrity field
- Save behavior: mode `0600`, temporary file, `fsync`, atomic rename
- In-memory publication: copy-on-write only after a successful durable save
- Audit: append-only sequence and hash chain inside the state document
- Private media paths: omitted from JSON and reconstructed from canonical track IDs
- Future schemas: rejected fail closed

## Schema-v1 compatibility

Schema v1 remains an accepted legacy input. Startup performs the following bounded migration:

1. Decode the v1 document and require all state collections.
2. Verify the original v1 integrity hash before changing any field.
3. Verify every audit sequence, previous-hash link, payload hash and event hash.
4. Advance exactly one version to schema v2.
5. Recompute the state integrity hash.
6. Verify every referenced private media object and its SHA-256.
7. Persist the migrated v2 document atomically.

The committed golden fixture is `internal/music/testdata/state-v1-empty.json`. Tests also prove that a future schema, a tampered v1 integrity hash and a migration that does not advance exactly one version are rejected.

## Backup and clean-directory restore

`ynx-musicd` now supports verified operator modes:

```bash
ynx-musicd -data /var/lib/ynx-music -backup /var/backups/ynx-music/<checkpoint>
ynx-musicd -data /var/lib/ynx-music-restored -restore /var/backups/ynx-music/<checkpoint>
```

A backup is created under a new destination and contains:

- `manifest.json` with manifest schema, creation time, state schema, state integrity hash, SHA-256 and byte counts;
- `state.json` copied as a private regular file;
- only the media objects referenced by the verified state;
- a canonical sorted media inventory with per-object SHA-256 and byte counts.

Restore requires absent `state.json` and `media/` destinations. It verifies the manifest, state digest, state integrity, audit chain, canonical media inventory, media hashes and private file permissions before publishing the restored state and media. Existing destinations are never overwritten.

## Verified gates

- `go test ./internal/music`
- `go test -race ./internal/music`
- `go test ./apps/music/...`
- `go vet ./internal/music ./apps/music/...`
- Golden v1 to persisted v2 migration
- State-and-media backup round trip
- Tampered backup rejection
- Dirty restore destination rejection

## Remaining migration and recovery work

- Lossless downgrade support or an explicit minimum-compatible-version policy
- Golden fixtures containing published/private tracks, artwork, listener history, Trust/Pay replay keys and a non-empty audit chain
- Backup/restore performance measurements and assigned RTO/RPO
- Account export/delete migration semantics
- Service-stop creator media recovery package
- Hosted encrypted backup retention and key-management policy owned by Security/SRE

Ordinary restart remains separate from disaster recovery. Production recovery status must not be marked complete until remote restore evidence and measured objectives exist.
