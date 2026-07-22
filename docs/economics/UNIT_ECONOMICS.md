# YNX Chain Unit Economics

Status: decision framework; production inputs incomplete  
Last reviewed: 2026-07-22

## Conclusion

YNX Chain cannot yet publish defensible per-transaction margin, validator profitability, protocol revenue, or runway. The repository evidences a current local accounting fee of one integer YNXT unit paid to the validator, with no active burn. It does not evidence a market price, production demand, infrastructure invoices, finalized supply/allocation, provider contracts, or approved issuance policy. Any currency-denominated projection would therefore be invented.

## Accounting boundary

Use three ledgers and do not mix them:

1. Protocol ledger: issuance, base fees, priority fees, burns, treasury inflows, and validator distributions denominated in YNXT.
2. Operator ledger: cloud, bandwidth, storage, observability, support, security, legal, and provider expenses denominated in the invoiced currency.
3. Market-conversion ledger: timestamped exchange rate, venue, liquidity/slippage assumptions, and conversion costs used to compare the first two.

The current fixed one-unit local fee is implementation evidence, not a final economic policy or fiat revenue estimate. Candidate issuance and fee splits in the simulator remain review inputs.

## Required model

For period `t`:

`gross_protocol_fees_ynxt = successful_chargeable_transactions * average_fee_ynxt`

`net_protocol_revenue_ynxt = treasury_fee_share + other_protocol_income - rebates - burns`

`validator_income_ynxt = validator_fee_share + issuance_rewards`

`operator_cost_fiat = compute + storage + bandwidth + observability + security + support + legal + provider_fees + incident_reserve`

`contribution_margin_fiat = converted_protocol_revenue_fiat - variable_operator_cost_fiat`

`runway_months = unrestricted_treasury_fiat / monthly_net_cash_burn_fiat`

Report protocol burns separately from expenses: a burn changes token supply, while an expense consumes operational resources. Report issuance separately from earned fee revenue.

## Input register

| Input | Unit | Evidence status | Owner/source required |
|---|---|---|---|
| Chargeable transactions by class | count/day | Missing | production telemetry owner |
| Average and percentile fees | YNXT/transaction | Local fixed fee only | approved fee policy + telemetry |
| Treasury/validator/burn split | basis points | Candidate only | governance approval |
| Issuance | YNXT/period | Candidate band only | governance approval |
| Compute and managed-service expense | invoiced currency/month | Missing | finance/cloud billing |
| Bandwidth and storage coefficients | currency/GB | Missing | provider invoices |
| External provider fees and rate limits | currency/unit | Missing | executed provider terms |
| Support/security/legal staffing | currency/month | Missing | operating plan |
| Liquid treasury | currency and YNXT | Missing | controlled treasury statement |
| Conversion rate and executable liquidity | fiat/YNXT | Missing | approved market-data methodology |

## Scenario requirements

Prepare downside, base, and upside scenarios only after the input register has dated sources. Each must vary demand, average fee, token conversion rate, validator count, infrastructure cost, provider cost, and incident reserve. Include sensitivity tables that identify the break-even transaction volume and the variables with the largest effect. Never present the upside case alone.

At minimum, include zero-market-price and 80% demand-down stress cases; a 2x infrastructure-cost case; a provider-cost shock; and a validator decentralization case where rewards are divided across the target set. The zero-price case is essential because token-denominated inflow does not guarantee fiat operating cash.

## Decision gates

Do not claim sustainability, profitability, deflation, real yield, or positive protocol revenue until:

- final fee, issuance, distribution, and burn policies are approved and implemented;
- at least 30 days of representative telemetry and invoices are reconciled;
- circulating supply and treasury balances are independently controlled and reproducible;
- conversion methodology includes liquidity and slippage, not a headline price;
- validator economics include hardware, bandwidth, downtime, tax, and concentration effects; and
- finance and protocol owners sign the same versioned model.

Until then, public economics language must use the factual status statements in `docs/public/PUBLIC_BRAND_FACTS.md` and the evidence constraints in `docs/public/MARKETING_CLAIMS_EVIDENCE_MATRIX.md`.
