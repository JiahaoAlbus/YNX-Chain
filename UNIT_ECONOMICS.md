# YNX Shop Unit Economics Model

Updated: 2026-07-29

Status: model defined; no production revenue, provider contract, or verified operating-cost dataset exists.

## Accounting boundaries

YNX Shop records order values in Testnet `YNXT`. Testnet YNXT has no represented real-world monetary value and must not be translated into revenue, profit, treasury value, or fiat valuation.

Fiat operating costs should be recorded in renminbi (`¥`) for this model unless the underlying invoice is denominated in another currency. Preserve the invoice currency in source records and convert only in a separately approved finance report with the exchange rate and date recorded.

Shop does not own:

- Wallet/Auth fee policy
- Pay settlement fee policy
- Chain gas or resource pricing
- Trust pricing
- AI provider pricing
- Website/CDN contracts
- App-store commercial terms

Those inputs must come from the responsible owner or an actual invoice. Shop must not invent them.

## Core formulas

For period `t`:

- Gross Merchandise Value (Testnet): `GMV_YNXT(t) = sum(committed paid order total in YNXT)`
- Refunded volume: `Refunded_YNXT(t) = sum(committed refund amount in YNXT)`
- Net settled volume: `Net_Settled_YNXT(t) = GMV_YNXT(t) - Refunded_YNXT(t)`
- Completed orders: count of orders with committed paid evidence that reached a terminal non-refunded state
- Refund rate: `refunded orders / committed paid orders`
- Return-request rate: `return_requested orders / delivered orders`
- Dispute rate: `disputed orders / committed paid orders`
- Average order value: `GMV_YNXT / committed paid orders`
- Inventory reservation expiry rate: `expired payment-pending orders / created orders`

These are product-flow measures, not fiat revenue measures.

## Fiat contribution model

Use only verified inputs:

`Revenue_¥ = merchant_subscription_¥ + verified_transaction_fee_revenue_¥ + verified_service_revenue_¥`

`Variable_Cost_¥ = Pay_fees_¥ + Wallet/Auth_usage_¥ + Trust_usage_¥ + AI_usage_¥ + network_egress_¥ + storage_operations_¥ + support_variable_cost_¥ + refunds_or_credits_¥`

`Contribution_¥ = Revenue_¥ - Variable_Cost_¥`

`Contribution_per_committed_order_¥ = Contribution_¥ / committed_paid_orders`

`Gross_margin = Contribution_¥ / Revenue_¥`

When revenue is zero, gross margin is undefined rather than 0% or 100%.

## Required operator inputs

Before any business claim, obtain:

| Input | Owner/source | Required evidence |
| --- | --- | --- |
| Merchant pricing | Product/Finance owner | approved price schedule and effective date |
| Pay fees | 04 Pay | contract or exact Testnet/production fee policy |
| Wallet/Auth cost | 02 Wallet/Auth | metering rule or provider invoice |
| Trust cost | 15 Trust Center | accepted service pricing or invoice |
| AI cost | 14 AI/provider | model, token/tool usage, invoice and currency |
| Event/billing allocation | 26 Data Fabric | accepted event schema and billing ledger records |
| Infrastructure | 30 Security/SRE | compute, storage, egress, monitoring and backup invoices |
| Website/download delivery | 28 Website | CDN/build/storage invoice allocation |
| Support operations | Shop operator | staffed hours and approved loaded rate |
| Tax/legal/store fees | authorized owner | invoice or approved fee schedule |

No value should be entered from memory, a marketing estimate, or a public list price when an actual contract or invoice applies.

## Event and metric requirements

A defensible model requires accepted, deduplicated records for:

- order created
- inventory reserved/released
- Pay intent/invoice created
- committed payment
- shipment and delivery
- return/refund request
- committed refund
- dispute opened/resolved
- privacy export/deletion
- AI job estimate, execution and deletion

Each billable or cost-bearing event requires an immutable event ID, version, source product, source commit, occurred-at timestamp, pseudonymous account reference where required, object ID, request/audit references, and payload hash. Candidate events exist in the Shop integration contract but are not frozen by 26 Data Fabric or 29 Integration.

## Guardrails

- Never treat order creation, Pay handoff, webhook receipt, or HTTP 200 as settled volume.
- Count only committed Pay evidence that exactly matches payer, payout, asset, amount, invoice, transaction, block and audit fields.
- Deduplicate by authoritative transaction/evidence identity and Shop idempotency records.
- Keep refunded and disputed volume visible; do not net them away without separate disclosure.
- Do not monetize buyer personal data or observability data.
- Do not expose merchant- or buyer-level economics publicly without authorization and aggregation review.
- Do not infer production economics from the local capacity test.

## Current conclusion

The repository now contains the accounting model and the operational metrics needed to start measurement, but it has no accepted billing ledger, real merchant pricing, production provider invoices, committed public Shop transactions, or production traffic. Therefore no revenue, margin, CAC, LTV, payback, or break-even claim is currently supportable.
