# Finance-suite write precondition contract — 2026-08-31

Status: source-tested shared protocol only. This is not an order, swap,
liquidity, strategy, Wallet approval, signature, or Testnet execution result.

## Purpose

`@ynx/finance-domain@1.0.0-candidate.4` makes the shared write boundary
executable before any product-owned effect can be attempted. It is deliberately
pure: it has no database, no Wallet access, no network access, and cannot
create a financial action.

## Required persisted write boundary

Every product-owned write must provide:

- `requestId`, for trace correlation;
- `idempotencyKey`, unique for the caller's logical action;
- `expectedVersion`, the optimistic-concurrency version the user reviewed; and
- `requestDigest`, a lowercase SHA-256 of the UTF-8 RFC 8785 JCS canonical
  action-intent JSON, excluding headers and transport metadata.

The product service must atomically persist its actual effect and the
idempotency record `{idempotencyKey, requestDigest, resourceVersion, outcome}`
in its shared database. A duplicate key can replay only when its digest is
identical. A new request with a stale `expectedVersion` fails with
`FIN_CONCURRENT_MODIFICATION`; a reused key with different intent fails with
`FIN_IDEMPOTENCY_CONFLICT`. No process-local map is sufficient for this
contract.

## Order-state boundary

The domain package exposes the allowed transition graph:

```
pending -> open | cancelled | rejected | execution_unknown
open -> partially_filled | filled | cancelled | expired | execution_unknown
partially_filled -> filled | cancelled | expired | execution_unknown
execution_unknown -> open | partially_filled | filled | cancelled | rejected | expired
```

`filled`, `cancelled`, `rejected`, and `expired` are terminal. A timed-out or
ambiguous action is represented as `execution_unknown`; only an authoritative
product reconciliation may move it to a known result. The helper rejects
invalid transitions, but it does not replace the product's durable state
machine or reconciliation worker.

## Consumer integration

- Exchange uses this boundary around order placement/cancel/matching state.
- DEX uses it around approval, swap and liquidity intent persistence, while
  retaining the Strategy Vault v1.35 custody and mandate boundary.
- Finance remains read-only until it has a separately approved write product.
- Quant uses it only for Paper/Testnet strategy lifecycle actions after the
  strategy engine's own risk and kill-switch checks.

Products must retain their preview, fee/risk explanation and explicit user
confirmation requirements; precondition success does not authorize any of
those steps.

## Strategy risk guard

Before a Quant, Exchange or DEX product service persists a strategy-owned
action, it must call `assertStrategyRiskAuthorization` with the source-bound
`Strategy`, `RiskLimit`, requested notional, requested slippage, evaluation
time, and an explicit product-owned `maxRiskSourceAgeMs` policy (1 ms through
24 hours). The guard requires matching owners, a `paper` or `testnet`
lifecycle, live non-reference Strategy/RiskLimit provenance, an `asOf` no
later than the evaluation and within that freshness window, an unexpired
limit, `killSwitch=false`, and exact base-10 limits.
It deliberately does not execute a strategy, connect a Wallet or access a
credential.
