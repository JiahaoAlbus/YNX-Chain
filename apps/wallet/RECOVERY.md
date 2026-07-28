# Wallet and Gateway recovery

Source-bound Gateway backup runtime: `c4e476dc52e40ae4c895503a9ed0b756b1884f77`.

## Mobile Wallet boundary

Wallet account recovery uses the native account backup confirmation and replacement-device recovery path already exercised by `walletRepository.test.ts`. It reconstructs only the native account. Product Sessions, product-device signing keys, approval state, replay caches and local authorization audit records are deliberately not copied between devices; the replacement device must re-authorize each App and the old device must be revoked through the canonical Gateway lifecycle.

The repository stores only the selected account manifest in ordinary storage. Account material remains in the platform secure store. Recovery words or equivalent account recovery material must never be pasted into support, logs, analytics or a product App.

## Canonical Gateway encrypted backup

The Node-only `@ynx-chain/wallet-auth/gateway-backup` surface and `ynx-wallet-gateway-backup` CLI create, verify and restore the complete canonical Gateway state envelope. The encrypted payload preserves Product Sessions, approvals, devices, revocations, logout cutoffs, StrategyMandates, audit state and consumed Product Session proofs atomically.

The current local protocol is:

- canonical backup envelope schema v1 over canonical Gateway state schema v1;
- AES-256-GCM with a fresh 96-bit IV and authenticated metadata;
- exact 32-byte operator-provided key; the repository does not derive, store or print it;
- source state and backup files mode `0600` in non-symlink directories mode `0700`;
- symbolic links and files with multiple hard links rejected;
- exclusive backup creation and exclusive restore target; existing files are never overwritten;
- file and parent-directory `fsync` before success is returned;
- offline authentication and state-digest verification before restore;
- optional `minimumCreatedAt` rollback floor and `maxAgeMs` recovery-point policy;
- future, stale, wrong-key, malformed and tampered backups fail closed.

### Operator commands

Supply the key through the process environment or an injected secret file translated by the process supervisor. Do not pass it as a command-line argument, commit it, print it, or paste it into chat.

```sh
install -d -m 700 /secure/runtime/ynx-wallet-gateway/backups

YNX_WALLET_GATEWAY_STATE_PATH=/secure/runtime/ynx-wallet-gateway/state.json \
YNX_WALLET_GATEWAY_BACKUP_PATH=/secure/runtime/ynx-wallet-gateway/backups/gateway.backup.json \
YNX_WALLET_GATEWAY_BACKUP_KEY_BASE64URL='<32-byte canonical base64url value from the secret manager>' \
ynx-wallet-gateway-backup create
```

Verify offline before opening a restore target:

```sh
YNX_WALLET_GATEWAY_BACKUP_PATH=/secure/runtime/ynx-wallet-gateway/backups/gateway.backup.json \
YNX_WALLET_GATEWAY_BACKUP_KEY_BASE64URL='<injected by the secret manager>' \
YNX_WALLET_GATEWAY_BACKUP_MINIMUM_CREATED_AT='2026-07-27T15:00:00.000Z' \
YNX_WALLET_GATEWAY_BACKUP_MAX_AGE_MS=300000 \
ynx-wallet-gateway-backup verify
```

Restore only while the Gateway writer is stopped, into a new absent path:

```sh
install -d -m 700 /secure/runtime/ynx-wallet-gateway/restore

YNX_WALLET_GATEWAY_STATE_PATH=/secure/runtime/ynx-wallet-gateway/restore/state.json \
YNX_WALLET_GATEWAY_BACKUP_PATH=/secure/runtime/ynx-wallet-gateway/backups/gateway.backup.json \
YNX_WALLET_GATEWAY_BACKUP_KEY_BASE64URL='<injected by the secret manager>' \
YNX_WALLET_GATEWAY_BACKUP_MINIMUM_CREATED_AT='2026-07-27T15:00:00.000Z' \
YNX_WALLET_GATEWAY_BACKUP_MAX_AGE_MS=300000 \
ynx-wallet-gateway-backup restore
```

After restore, start the exact source-bound Gateway against the new path, compare `/version` to the approved release, confirm `/ready`, execute replay/revoke/tamper probes, and retain the old state and backup as read-only incident evidence until acceptance. Never restore over a running or existing state path.

## Evidence and remaining boundary

`proof/gateway-backup-restore-local-2026-07-27.json` records 99/99 Wallet/Auth tests, 5/5 backup tests, exact non-empty state recovery, consumed-proof replay rejection after restore, wrong-key/tamper/permission/rollback failures and a 20-sample local performance drill. The performance fixture is intentionally an empty local Gateway state; it is regression evidence, not production capacity.

No central App Gateway deployment, remote immutable backup store, cross-region replication, production KMS/HSM, production restore drill or production RTO/RPO is claimed. Those states remain false until direct operator and central-owner evidence exists.
