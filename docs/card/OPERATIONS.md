# YNX Card Operations

Source commit: `d79872f5df4da0566e11ef40e5314ea68d9846f4`

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

## Account data lifecycle

- `GET /v1/account/export` returns an account-scoped `ynx.card.account-export.v1` projection. Provider application/card/event references and request/trace correlation identifiers are removed; the exported audit projection is rehashed after redaction.
- `POST /v1/account/retention` applies bounded retention to notifications, AI drafts, account idempotency entries, expired Gateway nonces, orphan provider replay records and expired deletion receipts. It does not delete Card or financial event records.
- `DELETE /v1/account/data` requires the exact confirmation `DELETE YNX CARD DATA`, a valid idempotency key and the dedicated `card:data:delete` Gateway scope. The service closes every non-closed provider Card before local deletion. Any issuer closure error aborts local deletion.
- Successful deletion removes account-owned Card records and raw provider identifiers, pseudonymizes matching audit subjects, rebuilds audit hashes and stores a bounded idempotent deletion receipt. The HTTP response omits the internal idempotency digest.
- Reapplication removes the prior deletion receipt and starts a new lifecycle. Do not bypass the service with direct state-file edits.

## Default bounded retention

| Record class | Default maximum age |
|---|---:|
| Notifications | 90 days |
| AI runs | 30 days |
| Account idempotency records | 30 days |
| Orphan provider replay records | 400 days |
| Deletion receipts | 30 days |

## Unfinished operational gates

Scheduled encrypted off-host backups, scheduled retention invocation, central privacy-workflow acceptance, timed RPO/RTO evidence, alerting and centralized incident integration remain open. This document does not claim those controls are complete.
