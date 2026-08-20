# YNX AI migration, backup, and compatibility contract

## Evidence boundary

YNX AI currently persists state with schema version `1`. This document describes the implemented local backup and restore controls. It does not claim a production migration, deployed backup schedule, multi-node recovery, achieved RPO/RTO, cross-region disaster recovery, or operator approval.

## State compatibility

| Component | Current version | Accepted on load/restore | Behavior for other versions |
| --- | ---: | --- | --- |
| Persistent product state | `1` | exactly `1` | fail closed |
| Backup envelope | `ynx.ai.state-backup.v1` | exact match | fail closed |
| Backup product binding | `ynx-ai` | exact match | fail closed |
| Backup cipher | `AES-256-GCM` | exact match | fail closed |

Older optional fields from schema version 1 are initialized to empty collections on load. Unknown JSON fields, unsupported versions, wrong product identifiers, malformed manifests, broken audit chains, and unauthenticated payloads are rejected.

A future state version must ship with an explicit forward migration, rollback policy, compatibility tests, and release evidence before this matrix is changed. YNX AI does not silently reinterpret unknown state.

## Backup format

The operator backup envelope contains bounded plaintext operational metadata only:

- backup schema and product identifier;
- random backup identifier;
- state schema version;
- UTC creation time;
- plaintext-state SHA-256 used after authenticated decryption;
- encrypted payload byte count;
- final audit sequence;
- cipher identifier.

The entire persistent state is inside an AES-256-GCM authenticated ciphertext. Wallet accounts, conversation metadata, prompts, messages, attachments, permissions, actions, sessions, appeals, and audit details are not written as plaintext in the backup envelope.

Backups are written as new immutable destinations with mode `0600`. Existing destinations are not overwritten. The backup path must be absolute and cannot equal the live state path. The content key is never written into the backup.

## Operator commands

Both commands require the same 32-byte content key used by the state file. Supply it through the existing secret-managed `YNX_AI_CLIENT_CONTENT_KEY`; do not place real keys in shell history, documentation, artifacts, or logs.

Create a backup and exit:

```sh
YNX_AI_CLIENT_STATE_PATH=/absolute/live/state.json \
YNX_AI_CLIENT_CONTENT_KEY='<secret-managed-value>' \
go run ./apps/ai -backup-create /absolute/backups/ynx-ai-2026-07-29.ynxbackup
```

Restore an authenticated backup into a fresh state path and exit:

```sh
YNX_AI_CLIENT_STATE_PATH=/absolute/restore-candidate/state.json \
YNX_AI_CLIENT_CONTENT_KEY='<secret-managed-value>' \
go run ./apps/ai -backup-restore /absolute/backups/ynx-ai-2026-07-29.ynxbackup
```

The command prints only the bounded manifest as JSON. It does not print state content or the content key.

## Restore safety

Restore performs all validation before changing the in-memory or on-disk target state:

1. bounded regular-file and strict-JSON validation;
2. schema, product, cipher, backup ID, timestamp, size, and checksum validation;
3. AES-GCM authentication using the manifest as associated data;
4. payload length and SHA-256 verification;
5. state schema and required collection validation;
6. audit hash-chain and sequence validation;
7. rollback rejection when the target contains a newer schema or audit sequence;
8. divergent-history rejection unless the target audit chain is an exact prefix of the backup chain;
9. replay rejection using the persisted backup ID ledger.

After validation, YNX AI appends a `state_restored` audit record and saves through the existing temporary-file, sync, and rename path. If persistence fails, the original in-memory state is restored. A successful restore survives process restart.

Because the application must open and validate its configured target state before executing an operator command, recovery from a corrupted live file must use a fresh target path. Do not point `-backup-restore` at a damaged state file.

## Recommended production procedure

The following procedure is a runbook proposal, not completed production evidence:

1. quiesce writes and record the source build SHA, state path, environment, and operator change ID;
2. create a new backup to an immutable destination;
3. compute and retain an outer-file SHA-256 in the controlled artifact system;
4. restore into a fresh candidate state path with the same secret-managed key;
5. launch a candidate process against that path and verify health, readiness, audit continuity, conversations, permissions, export, and deletion behavior;
6. perform the service-path switch as a separate reversible operator action;
7. preserve the previous state and deployment until the rollback window closes;
8. record measured backup duration, restore duration, data age, achieved RPO, and achieved RTO.

YNX AI does not automatically replace the live state path or perform an irreversible production cutover.

## Rollback and replay policy

- Restoring a backup whose audit sequence is older than the target is rejected.
- Restoring over a non-empty target whose audit history is not an exact prefix of the backup history is rejected, even when the target sequence is lower.
- A successfully applied backup ID cannot be applied again to that target, including after restart.
- Existing backup files cannot be overwritten by the backup command.
- Rollback to an older application/state schema requires a separately reviewed compatibility procedure; there is no force flag.
- Failed validation leaves the target unchanged.

## User export and service exit

An operator backup is not a user data export. User-facing conversation/account export and deletion remain separate authenticated product controls. A service-exit plan must preserve those user rights, publish retention timelines, and migrate or delete data according to accepted privacy and compliance policy; possession of an encrypted operator backup does not satisfy that obligation.

## Local evidence

The local test suite proves:

- encrypted round-trip backup and restore;
- no fixture account, conversation title, or message plaintext in the backup file;
- file mode and no-overwrite behavior;
- restart durability and restore audit continuity;
- wrong-key, manifest-substitution, ciphertext-tamper, unknown-field, replay, rollback, divergent-history, truncated-chain, and audit-chain-tamper rejection.

Shared-Testnet backup, staged restore, public service failover, achieved RPO/RTO, and disaster-recovery claims remain false until direct deployed evidence exists.
