# Backtest observed-bar idle cash sampling

Predecessor `7744f240470e4499dbaec808d4af8e2268a94bfb`.
Ordinary research calculation only, no shared authority/SDK/Host change.

AverageIdleCapital previously sampled cash only after fills, omitting warmup,
held positions, zero-volume observations and disclosed gaps. The sample now
occurs in the same recordEquity boundary used by every retained equity row.
Policy `observed_bar_cash_mean_truncate_micro_v1` is the signed integer mean of
observed post-decision cash micro-units, truncated toward zero. It is NOT an
elapsed-time-weighted average, interest-bearing cash yield or fee-inclusive
live portfolio valuation. Missing bars are not invented. Existing simulated
short-sale cash semantics are unchanged.

New optional attribution idleCapitalSamplingPolicy is omitted for legacy
records, so historical integrity representation and values remain unchanged.
No historical re-computation or SQL DDL. New receipts persist the policy/value.
Use a compatible reader/writer retaining this field after publication; an old
writer dropping new fields is not a safe data rollback. A release rollback
must preserve new records rather than rewriting them through an old schema.

Verification:

- Independent fixed-cost one-entry fixture: eight warmup observations plus
  held cash, zero-volume and gapped held observations; no-trade cash unchanged.
  Demonstrates a different result from fill-only sampling. File restart and
  legacy omission PASS. Focused tests PASS 0.876s.
- Full Go race suite PASS 3.050s; go vet and diff checks PASS.
- Native isolated PostgreSQL17.11 six mandatory gates twice =12PASS; actual
  database stop/start plus full regression107top-levelPASS. rows0|0,
  productionDatabaseUsed=false and terminal serverStopped=true.
- Runner --help is unsupported and failed at its explicit argument guard;
  actual QA was executed once with its required --postgres-bin-dir argument.

Retained PostgreSQL receipt:
`/private/tmp/ynx-quant-postgres-it-d1PQkP/receipt.json`
SHA256 `9dcf4b8ad4ffc14886dfed83419f64455872c49f688b5e279632fca44a1dfc86`.
Focused log SHA256
`257ff7e60d47936f80978c25b30f979943014034c7ce24f757e93d6e2650e2e3`.
Full log SHA256
`fdac164a28143781a7358ab8f05b86603d9a18c46a6fc43731248c017ad4cf62`.
Service source SHA256
`5f2948787e1cfb177006d4984ab5fdc6334ab055e11e7b8e29e6fb4bed96ecc6`.
Test source SHA256
`65dcafd2f3c8d863d8cb795921d21e7d9199a71bc24785090e639c4db213d20b`.

Source/test evidence does not prove public current-source runtime, actual
Wallet/private approval, installed acceptance or real Testnet execution.
Unique release owner must incorporate ordinary changes into its coherent
formal graph before publishing; do not use this older whole owner checkout.
