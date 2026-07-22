# Unit Economics

## Current measurable boundary

The economics disclosure is a read-only, process-local calculation with no paid provider and no per-request persistence. Therefore its directly observed third-party cost, storage growth and protocol revenue are all zero for the measured path. Hosting, bandwidth, monitoring, support, legal, custody, audits, signer operations and incident-response costs are unknown because there is no deployed service or billing evidence. No active users, conversion, revenue, gross margin or subsidy burn are claimed.

The current local benchmark observed a 1,873-byte response and 25,900 allocated runtime bytes per request. Allocation is not a cloud cost and must not be converted to currency without a priced deployment profile. Structured per-request logs add observability volume that must be measured and priced under sustained staging load.

## Candidate accounting model

For period `t`:

`service_cost_t = compute + memory + egress + storage + observability + support + security/audit + legal/compliance + provider + incident_loss`

`cost_per_active_user_t = service_cost_t / distinct_active_users_t`

`gross_margin_t = (recognized_service_revenue_t - variable_service_cost_t) / recognized_service_revenue_t`

When recognized revenue is zero, gross margin is undefined, not 0% or 100%. Gas burn is not revenue. Validator priority fees, provider costs, protocol fees and Treasury receipts must remain separately attributable. Candidate issuance and grants are subsidy, not customer revenue. Free allowance and subsidy budgets are unset until priced infrastructure and abuse data exist.

## Instrumentation required before scale decisions

Record request and active-user counts without storing wallet secrets; CPU-seconds, memory-byte-hours, egress bytes and log/metric volume by service; provider invoice units; support minutes and incident cost; fee ledger recipient and burn fields; subsidy source and expiry. Report Activation, 7/30-day Retention, Task Completion, Crash-free Session, Support Load, Abuse Rate, Provider Cost, Public Testnet Usage and Conversion only from source-labelled telemetry.

Scale requires a measured positive contribution margin under medium and high usage without hidden spread, unapproved rehypothecation or issuance presented as revenue. Kill or redesign if safety limits cannot cap abuse/subsidy, required custody or legal controls are unavailable, or sustained service cost cannot be transparently funded.
