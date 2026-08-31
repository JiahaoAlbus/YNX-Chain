# Strategy-risk freshness contract handoff — 2026-08-31

## Owner checkpoint

This source-only checkpoint is commit
`c56295e260f7a58bed4ab140ae1ba97a4a8946ae`, tree
`e221ddf21902662780ad9b71679d1a019320f62c`, on
`codex/final-finance-suite`.

It supersedes the candidate.3 strategy-risk boundary with
`@ynx/finance-domain@1.0.0-candidate.4`. It does not grant a Wallet session,
sign an intent, start a strategy, place an order, or change a deployed service.

## Contract change

`assertStrategyRiskAuthorization` now requires a product-owned
`maxRiskSourceAgeMs` between 1 ms and 24 hours. A strategy-owned Paper or
Testnet action is rejected unless both Strategy and RiskLimit inputs:

- have matching owners and a live source status;
- are classified `authoritative`, `verified-index`, or `testnet`, never
  `reference`;
- have `source.asOf` at or before `evaluatedAt`; and
- are no older than the explicit freshness policy.

Existing kill-switch, expiry, lifecycle, exact-decimal notional, and slippage
limits remain mandatory. The helper stays pure and cannot produce a financial
effect by itself.

## Immutable inputs

| Path | SHA-256 |
| --- | --- |
| `packages/finance-domain/src/index.js` | `96a11875be327e7587a6b513e992841b183c942fb2e659662bd1e4352b1bc15b` |
| `packages/finance-domain/src/index.d.ts` | `5c965e8775a6662d88fa1375828c9325bc11f59f2f3c4c17b0a7fb9e7c2d9fbe` |
| `packages/finance-domain/package.json` | `399776f8d30c0de70576775d2857141cfbf3464c354d24760a991a1020d8be05` |
| `packages/finance-domain/test/domain.test.mjs` | `fe3a578cfe33f9642b8dc10d2a879c862023d664e9e35b421bf0912aa1c1a6c5` |
| `release/integration/finance-suite-domain-contract-v1.json` | `f0655d9353bb4eca02a6f619b764e23d2c7b8eb257520f0fa4ebecf880eca55a` |

## Local verification

`npm test --prefix packages/finance-domain` passed 12/12. The regression
matrix covers exact-decimal bounds plus stale, future-dated, reference-class,
and invalid-freshness-policy rejection.

## Central integration boundary

Consumers in DEX, Exchange, and Quant must pass their product-specific
freshness policy immediately before durable strategy effects. Central must
accept this source contract before any product treats it as an execution gate.
All public deployment, installed-runtime, provider approval, Product Session,
strategy execution, and Testnet order flags remain false.
