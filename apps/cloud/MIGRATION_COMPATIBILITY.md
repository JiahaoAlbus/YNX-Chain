# Migration and compatibility

The persisted metadata schema is `schemaVersion: 1`. Startup rejects unknown versions and invalid integrity hashes. This fail-closed behavior is tested, but no forward migration exists yet; therefore schema migration and old-client compatibility are not complete.

Current API prefix is `/api/v1`. Additive response fields are permitted; clients must ignore unknown response fields. Requests reject unknown fields. Breaking API changes require a new prefix and a documented overlap window.

Recovery archives use `ynx-cloud-recovery/v1` and validate regular files, relative paths, uniqueness, byte size, SHA-256, state integrity, and an empty restore destination. Local backup/restore is exercised by `scripts/smoke.sh`.

User portability exports use a separate schema (`ExportManifest.schemaVersion: 1`) and contain immutable object-version bytes plus owner metadata, grants, and relevant audit records. They are user-facing exports, not operator recovery archives.

Before schema v2: implement v1→v2 and v2→v1 rollback migration fixtures, prove an old v1 client against the overlap server, define deprecation dates, and run restore from the previous released artifact. Until then migration readiness is false.
