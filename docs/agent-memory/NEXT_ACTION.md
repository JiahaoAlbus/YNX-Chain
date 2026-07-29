# YNX AI next action

Implement the versioned encrypted-state backup and restore slice.

1. Define a bounded backup manifest that records schema version, product ID, source checksum, created time, and encrypted-state checksum without storing content keys or plaintext.
2. Add deterministic backup creation and atomic restore validation in `internal/aiproduct`.
3. Reject wrong product, unsupported schema, checksum mismatch, truncated backup, wrong key, replayed restore, and restore over a newer incompatible state.
4. Add tests proving successful backup/restart/restore, tamper rejection, rollback safety, and audit continuity.
5. Create `apps/ai/MIGRATION_COMPATIBILITY.md` with current schema-v1 truth, forward/rollback policy, compatibility matrix, RTO/RPO measurement procedure, and service-exit export boundary.
6. Run product tests, race tests, vet, Release Gate, full Go tests, and targeted `govulncheck`.
7. Review the diff, commit, push, verify local SHA equals remote SHA, and update Agent Memory plus release/evidence metadata.

Do not wait for central owners for this slice. Do not claim staging backup, achieved RTO/RPO, or disaster recovery until a deployed drill produces direct evidence.
