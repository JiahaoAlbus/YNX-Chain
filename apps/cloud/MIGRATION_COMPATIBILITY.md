# Migration and compatibility

The persisted metadata schema is now `schemaVersion: 3`. Startup accepts v1, v2, or v3 only and rejects invalid integrity before any backup or mutation. A valid legacy state is backed up byte-for-byte to an exclusive `state.json.v1.bak` or `state.json.v2.bak`, normalized, upgraded, integrity-signed, and atomically saved as v3. An existing backup must itself verify and exactly match the migration source. V3 binds objects, uploads, deletion records, and AI jobs to `cloud` or `docs`; legacy objects are deterministically classified by kind, while ambiguous legacy AI jobs fail closed and require fresh consent.

Current API prefix is `/api/v1`. Additive response fields are permitted; clients must ignore unknown response fields. Requests reject unknown fields. Breaking API changes require a new prefix and a documented overlap window.

Recovery archives use `ynx-cloud-recovery/v1` and validate regular files, relative paths, uniqueness, byte size, SHA-256, state integrity, and an empty restore destination. Local backup/restore is exercised by `scripts/smoke.sh`.

User portability exports use a separate schema (`ExportManifest.schemaVersion: 1`) and contain immutable object-version bytes plus owner metadata, grants, and relevant audit records for the authenticated product only. They are user-facing exports, not operator recovery archives.

`ynx-cloudd -data <data> -rollback-state-v1 <new-file>` verifies the current v3 source, strips v3-only product fields, and writes a legacy-compatible v1 state to a distinct, nonexistent destination without modifying current state. Tests cover a real minimal legacy-v1 layout, byte-identical backups, v1/v2→v3, v3→legacy rollback hashing, destination overwrite rejection, and tampered-source rejection.

Remaining compatibility proof: run the previous released binary against the generated rollback state, exercise a real old Web/native client against the API overlap server, define deprecation dates, and perform a remote restore/migration drill. Until those direct artifacts exist, migration readiness remains partial.
