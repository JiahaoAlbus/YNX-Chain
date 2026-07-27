# YNX Card Operations

Source commit: `01415dc4413dd8d4e33756a52682ca0f2a6675ec`

## Operator boundary

The recovery CLI requires `YNX_CARD_PRODUCT_STORE` and `YNX_CARD_PRODUCT_INTEGRITY_KEY`. The key must be supplied through approved secret infrastructure as 32+ byte hex or raw base64. Never place it in Git, logs, screenshots, support tickets or chat.

```text
ynx-card-product-admin backup <absolute-output>
ynx-card-product-admin verify <absolute-backup>
ynx-card-product-admin restore <absolute-backup> <absolute-rollback-or-quarantine>
```

## Backup

- Use a distinct absolute destination.
- Existing destinations are never overwritten.
- Output is created with mode `0600` and file/directory sync.
- Record the returned schema version, snapshot SHA-256 and byte count outside the backup file.
- A local backup is not evidence of encrypted off-host protection.

## Verify

Run `verify` before every restore and after copying a backup. Verification checks envelope/schema, HMAC, payload digest, size, state version, map indexes and audit-chain continuity.

## Restore

Stop Card writes before offline restore.

- Valid primary: a verified rollback backup is written first.
- Corrupt primary: original bytes are preserved unchanged as the requested quarantine path and its SHA-256 is returned.
- Missing primary: cold restore creates a new primary and does not fabricate a rollback artifact.
- Failed post-write verification restores the original primary bytes when they existed.

After restore, open the state with the Card service, run `/health`, `/ready` and `/version`, then execute the Card smoke tests before reopening writes.

## Unfinished operational gates

Scheduled encrypted off-host backups, retention enforcement, timed RPO/RTO evidence, account-scoped export/delete, alerting and centralized incident integration remain open. This document does not claim those controls are complete.
