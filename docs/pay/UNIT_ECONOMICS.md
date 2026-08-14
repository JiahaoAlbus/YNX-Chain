# YNX Pay unit economics

YNX Pay has no verified production revenue, active-user cost or gross margin. This document defines the ledger required before pricing or subsidy decisions.

## Per-payment ledger

Every quote and receipt must itemize network fee, provider cost, protocol fee, burn, treasury amount, merchant net, sponsor cost and user rebate. Missing values are `unavailable`, never zero by assumption. Burn is token destruction and is not revenue. Spread is prohibited unless explicitly quoted as a user-approved fee.

## Cost model

Monthly cost must be calculated from measured infrastructure, Gateway, RPC/indexer, storage, egress, observability, support, fraud/abuse, signing and provider invoices. Report total and per active payer, active merchant, submitted payment and committed payment. Free tiers and promotional credits are shown separately and expire on their actual terms.

## Revenue candidates

Allowed candidates are an explicitly accepted subscription, compute/data fee, provider pass-through, management fee or realized-profit performance fee. Performance-fee invoices require an external Quant Ledger record containing the prior high-water mark, realized net profit, fee basis, rate and period. Pay validates that evidence but never calculates PnL. No fee may be charged on unrealized or negative performance.

## Sponsorship budget

Track sponsor-funded gas by sponsor, campaign, user, device, merchant and day. Report approved budget, spent amount, rejected attempts, anti-Sybil decisions and remaining amount. First-payment and merchant sponsorship are subsidies, not revenue.

## Decision gates

Scale only after measured activation, 7/30-day retention, task completion, crash-free sessions, support load, abuse rate, provider cost, gross-margin candidate, public Testnet usage and conversion are available for a defined cohort. Kill or redesign if fraud-adjusted contribution remains negative after the declared subsidy period or authoritative settlement reliability misses its SLO.
