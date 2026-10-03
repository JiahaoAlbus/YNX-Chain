# Cross-instance Paper Kill switch / in-flight fence

Predecessor 1c5c833ce9dc2713f5a5915052a8ab891f966ed5. Local actual PostgreSQL
storage evidence only; no public/provider approval or capital execution claim.

Added TestPostgreSQLPaperKillFencesInFlightMarketAndSurvivesRestart using real
PostgreSQL and two independent service instances in one unique namespace.
Controlled market adapter holds a new request in flight. The first instance
persists Kill switch before that adapter returns; the stale second instance
must reload durable state and reject ErrForbidden without a new Paper order.
An independently opened service retains Kill switch. A pre-kill idempotent
receipt replays even with no market adapter, but new lower-level submissions
remain forbidden and Paper state is byte-equivalent before/after those reads.
This checks an actual storage fence, not a fabricated market/execution result.

Runner now requires all five PostgreSQL tests twice, plus all five again during
the full suite after real database stop/start. Actual result: 10 focused passes,
101 full-regression top-level passes; Quant 2.770s/readintegration1.287s with
race enabled. Optional NodeHost browser fixture remains SKIP in this invocation
and has its own executed evidence in the preceding checkpoint. No database
test skipped. Vet, Node syntax and diff whitespace PASS.

Receipt `/private/tmp/ynx-quant-postgres-it-24Frtg/receipt.json` SHA256
`b5b095f4954db00650571a0cf870d2ef634a24468316247aea98a05c65e1d468`.
Focused log SHA256
`48e80dd3de7b1a2f6334e8c3b70b3859af2d415585c031a75a4fe4e6b289ce50`.
Full log SHA256
`d8b7c489bbaaad22b203feff702a84834a371a1e49f6c87f5d791e3e149264d6`.
Terminal: serverStopped=true, databaseRestartVerified=true,
productionDatabaseUsed=false, remainingRows=0|0.

## Explicit remaining risk gap

`applyPaperSignalLocked` declares RiskLimits.MaxDailyLoss=1_000_000_000 but
does not check it. Testnet's separate mandate risk predicate DOES compare the
provided ObservedDailyLoss; that does not prove Paper daily-loss enforcement.
Paper currently lacks a durable daily marked/realized loss ledger. Do not claim
complete daily-loss controls or silently substitute research drawdown for it.
This checkpoint changes tests only, not permissions or capital execution.
The next ordinary implementation needs a truthful defined Paper loss model,
day boundary, persistence/restart and multi-instance tests, UI explanations,
and explicit distinction from fee/slippage-free local simulation.
