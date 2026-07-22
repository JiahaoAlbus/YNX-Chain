# Bridge Migration Compatibility

Bridge persisted state schema v3 adds durable data-rights requests and sender/recipient identity-redaction markers. Schema v2 added lifecycle phases, mutation idempotency, safety state, and reconciliation records.

On startup, a v1 file is decoded using the exact v1 field layout and its original SHA-256 integrity value is verified before conversion. Legacy statuses map as follows:

- `pending_attestations` → `source_submitted`
- `ready_for_local_finalization` → `source_finalized`
- `finalized_local` → `proof_attestation`

Unknown legacy statuses fail closed. Valid v1 and v2 states are integrity-verified before migration and resealed as v3 using atomic mode-0600 replacement. v1/v2 integrity mismatches are rejected. Tests cover successful v1 and v2 migration, redacted-state restart, and tampered-state rejection.

Rollback to a v1 or v2 binary after v3 persistence is unsupported because older binaries cannot interpret data requests or identity-redaction state. Operator rollback requires restoring the exact pre-migration state backup with its matching binary. Converting v3 backwards is prohibited because it would discard security/privacy state or reintroduce removed identities.
