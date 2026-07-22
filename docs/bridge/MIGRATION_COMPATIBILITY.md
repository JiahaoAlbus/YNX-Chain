# Bridge Migration Compatibility

Bridge persisted state schema v4 adds a per-transfer append-only lifecycle timeline. New records preserve ordered source-submitted, source-accepted, source-finalized, proof-attestation, destination, failure, retry, recovery, and dispute observations with event source, evidence reference, reason, timestamp, and explicit non-independent-proof coverage. Schema v3 added durable data-rights requests and sender/recipient identity-redaction markers. Schema v2 added current lifecycle phase, mutation idempotency, safety state, and reconciliation records.

Verified v2 and v3 files are migrated to v4 only after their original integrity digest and audit chain pass. Existing transfers receive one snapshot event labeled `source=schema-migration` and `coverage=migration-current-phase-only`; migration does not invent historical transitions that the old schema did not retain. New timelines require contiguous sequence numbers, valid phases/timestamps/sources, and survive restart under the state integrity digest.

On startup, a v1 file is decoded using the exact v1 field layout and its original SHA-256 integrity value is verified before conversion. Legacy statuses map as follows:

- `pending_attestations` → `source_submitted`
- `ready_for_local_finalization` → `source_finalized`
- `finalized_local` → `proof_attestation`

Unknown legacy statuses fail closed. Valid v1, v2, and v3 states are integrity-verified before migration and resealed as v4 using atomic mode-0600 replacement. Legacy integrity mismatches are rejected. Tests cover successful v1/v2/v3 migration, honest lifecycle snapshot coverage, redacted-state restart, and tampered-state rejection.

Rollback to a v1, v2, or v3 binary after v4 persistence is unsupported because older binaries cannot interpret the current data-rights and lifecycle state. Operator rollback requires restoring the exact pre-migration state backup with its matching binary. Converting v4 backwards is prohibited because it would discard security/privacy or lifecycle evidence, or reintroduce removed identities.
