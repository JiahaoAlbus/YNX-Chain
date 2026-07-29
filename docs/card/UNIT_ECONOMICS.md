# YNX Card Unit Economics

Source baseline: `d79872f5df4da0566e11ef40e5314ea68d9846f4`  
Status: model and required inputs only; no provider, revenue or profitability claim

## Current economic truth

The YNX Card Testnet Preview has no selected production issuer, BIN sponsorship, processor contract, fiat balance, interchange entitlement, reward program, paid plan, hosted runtime or real transaction volume. The deterministic sandbox emits no authoritative revenue, settlement or provider-cost facts. Therefore no unit margin, break-even volume, customer acquisition payback or production forecast is asserted.

Billing Ledger owner 26 is the authority for provider costs, service fees, rewards, reversals and recognized revenue. Card may emit canonical operational events after integration acceptance but must not calculate or invent settlement or revenue facts.

## Required per-active-card inputs

| Input | Authority | Current state |
|---|---|---|
| Issuance and replacement cost | Official issuer/processor contract | Unknown |
| Monthly active-card platform fee | Official issuer/processor contract | Unknown |
| Authorization/clearing/refund/dispute fees | Official issuer/processor contract | Unknown |
| Cross-border, FX and ATM economics | Official issuer/processor contract | Unknown |
| Interchange share and settlement timing | Issuer/processor + legal/accounting | Unknown |
| Fraud, chargeback and dispute loss | Data Fabric/Billing Ledger after real program | No data |
| KYC/KYB and compliance cost | Approved compliance providers | Unknown |
| Customer support cost | Support operations | No measured data |
| Infrastructure and observability cost | Deployed runtime invoices | No deployment |
| Rewards expense | Governance/product policy + Billing Ledger | No program |
| Subscription or service revenue | Approved pricing and Billing Ledger | No pricing |
| Acquisition and activation cost | Marketing/finance | No campaign data |
| Dormancy, closure and replacement rates | Data Fabric after real program | Sandbox only |

## Canonical formulas

For one accounting period:

```text
recognized_revenue
  = subscription_revenue
  + service_fee_revenue
  + recognized_interchange_share
  - refunds_and_reversals

variable_cost
  = issuer_platform_fees
  + issuance_and_replacement_cost
  + authorization_and_settlement_fees
  + kyc_compliance_cost
  + rewards_expense
  + fraud_and_dispute_loss
  + variable_support_cost
  + variable_infrastructure_cost

contribution_margin
  = recognized_revenue - variable_cost

contribution_margin_per_active_card
  = contribution_margin / active_cards

break_even_active_cards
  = fixed_operating_cost / contribution_margin_per_active_card
```

A formula result is valid only when every input is time-bounded, currency-consistent, sourced from the authoritative owner and reconciled against reversals/transfers. Sandbox event counts cannot be substituted for real economics.

## Scenario framework

Once provider terms exist, owner 17/24/26 should evaluate at least:

- conservative: low activation/interchange, high support/fraud/replacement cost;
- base: contracted rates with measured Testnet-to-pilot conversion assumptions;
- stress: issuer outage, fraud spike, dispute spike, reward overrun and high churn;
- jurisdiction: separate regulatory, tax, FX and consumer-protection treatment;
- privacy operations: export/delete/support workload and coordinated processor deletion cost.

Every scenario must expose assumptions, source date, currency, confidence interval and sensitivity to the top three drivers. Do not publish a single-point forecast without downside cases.

## Promotion gate

Unit economics can move beyond `unknown` only after an official provider contract, central Billing Ledger event mapping, real pilot invoices and volume evidence exist. Public claims require finance/legal approval and must distinguish gross flow, recognized revenue and contribution margin. Until then, the public product metadata must avoid fee, reward, savings, profitability or interchange claims.
