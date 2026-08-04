# YNX Finance state migration and compatibility

## Current state schema

The persisted Finance planning state is `version: 1`. It contains account-scoped categories, budgets, reminders, notes, privacy preferences, classifications, AI draft records, idempotency bindings, minimal audit events and used Wallet nonces. Explorer, Pay and future Exchange, DEX, Quant or Economics source facts are not copied into this authoritative local state.

The runtime decodes state and backup envelopes with unknown-field rejection. Unsupported state or backup versions fail closed before the live file is changed. Missing collection fields inside a valid version-1 account are normalized to empty collections so older version-1 files written before all optional collections existed remain readable.

## Upgrade rule

A future schema change must:

1. introduce an explicit new state version;
2. provide deterministic forward migration from every supported source version;
3. preserve a mode-`0600` authenticated backup before migration;
4. verify the migrated state by reopening it before service startup;
5. provide a tested rollback path to the pre-migration version;
6. keep old clients read-compatible or return a versioned, actionable failure;
7. update backup schema compatibility, tests, release evidence and the integration handoff.

There is no historical public Finance state version before version 1, so no synthetic legacy migration is claimed. The current local gate proves version-1 reopen, authenticated backup/restore, tamper rejection, unknown-field rejection and unsupported-version rejection. A version-2 migration drill becomes mandatory before any version-2 writer is released.

## Export compatibility

Privacy export/import uses the separate `ynx-finance-export-v1` user-data format. It may restore user planning records only. It must never overwrite Explorer, Pay, Exchange, DEX, Quant, Economics, Wallet session or other source-owner evidence.

## Rollback rule

Restore is an offline operator action. Stop every Finance writer before restoring. The restore operation preserves the current raw state as a private `.pre-restore.<timestamp>` file, records that file's SHA-256 and byte count in the restore receipt, atomically installs the verified backup, reopens the result and rolls the live file back automatically if verification or receipt persistence fails.

To return to the preserved pre-restore state, keep the service stopped, compare the preserved file against the receipt hash and byte count, create and verify a fresh authenticated backup from that file in an isolated copy, then restore that verified envelope through the same admin command. Do not replace a live file with an unverified manual copy.
