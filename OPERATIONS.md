# YNX Exchange operations

Runtime evidence commit: `42f2f48e1ecc3816337d4c6f83ab4cf230f4a01d`.

## Start and inspect locally

Required configuration includes an approved 16+ character admin credential supplied by the deployment platform and a writable state path. The server binds to loopback by default. Gateway, custody and Indexer absence is reported honestly rather than emulated.

```bash
go run ./apps/exchange/server
curl -fsS http://127.0.0.1:6442/api/health
curl -fsS http://127.0.0.1:6442/api/ready
curl -fsS http://127.0.0.1:6442/api/metrics
```

Credentials must be supplied through the approved deployment mechanism and must not be copied into shell history, chat or tickets.

## Backup and restore

The authoritative state is the configured Exchange state path. Stop writes or enter a reviewed maintenance boundary, copy the mode-`0600` state file to encrypted storage, compute SHA-256, record source commit/schema/size/time/operator, and verify the copy by starting a non-public process against a restored copy. Never edit state JSON by hand.

Local direct drill `TestBackupRestoreDrillPreservesCommittedExchangeState` creates deposits, balances, orders, a fill and ledger/audit/event chains; captures exact bytes and SHA-256; mutates later state; restores the backup; restarts; verifies snapshots, trade/order state and ledger conservation. This proves the local file procedure only—not remote backup retention, encryption, access control or RTO/RPO.

```bash
go test ./internal/exchangeproduct -run TestBackupRestoreDrillPreservesCommittedExchangeState -v
```

Rollback to any binary that does not understand schema v9 is unsafe after a v9 write. See `MIGRATION_COMPATIBILITY.md`. Preserve the failed/new state before rollback and reconcile pending dead-man, conditional, OCO, TWAP, iceberg, scale, Quant nonce-domain control and stream consumers. Real historical v2–v7 byte compatibility is not claimed without immutable fixtures.

## Incident response

1. Stop new writes at ingress; preserve reads only if integrity remains valid.
2. Capture `/health`, `/ready`, `/version`, `/metrics`, process logs, source SHA, state SHA-256 and deployment identity without exposing user payloads.
3. If integrity/readiness fails, isolate the state file and do not auto-repair or overwrite it.
4. Notify users with known impact, authoritative scope, time and next update. Never claim funds, fills or recovery without ledger/chain evidence.
5. Restore only a verified backup to a non-public process; reconcile balances, reservations, Quant control state, sequence, fills and external deposits before reopening.
6. For market shutdown, mass-cancel/dead-man releases native reservations; withdrawals remain reviewed pending operator broadcast until an authoritative adapter exists.

## Support, disputes and exit

The product persists support cases, account audit and transaction/order evidence. Refund/dispute adjudication, public status page, staffed escalation and production withdrawal broadcast are not implemented. Cases involving unauthorized access require Gateway/session revocation and evidence preservation. Cases involving execution use the signed authorization digest, order lifecycle, trades, fees, sequence and audit chain.

Service cessation requires advance notice, disabling new deposits/orders, cancelling and releasing open/scheduled orders, preserving export access, reconciling liabilities, providing an approved asset-exit path, retaining required audit evidence and publishing final status. Public solvency and withdrawal-capacity proof are still missing, so cessation readiness is not achieved.

## Validation gates

Run race tests, vet, Web/Mobile tests, browser smoke, migration and restore tests, dependency/SAST scans, artifact verification and source-bound capacity tests. Staging/public status remains false until immutable URL, runtime commit, monitoring, backup and public acceptance evidence all pass.
