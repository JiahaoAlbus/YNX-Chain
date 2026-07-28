# YNX Calendar decisions

## D-001 — Recurrence source of truth

Calendar owns recurrence schema version 1. It stores local recurrence identifiers in the event timezone and expands occurrences using IANA timezone data. Unsupported schema versions fail closed.

## D-002 — Invalid monthly/yearly dates

ByMonthDay values that do not exist in a month are skipped rather than rolled into the next month. Yearly February 29 occurrences are generated only in leap years. This avoids silent date drift.

## D-003 — Single-occurrence exceptions

A recurrence exception is identified by the original local start (`YYYY-MM-DDTHH:mm`) in the series timezone. It is either `cancelled` or `modified`; a modified exception must supply a valid replacement local start/end. The local HTTP API exposes this through `occurrence` scope and the normal preview/approval state machine.

## D-004 — Conflict suggestions

Conflict detection and alternative suggestions remain advisory. Applying an overlapping event requires explicit user approval; Calendar never moves an event automatically. Cancelling one occurrence does not require an override for unrelated existing conflicts; modifying one occurrence evaluates only the replacement interval.

## D-005 — Artifact/source separation

Hosted preview artifacts from `e227c4f0505537b19f4588ea26478c54518f0a4c` remain valid historical test-only evidence but do not prove the current runtime at `9cf30f16c4312b4438d087b1df58cec68df54f15`. Release records must expose both commits.

## D-006 — Android toolchain

Android debug builds require JDK 17–21. The project build wrapper may discover an installed JDK 17 and Android SDK but must fail closed if a supported toolchain cannot be resolved. Java 24 is not silently accepted.

## D-007 — Ownership boundary

Repository-wide failures in consensus, Faucet, Trust, or IDE contract artifacts are recorded for Integration. Calendar does not patch those owners' modules from this worktree.

## D-008 — Recurrence mutation scopes

Calendar exposes exactly three recurrence mutation scopes:

- `occurrence`: cancel or modify one recurrence ID;
- `this_and_following`: truncate the original series before the selected recurrence ID and create one linked future series;
- `entire_series`: update the existing recurring event without creating a second series.

Selecting the first occurrence with `this_and_following` fails closed and must be expressed as `entire_series`.

## D-009 — Stable series lineage

Every event has a `SeriesID`. A split future event keeps the original `SeriesID`, records the original event as `ParentEventID`, and records the selected local recurrence identifier as `SplitFromRecurrenceID`. Legacy stored events populate missing lineage during load without changing their IDs.

## D-010 — Atomic related-event approval and rollback

A preview may contain related future events. Approval validates all primary and related versions or ID collisions before writing any event. Revert validates the same set before restoring the original series and deleting or restoring related events. Partial split approval or partial rollback is prohibited.

## D-011 — Migration classification

The disk envelope remains schema version 1 and integrity-protected. The current additive loader normalizes legacy recurrence and lineage fields, but Calendar state payload versioning and rollback migration are still incomplete. Backup restore must not be misrepresented as rollback migration.
