# Bridge Migration Compatibility

Bridge persisted state schema v2 adds lifecycle phases, mutation idempotency, safety state, and reconciliation records.

On startup, a v1 file is decoded using the exact v1 field layout and its original SHA-256 integrity value is verified before conversion. Legacy statuses map as follows:

- `pending_attestations` → `source_submitted`
- `ready_for_local_finalization` → `source_finalized`
- `finalized_local` → `proof_attestation`

Unknown legacy statuses fail closed. A valid v1 state is resealed as v2 using atomic mode-0600 replacement. A v1 integrity mismatch is rejected. Tests cover successful migration and tampered-v1 rejection.

Rollback to a v1 binary after v2 persistence is unsupported because v1 cannot interpret the new safety and lifecycle fields. Operator rollback requires restoring the pre-migration state backup together with the v1 binary; converting v2 back to v1 is prohibited because it would discard security state.
