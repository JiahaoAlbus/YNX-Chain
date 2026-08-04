# YNX Video media integrity evidence

Source commit: `cbf35c029acb14011f4bb25e7b230e4d1fbbbd8e`
State schema: `2`
Verified at: `2026-07-29T02:44:54Z`

## Implemented boundary

- Upload bytes are hashed while written and compared in constant time with the caller-declared SHA-256.
- FFmpeg output inventory includes the HLS playlist and every generated HLS segment.
- Every persisted `MediaVariant` records byte count, SHA-256, lineage, and—when derivative—the original object key and original SHA-256.
- The original fallback must exactly match the source object's stored bytes and SHA-256.
- Asset keys must remain inside the current video prefix; duplicate, missing, empty or unresolved assets fail processing.
- State schema v2 backfills legacy variant metadata by reading and hashing stored objects.
- A missing or unverifiable legacy asset changes the video to `private` and `failed`, with an audit event, instead of preserving a publishable state.
- The v2→v1 rollback migration removes the v2-only integrity fields explicitly.

## Direct verification

Passed:

- `go test ./internal/video/...`
- `go test -race ./internal/video/...`
- `go vet ./internal/video/...`
- `TestUploadPublishMetricsAndRestart`
- `TestRepositoryOwnedMediaTranscodesWithFFmpeg`
- `TestLegacyMediaVariantIntegrityBackfillsOnRestart`
- `TestMissingLegacyDerivativeFailsClosedOnRestart`
- `TestLegacyStateMigratesAndPersistsSchemaVersion`
- `TestNewerStateSchemaFailsClosed`
- `TestStateMigrationRollbackRoundTrip`

## Truth boundary

This proves local source behavior and persisted-state compatibility. It does not prove a ClamAV-backed current-source loopback E2E, remote durable object storage, shared-testnet acceptance, public deployment, production artifact provenance or production signing.
