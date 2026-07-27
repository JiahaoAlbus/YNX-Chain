# YNX Trust Center Migration and Compatibility

Runtime source: `d31811280ba741026c74a836a212f78fe88c172a`

## State format

| Version | Admission | Behavior |
|---|---|---|
| 1 | Supported for one-time migration | Decode without discarding records, set version 2, calculate the snapshot seal and atomically rewrite mode `0600`. |
| 2 | Current | Verify the SHA-256 snapshot seal and persisted Wallet session bindings before state admission. |
| Other | Rejected | Service startup fails closed; no implicit downgrade or reset. |

Version-1 migration is covered by `TestSnapshotIntegrityRejectsOfflineTamperAndMigratesLegacyState`. A malformed or offline-modified version-2 snapshot is rejected.

## Backup format

`ynx-trust-backup/v1` carries exact version-2 state bytes plus a manifest and envelope seal. Restore does not accept legacy state directly inside a backup and does not overwrite an existing target. This prevents a restore ceremony from silently performing two migrations at once.

## API compatibility

- Existing `/api/state`, `/api/actions`, AI and authority routes retain their response schema.
- `GET /api/export` is additive and requires `trust:evidence:read`.
- Central session scope validation is stricter: wildcard, duplicate, whitespace-mutated and unknown scopes that may previously have been stored are rejected at verification or restart.
- No compatibility mode accepts a legacy browser token, role header or wildcard scope.

## Rollback compatibility

A backup created before a later live mutation can be restored to a clean path and cold-started as an earlier checkpoint. Rollback never mutates or deletes the later live store. Operators must preserve both stores and select the active path explicitly.

## Remaining migration gates

- policy-versioned retention/deletion and rollback semantics;
- central Gateway registry migration for `ynx-trust-center-v1`;
- packaged release migration evidence across the final unsigned/signed artifact;
- independent SRE recovery acceptance and measured RTO/RPO.
