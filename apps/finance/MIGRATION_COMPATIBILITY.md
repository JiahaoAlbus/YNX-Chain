# YNX Finance state migration and compatibility

## Current state schema

The persisted Finance state is `version: 2`. It preserves every version-1 planning field and adds account-scoped Broker Sandbox mappings, approval challenges, logical orders, one-time outbox records and an audit journal. Explorer, Pay and provider facts remain source-owned and are not copied into this state as invented balances or fills.

The runtime decodes state and backup envelopes with unknown-field rejection. Unsupported versions fail closed before the live file is changed. A valid version-1 file or authenticated backup is deterministically normalized in memory and migrated to version 2. Its original canonical hash remains the CAS precondition, so the first successful write atomically replaces exactly the version that was read. Opening alone does not rewrite the file.

## Upgrade rule

A future schema change after version 2 must:

1. introduce an explicit new state version;
2. provide deterministic forward migration from every supported source version;
3. preserve a mode-`0600` authenticated backup before migration;
4. verify the migrated state by reopening it before service startup;
5. provide a tested rollback path to the pre-migration version;
6. keep old clients read-compatible or return a versioned, actionable failure;
7. update backup schema compatibility, tests, release evidence and the integration handoff.

The local gate proves version-1 lazy migration, version-2 reopen, authenticated backup/restore, tamper rejection, unknown-field rejection, unsupported-version rejection, concurrent CAS consumption and restart recovery. Version 1 remains the only supported source version. A version-1 binary cannot understand version 2 and must never be restarted against a state file already written by the version-2 runtime.

## Export compatibility

Privacy export/import uses the separate `ynx-finance-export-v1` user-data format. It may restore user planning records only. It must never overwrite Explorer, Pay, Exchange, DEX, Quant, Economics, Wallet session or other source-owner evidence.

## Rollback rule

Restore is an offline operator action. Stop every Finance writer before restoring. The restore operation preserves the current raw state as a private `.pre-restore.<timestamp>` file, records that file's SHA-256 and byte count in the restore receipt, atomically installs the verified backup, reopens the result and rolls the live file back automatically if verification or receipt persistence fails.

To return to the preserved pre-restore state, keep the service stopped, compare the preserved file against the receipt hash and byte count, create and verify a fresh authenticated backup from that file in an isolated copy, then restore that verified envelope through the same admin command. Do not replace a live file with an unverified manual copy.
