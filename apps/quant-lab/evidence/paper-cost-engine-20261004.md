# Quant opt-in Paper cost engine — not yet browser/API enabled

Source commit `e4f61eaa5f975f68e455554559c33857e72f8af3`, tree
`1457b977f7ff49ea56026eaf2988def92ad06e97`.

## Actual implementation

`SubmitPaperSignalWithCostsFromMarket` adds an explicit per-request simulation
assumption `adverse_price_ceil_fee_micro_v1`; the existing HTTP handler and UI
continue using legacy zero-cost submission until preview/confirmation integration
is complete. This is an engine implementation, NOT completed Paper product work.

In integer micro-units, V1 computes buy execution price as ceil(reference price
times (10000 + slippageBPS) / 10000), sell as floor(reference price times
(10000 - slippageBPS) / 10000). Actual filled quantity retains the original
10-percent observed-volume cap. Buy notional rounds up, sell rounds down;
fee = ceil(executed notional times feeBPS / 10000). Cash deducts buy notional
plus fee, or credits sell notional minus fee. Fee is zero for zero fill.
Fee BPS range is 0..10000, slippage range 0..9999. These are test simulation
assumptions, not a claim about venue pricing/fees or real liquidity.

Requested adverse notional plus fee is checked against the original order risk
limit before settlement; all intermediate monetary arithmetic uses math/big,
with representability checks before risk/sequence/audit/state mutation. Position,
kill, daily marked-loss, strategy ownership and durable lock boundaries remain.
Daily marked equity includes prior settled costs. V1 is not claimed numerically
identical to the separate backtest cost approximation.

Receipts retain reference Price/market attribution and separately store policy,
rates, execution price, executed notional and fee. Scalars use omitempty so old
absent-cost receipt serialization/integrity remains unchanged. Old callers use
the existing zero-cost path; explicit V1 with zero BPS still uses V1 rounding.
Idempotency binds policy and rates; changed cost model conflicts. Exact recovery
replays the persisted receipt without a feed or an additional cost charge.

## Executed local evidence

- `go test -race ./internal/quantlab -run 'TestPaperCost' -count=10` PASS 1.996s
  (before the added two-instance concurrency case).
- `go test -race ./internal/quantlab ./apps/quant-lab/server -count=1` PASS
  6.148s / 1.895s, including all original tests and the new two-instance case.
- New tests cover both sides, tiny-quantity rounding, zero fill, explicit zero
  versus legacy, invalid bounds/policy, overflow with unchanged state/audit,
  partial-fill cash settlement, persistence/restart/offline exact recovery,
  changed-model/legacy same-key conflicts, and 12 concurrent same-key calls
  across two original file-backed service instances charging only once.
- `gofmt` and `git diff --check` PASS. No new PostgreSQL execution was configured.

## Required continuation

Wire explicit model selection through the owned API and browser preview,
disclose rates/rounding/slippage assumptions and exact simulated costs before
confirmation, bind model across confirm/pending persistence/retry, validate
cost-bearing receipt consistency, and display executed amounts. Preserve old
pending intents without silently upgrading them. Then run real local browser
flows, tenant/concurrency/restart tests, and request A's matching formal runtime
publication. No generated/shared SDK/build/Host/deploy edits in this checkpoint.

Public/installed/business/provider/sign/Testnet transaction/Product Session
completion remains unproven. No real funds, account prompts or production writes.
