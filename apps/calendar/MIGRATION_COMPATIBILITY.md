# YNX Calendar migration and compatibility

Runtime source: `55587bb6cc8c7c49202e4fc3222b69772dd05b5f`

## Versioned state

| Layer | Current version | Compatibility behavior |
|---|---:|---|
| Authenticated disk envelope | 1 | Any other version fails closed. |
| Calendar state payload | 1 | Legacy missing/zero version loads as version 1; negative or future versions fail closed. |
| Recurrence schema | 1 | Legacy version zero is normalized for supported existing rules. |
| Backup envelope | 1 | Wrong version, product, state version, HMAC, digest, age or target policy fails closed. |

The state schema addition is additive. Existing JSON members retain their names and meanings. Existing IDs, mutation replay keys, event versions, recurrence IDs, series lineage, sessions, audits, reminders and AI jobs are preserved during load normalization.

## Forward migration

1. Keep the disk envelope and HMAC key together.
2. Start the version-1 runtime against the existing authenticated state.
3. The loader accepts a missing/zero state payload version, normalizes it in memory to version 1, and normalizes supported legacy recurrence lineage.
4. The next successful state mutation writes version 1 under the existing authenticated disk envelope.
5. Verify login, event reads, recurrence expansion, mutation replay, reminders, audit, export and a preview/approve/revert cycle.

Evidence:

- `TestCalendarLegacyStateSchemaNormalizesAndFutureSchemaFailsClosed`
- `TestLegacyRecurrenceLineageNormalizesOnRestart`
- existing restart, recurrence, reminder and replay tests

## Incompatible future schema

A state payload with `schema_version` greater than 1 is rejected before service startup. Calendar does not guess, silently discard fields, or downgrade an unknown future state. Recovery requires the matching runtime or an explicit reviewed migration tool.

## Rollback

The safe rollback mechanism is an isolated authenticated restore, not in-place field deletion:

1. Create an authenticated backup before migration.
2. Restore it to a new relative target inside an isolated restore root.
3. Reopen and verify the restored state digest and functional gates.
4. Stop live writes.
5. Quarantine the current live state/key pair.
6. Promote the verified restored state/key pair using the operator maintenance procedure.
7. Keep the quarantined pair until the rollback window closes.

The restore function refuses to overwrite live state or an existing target. This prevents an unreviewed rollback from destroying the current state.

## Old-client compatibility

The current server preserves existing HTTP event, invitation, RSVP, share, AI, audit, export and delete routes. Recurrence mutation scopes are additive through `/v1/events/{id}/recurrence-preview`; existing entire-event mutation routes remain valid.

Old clients that do not send recurrence scope continue to use the existing entire-event behavior. New clients must send explicit scope, action, recurrence ID and base version for occurrence or future-series operations. All mutation paths still require preview and approval.

## Deprecation

No production deprecation date is approved. Before removing support for schema-zero state or an older client contract, Calendar must publish:

- accepted Integration contract version;
- minimum supported client versions;
- migration and rollback tooling;
- telemetry proving remaining legacy usage;
- user/admin notice period;
- export and service-exit path;
- Security/SRE-approved backup retention and key escrow.

## Data retention boundary

Local state, backup and restore are implemented and tested. Backup confidentiality encryption, offsite retention, geographic replication, independent key escrow, legal hold, deletion schedule and production RTO/RPO are not yet accepted. These remain explicit dependencies on `30-security-platform` and the public operations owners.
