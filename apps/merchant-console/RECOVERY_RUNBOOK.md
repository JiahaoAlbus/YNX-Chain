# Backup, restore and rollback runbook

## Invariants

- Never copy or restore an unverified store.
- Never pass the integrity key on the command line or write it to evidence.
- Never restore while the product service holds its operation lock.
- Never overwrite an existing backup archive.
- Never overwrite current state without confirming its exact SHA-256.
- Preserve a rollback copy before replacement and verify the restored state independently.

## Backup

Set `YNX_PAY_PRODUCT_INTEGRITY_KEY` through the approved secret injection path, then run:

```sh
go run ./internal/payproduct/cmd/ynx-pay-product-recovery backup \
  --store "$STATE_FILE" \
  --out "$NEW_BACKUP_FILE" \
  --source-commit "$SOURCE_COMMIT"
```

The command emits a versioned manifest containing Backup ID, exact source commit, state SHA-256, bytes, snapshot version and record counts. It emits no secret or local path.

## Independent verification

```sh
go run ./internal/payproduct/cmd/ynx-pay-product-recovery verify \
  --backup "$BACKUP_FILE"
```

Both the archive HMAC and nested state-envelope HMAC, source hash, byte count and snapshot version must pass.

## Restore

1. Stop the service gracefully and confirm the operation lock is absent.
2. Hash the current destination independently.
3. Restore only with that exact confirmation:

```sh
go run ./internal/payproduct/cmd/ynx-pay-product-recovery restore \
  --backup "$BACKUP_FILE" \
  --store "$STATE_FILE" \
  --expected-current-sha256 "$CURRENT_SHA256"
```

Use the literal `absent` only for a new destination. The command creates a rollback file beside an existing destination, atomically replaces state, reopens and verifies it, then emits before/after hashes and the rollback filename.

## Failed restore or rollback

Do not restart the service if verification fails. Preserve the failed destination and all evidence. Verify the automatically created rollback file, then use the same guarded restore procedure with a separately verified backup archive constructed from that rollback state. Escalate any changed lock ownership or HMAC failure as a security incident.
