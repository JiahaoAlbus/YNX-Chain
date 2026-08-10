# YNX Exchange unit economics

Status: planning model, not observed public economics. Date: 2026-07-22. Currency: USD unless stated otherwise.

## Cost model

Monthly cost is:

`infrastructure + storage/backup + observability + Gateway/indexer/provider + support + security/compliance + artifact distribution + Testnet subsidy`

Cost per monthly active trader is `monthly cost / monthly active traders`. Cost per executed order is `(variable execution cost + allocated fixed cost) / actual fills`. Both denominators must come from authoritative Exchange events with bot/test/internal traffic labeled and excluded from user-growth claims.

No approved hosting vendor, region, support contract, provider credential or public workload currently exists, so current actual monthly cost and gross margin are **unavailable**. Quoting a vendor price before those choices would be false precision.

## Review scenarios

The following are explicit planning assumptions, not invoices or forecasts:

| Scenario | Monthly active traders | Orders/month | Fixed cost budget | Variable budget | Modeled cost/trader | Modeled cost/order |
|---|---:|---:|---:|---:|---:|---:|
| Internal Testnet | 100 | 100,000 | $1,000 | $250 | $12.50 | $0.0125 |
| Public Testnet candidate | 1,000 | 2,000,000 | $5,000 | $2,000 | $7.00 | $0.0035 |
| Scale review, not approved | 10,000 | 50,000,000 | $35,000 | $25,000 | $6.00 | $0.0012 |

Variable budget includes compute/data, delivery and Testnet asset operations. It excludes trading principal and user P/L. The model must be replaced with invoices, metering and actual workload before a scale or pricing decision.

## Revenue and user-net rules

For self-managed strategies:

`User Net = Realized PnL - Trading Fee - Funding - Slippage - Gas - Compute/Data Fee`

For an explicitly joined managed vault:

`User Net = Realized Net PnL - Explicit Management Fee - High-water-mark Performance Fee`

The current Spot engine records explicit maker/taker fees. It does not implement subscriptions, management fees, performance fees, funding or managed vault billing. Those revenue lines are therefore zero/unavailable, not silently embedded in spread. Unrealized profit is never fee-bearing. A high-water mark may not reset to charge the same gain twice.

Prohibited economics include hidden spread, synthetic volume, wash trading, secret counterparty positioning, guaranteed return, price guarantee, undisclosed mint/burn, or describing burn as revenue.

## Required instrumentation

- Active traders: unique Wallet subaccounts with an authoritative completed action, separated by test/internal/abuse labels.
- Execution: submitted, accepted, rejected, filled and cancelled counts; notional and explicit fee by maker/taker role.
- Cost allocation: CPU, memory, storage, egress, logs/traces, Gateway/indexer calls, support minutes, security and subsidy.
- Quality: p95/p99 latency, failure/retry, support load, abuse rate and charge/refund/dispute where applicable.
- Margin candidate: recognized explicit revenue minus directly attributable costs; Testnet subsidy reported separately.

## Kill/scale gates

Scale only when 30-day retention, task completion, crash-free sessions, support load, abuse rate, provider cost and gross-margin candidate are measured from source-backed events and reviewed together with risk. Kill or redesign a paid feature if fees are not understandable before authorization, metering cannot reconcile to the ledger, provider cost cannot be attributed, or user net cannot be independently reproduced.

Public deployment requires an operator-approved vendor/region, invoice-based baseline, free-tier and rate-limit terms, data retention/rights, subsidy cap and alert thresholds. Credentials, payment instruments and private signing material must never be requested in chat or stored in this model.
