# Paper daily marked-loss enforcement

Predecessor: 5af2db3f71a0dde2c8c225d6210197b6fe972ed6.
Source/local QA only. No production, shared authority, capital execution,
formal asset pins or permission grant modified.

Previously Paper declared MaxDailyLoss but did not check it. Now the existing
durable write/reload boundary marks cash + open position at the actual supplied
market price before any new Paper order. Exact integer arithmetic uses wide
intermediates and rejects out-of-range values. Limit is the existing
1_000_000_000 YUSD_TEST_MICRO (1000 YUSD_TEST). It is NOT a real account loss,
cost-inclusive forecast or continuously monitored midnight portfolio value.

Policy `utc_first_mark_equity_loss_micro_v1`: first accepted mark on each UTC
day establishes opening equity. Negative change is daily marked loss. At the
inclusive limit, persist a same-day breach and audit but create no order;
subsequent price recovery/restart cannot clear that day's breach. A new UTC day
uses its first accepted mark, but does not clear an independent Kill switch.
Unknown policy, malformed date, clock rollback to a prior day or overflow
fails closed. Existing idempotent receipt replay remains a read with no new
execution/mark. Fee/gas/slippage model is still absent and disclosed.

New optional `PaperState.DailyRisk` stores policy/day/opening and marked
equity/loss/limit/breached/observedAt. Legacy nil fields remain omitted to retain
their integrity representation; historical baselines are not backfilled.
After new records exist, use a compatible reader retaining the field. Do not
roll back through an old writer that drops it or reset risk state during deploy.
No relational DDL migration is needed (existing durable JSON state column).

The Paper inspector and pre-submit confirmation explain this model in all12
languages, default English. Old/unknown/malformed receipts display unavailable
rather than invented zero loss. Browser preview does not guarantee a new market
price; backend state reload and limit checks remain authoritative.

## Verification

- File and actual PostgreSQL tests: exact threshold, two independent instances,
  restart persisted latch, price recovery, next UTC day baseline, manual Kill
  unchanged; checked short valuation/overflow/clock rollback/unknown policy and
  legacy omission tests PASS.
- Six mandatory PostgreSQL gates twice:12PASS, no database SKIP. Actual DB
  stop/start then full race suite104top-levelPASS (2.852s/1.293s). Optional
  NodeHost bridge remains SKIP in the Go-only invocation and ran separately.
- Actual local Hosted/Gateway/Go cross-service browser gate1/1PASS/0SKIP8.179s.
- Business model54/54PASS; actual Chrome desktop/mobile browser21/21PASS46.564s.
- vet, Node syntax, diff whitespace PASS.
- Full npm64 cases:63PASS/1FAIL at retained
  `QUANT_ASSET_HASH_MISMATCH:styles.css`. Not waived. Unique release integrator
  must incorporate all ordinary inputs and freeze the complete graph, including
  this app.js change, before any formal publication.

Actual QA receipt `/private/tmp/ynx-quant-postgres-it-b5VVlq/receipt.json` SHA256
`afb3afdfd021d2f9cc627435952917667085be18e0660038b5945339b65d5249`.
Focused log SHA256
`e30e9dbd164e29696163b78b501fad17d4af49dee24e82f81e8c32eacb3a6d57`.
Full log SHA256
`481601341948dac1c7a9c4b8bc04e1e469661a30fee37c4834ca5b3d694bf745`.
Terminal serverStopped=true/databaseRestartVerified=true/rows0|0/productionDB=false.

Ordinary service source SHA256
`a2fd4624e59e41cb1a25fa90c7e7f5f982b8b2359c3a780c394bfc209781f479`.
Ordinary app.js SHA256
`f24f87803865f26d5e98b4e90f102ecb6be369ad770f7b609d18c034da0687f6`.
Unproven public source binding, real provider/private-session approval and
installed/real Testnet product acceptance remain false.
