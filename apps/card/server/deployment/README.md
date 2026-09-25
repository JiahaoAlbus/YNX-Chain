# Card persistent service preparation

This is an operator deployment template, not an installed/public service receipt.
Current environment: YNX Testnet card payment simulation. No real-world payments.

- Host runtime observed on 2026-09-12: `/usr/bin/node` v22.23.1; user `ynx`; no installed `ynx-cardd.service`.
- Freeze exact Card source under `/opt/ynx-card/releases/<source>/apps/card`, and bind `/opt/ynx-card/current` to that release only after runtime verification.
- Run `ynx-cardd.service` as `ynx`, binding only `127.0.0.1:18740`, with durable `/var/lib/ynx-card` (0700) and encrypted SQLite (0600).
- Root-managed `/etc/ynx-card/runtime.env` must be 0600, outside Git, and contain exact `YNX_CARD_SOURCE_COMMIT`, the separately protected 32-byte storage key `YNX_CARD_STATE_KEY_BASE64`, `YNX_CARD_AUTH_ADAPTER_MODULE` pointing at the accepted shared Session authentication consumer, accepted `YNX_CARD_CORE_RPC_URL`, operator-assigned `YNX_CARD_TESTNET_FUNDING_ADDRESS`, and `YNX_CARD_MIN_CONFIRMATIONS` (at least 2).
- No Wallet private key is required or accepted. No credentials or storage key belong in evidence. The storage key must survive restart and be backed up separately from database snapshots.
- Preflight prevents an unconfigured stub from starting as the deployed service. It is not a substitute for real Session/approval/chain verification.
- The authentication module must be the release's own `server/sharedWalletAuth.ts`, which consumes exact Wallet SDK `6f332753baae5deaf6b05c8276b20a02cc4887c5`. The service entry rejects replacement modules. The coordinator-assigned service RPC is `https://rpc.ynxweb4.com`; it is never supplied by an HTTP request.
- Callers send the restricted `X-YNX-Card-Platform: web`, `android` or `ios` header and a fresh SDK-produced V2 proof. This only selects a preconfigured authorizer; it grants no identity. The accepted 6f contract permits an absent Origin on read-only Web GET; Web writes still require exact Origin, and any supplied wrong Origin is rejected. Never fill Origin from an untrusted forwarded header. UI/private-session integration still needs direct runtime evidence.
- Shared Caddy remains coordinator-owned: preserve `/api/card/v1/...` and add only the exact Card route to this loopback service after readiness. No Vercel rewrite or shared Caddy setting is changed by these files.

## Migration, backup and restore

Version 0 is the previous unversioned encrypted format. Startup migrates it atomically to `PRAGMA user_version=1` without rewriting encrypted owner bodies or global funding claims. Unknown versions and malformed tables fail closed. Do not edit `user_version` in production to bypass this guard.

While the service runs, use the Node SQLite online backup, not `cp card.sqlite` (which can omit WAL commits):

```sh
node server/backup-main.ts /var/lib/ynx-card/card.sqlite /PRIVATE_EXISTING_BACKUP_DIRECTORY
```

Each attempt creates a unique 0700 directory, a 0600 database and completed `backup.json` containing bytes/SHA and SQLite integrity status. A partial directory without a completed receipt is not a usable backup. The receipt does not claim decryption or ledger reconciliation.

To recover, stop only `ynx-cardd`, preserve the existing database plus WAL/SHM, validate the backup SHA, and restore into a new private data directory with the separately retained same storage key. Verify decryption, owner isolation, ledger reconciliation and global transaction deduplication before moving the recovered directory to `/var/lib/ynx-card` and restarting. Never mix a restored database with stale WAL/SHM files, delete funding claims, or reset balances. A schema-incompatible code rollback requires a compatible data snapshot; never downgrade the schema marker by hand.

## Rollback boundary

Keep previous immutable release path and its recorded source. Stop only this service, preserve state, select the previous compatible release, then restart and read `/version` plus authenticated business state before enabling traffic. Website/PWA rollback and shared Caddy updates remain separate operations. Do not infer a public or installed lifecycle pass from a service start, test fixture, backup receipt or HTTP 200.
