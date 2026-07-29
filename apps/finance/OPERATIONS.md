# YNX Finance recovery operations

## Boundary

`ynx-finance-admin` manages the local Finance planning-state file only. It does not back up Wallet keys, provider credentials, Explorer facts, Pay receipts, Exchange/DEX assets or Quant execution state. The backup envelope is authenticated with HMAC-SHA-256 but is not encrypted; store it only on an encrypted, access-controlled backup volume.

Use a unique high-entropy `YNX_FINANCE_BACKUP_AUTH_KEY` of at least 32 bytes from the operator secret manager. Do not reuse Wallet, Pay, AI, cursor-signing or production service credentials. The command never prints the key.

## Create and verify a backup

The Finance service may remain running while creating a snapshot because the Store takes an in-process read lock. Use a destination different from the live state path.

```bash
export YNX_FINANCE_BACKUP_AUTH_KEY='<injected by secret manager>'
go run ./apps/finance/cmd/admin backup \
  --state ./var/finance/state.json \
  --output ./var/finance/backups/finance-state.backup.json

go run ./apps/finance/cmd/admin verify \
  --backup ./var/finance/backups/finance-state.backup.json
```

A valid backup is a mode-`0600` `ynx-finance-backup-v1` envelope containing a versioned manifest, canonical state, SHA-256, byte count, record counts, creation time and authentication tag. Verification rejects an altered format, manifest, state, authentication tag, future timestamp, unsupported version, oversized file or unknown field.

## Restore drill

Restore is destructive and must be offline. Stop every Finance process that can write the state file before continuing; otherwise an older in-memory Store could later overwrite the restored disk state.

1. Copy the backup and authentication key into an isolated recovery environment.
2. Verify the backup.
3. Restore into a temporary state path.
4. Start the Finance API against that temporary path and verify health, account-scoped planning reads, Wallet nonce replay protection and export.
5. Stop the drill API and retain the command output and restore receipt as local evidence.

```bash
go run ./apps/finance/cmd/admin restore \
  --state ./var/finance/recovery-drill/state.json \
  --backup ./var/finance/backups/finance-state.backup.json \
  --confirm 'RESTORE FINANCE STATE'
```

## Live restore

Only after an isolated drill passes:

1. stop and verify all Finance writers are stopped;
2. verify the selected backup again;
3. record the current state file size and hash;
4. run the restore command against the live state path;
5. inspect `<state>.restore-receipt.json`;
6. confirm the restored SHA-256 equals the backup manifest SHA-256;
7. confirm the preserved `.pre-restore.<timestamp>` file matches the receipt's previous-state SHA-256 and byte count;
8. cold-start the service and run health, authenticated overview, export and negative authorization checks;
9. retain the backup, receipt and pre-restore file according to the approved retention policy.

The restore implementation writes through a private temporary file, synchronizes file and directory data, atomically renames the result, reopens the state and automatically returns to the pre-restore state if post-write verification or receipt persistence fails.

## Failure handling

- Authentication, integrity or version failure: do not modify the live state; isolate the backup and investigate its origin.
- Receipt mismatch: keep the service stopped and compare files against the receipt before any retry.
- Lost authentication key: the backup is intentionally unusable; never bypass verification. Recover from another independently verified backup.
- Suspected disclosure: rotate the backup key, create a new verified backup, revoke access to old storage and retain incident evidence.
- Restore failure after a pre-restore copy exists: verify that copy against the receipt or local hash evidence, then use the authenticated rollback process in `MIGRATION_COMPATIBILITY.md`.

No deployed restore drill, remote RTO/RPO result or production backup policy acceptance is claimed by this local runbook.

## Runtime observability

The Finance API emits one JSON access record per completed HTTP request. Records contain only timestamp, service/version, request ID, method, matched route pattern, status, duration and stable error ID. They intentionally exclude authorization headers, Wallet accounts, request bodies, query strings, balances, activity, notes, budgets and remote addresses.

Clients may supply `X-Request-ID` using 8–128 characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, and `-`. Invalid or absent IDs are replaced with a generated `fin_...` value. Error responses include the same request ID plus a stable `YNX-FIN-*` error ID in both JSON and `X-Error-ID`.

`GET /metrics` is an operational endpoint protected by `X-YNX-Operations-Key`. Supply a unique high-entropy `YNX_FINANCE_OPERATIONS_KEY` of at least 32 characters from the operator secret manager. Do not reuse Wallet, Pay, AI, cursor, backup or production signing credentials.

The `finance-metrics-v1` response contains process-scoped request counts, status classes, latency buckets, source availability outcomes, process instance ID, start time and uptime. Counters reset on every process restart and do not claim persistence or central Monitor ingestion. The payload contains no user financial data.

```bash
curl --fail --silent \
  -H "X-YNX-Operations-Key: ${YNX_FINANCE_OPERATIONS_KEY}" \
  http://127.0.0.1:6436/metrics
```

For incident correlation, search structured logs by `requestId` and then use the stable `errorId` to group the failure class. Never ask a user to send an authorization token, full financial response or state file as troubleshooting evidence.
