# Migration and compatibility

Current state schema is `1`. State writes are integrity protected and atomic.
Restore rejects unknown schema versions and any hash mismatch. The current API
version is `/v1`; unknown JSON fields fail closed.

## Supported upgrade path

1. stop accepting mutations and drain the deterministic worker inbox
2. run `ynx-quant-cli backup --approve <destination>` with
   `YNX_QUANT_STATE_PATH` set
3. verify the emitted SHA-256, byte count, and schema
4. install the new binary without deleting the prior artifact
5. start read-only health/version checks, then migration tooling
6. run API compatibility, lifecycle, revoke, restart, and reconciliation tests
7. enable writes only after evidence passes

There is no schema `2` migration yet, so no forward-migration claim is made.
Future migrations require `1 → N` and `N → 1` fixtures, interruption recovery,
old-client response tests, and explicit irreversible-field review.

Schema `1` gained optional `executionLedger` and `adapterSequences` fields. An
older schema-1 file is decoded into a fresh state value, checked against its
exact historical integrity envelope, and initializes both maps empty. Its next
atomic mutation writes the extended envelope. A fixture proves this compatibility
path; integrity mismatches remain rejected.

## Rollback and restore

`ynx-quant-cli restore --approve <source>` validates size, schema, and integrity,
then atomically replaces state and appends a restore audit event. Automated tests
prove a pre-mutation backup restores experiments and clears the later mutation;
a tampered backup is rejected. Operators must preserve the current file before a
production restore and record the backup digest and artifact version.

API `/v1` deprecation requires at least one preview cycle, published sunset date,
client telemetry coverage, export support, and a fail-closed response after the
deadline. Service termination must leave users able to revoke mandates, stop
strategies, exit DEX vaults or Exchange positions through owning products, and
export/delete Quant records.

Local users can export the complete integrity-protected state with
`ynx-quant-cli export --approve <destination>`. Full local deletion requires the
exact confirmation `DELETE ALL LOCAL QUANT DATA`; it removes experiments,
strategies, paper state, mandates, orders, and idempotency records, retaining only
the audit tombstone. Durable adapter reservations, results and sequences are
deleted as user execution data. Multi-user account-scoped deletion remains a
Gateway/identity integration requirement and is not claimed.
