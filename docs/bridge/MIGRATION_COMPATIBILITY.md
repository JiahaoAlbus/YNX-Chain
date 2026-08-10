# Bridge Migration Compatibility

## Current state schema

The current persisted state schema is **v7**. Schema v7 binds each transfer to the canonical Bridge lifecycle state machine and separates provider or operator destination confirmation from actual destination-asset availability. It adds deterministic message identity, nonce domain, proof type and digest, explicit proof-verification status, and a terminal `destination_available` boundary. A legacy `destination_confirmed` observation migrates conservatively to `destination_action_confirmed`; it never becomes spendable availability without new direct evidence.

Schema v6 introduced exact reconciliation replay results. Replaying an older idempotency key returns the original persisted record, including evidence reference, accounting values, and timestamps. States from v1-v5 that cannot reconstruct an overwritten historical response mark those keys as replay-unavailable and fail closed instead of returning a newer observation.

Schema v5 added explicit transfer exposure status. Schema v4 added the append-only lifecycle timeline. Schema v3 added durable data-rights requests and identity-redaction markers. Schema v2 added current phase, mutation idempotency, safety state, and reconciliation records.

## Forward migration

Bridge verifies the original integrity digest and audit chain before accepting any v1-v6 state. Unknown versions, malformed structures, invalid lifecycle data, inconsistent terminal resolution, forged attestations, source-event conflicts, or integrity mismatches are rejected.

Forward migration rules are conservative:

- v1 status values map only to their known lifecycle equivalents.
- v2/v3 records receive a migration snapshot rather than invented historical events.
- v4/v5/v6 lifecycle evidence is retained and canonicalized.
- legacy destination confirmation does not establish destination-asset availability.
- settled exposure is not reopened by a later dispute.
- legacy reconciliation replay gaps remain explicit and fail closed.
- migrated state is atomically resealed as v7 with mode `0600`.

## Rollback and forward recovery

A v7 state file must **not** be converted backwards. Older binaries cannot safely interpret v7 proof, availability, lifecycle, reconciliation, privacy, and exposure semantics. A backwards converter could discard evidence, reopen settled exposure, or incorrectly advertise destination assets as available.

The supported rollback procedure is:

1. Enable the deployment mutation freeze before the upgrade window.
2. Stop the coordinator and verify no accepted mutation remains in flight.
3. Copy the exact pre-migration state file, retain mode `0600`, record SHA-256 and byte size, and bind it to the matching binary and source commit.
4. Start the new binary and verify migration, health, state integrity, lifecycle semantics, reconciliation, and audit continuity.
5. Do not accept post-upgrade mutations until the rollback decision window closes. If mutations have been accepted, an old-state rollback is prohibited unless those mutations are independently reconciled and replayed under an approved recovery procedure.
6. For rollback, stop the new binary and restore the exact pre-migration backup with its matching prior binary.
7. A later forward recovery may restore the same backup and migrate again. The resulting v7 state must be deterministic and evidence-equivalent.

`TestBridgeV6RollbackBackupForwardRecoversDeterministically` performs the bounded local rehearsal: one exact v6 backup is migrated to v7, restored, and migrated a second time. The two persisted v7 files must be byte-identical and preserve lifecycle, message identity, nonce domain, integrity, and audit evidence while keeping destination availability false.

## Verification

Run:

```text
make bridge-migration-check
```

The gate covers v1-v6 integrity-checked forward migration, tamper rejection, conservative lifecycle conversion, and deterministic v6 rollback/forward recovery. Backup corruption and service restore are independently covered by `make bridge-restore-check`.
