# YNX Oracle Unit Economics

## Current state

No paid provider agreement, public workload, subscription, or service revenue
exists. Provider, hosting, support, legal, and incident costs are therefore
unknown rather than zero. The Testnet console is read-only and makes no return,
price, uptime, or revenue guarantee.

## Cost model

Monthly cost must be calculated from invoices and telemetry:

`provider licenses + compute + ingress/egress + primary storage + backups +
observability + security + support + legal/compliance + incident reserve`.

Unit cost is reported both per active consumer and per million accepted price
reads. Rejected/unsafe reads remain in infrastructure cost and are not removed
from the denominator to improve margins. Free tiers are recorded as temporary
subsidies, never durable economics.

## Scenario gates

| Scenario | Reads/month | Retained data | Provider licenses | Status |
|---|---:|---:|---:|---|
| Engineering | local only | ephemeral | none | measured cost unavailable |
| Private Testnet | 10 million planning case | 30 days | ≥3 approved sources | quote and load test required |
| Public Testnet | 100 million planning case | policy-dependent | ≥3 approved sources plus failover | board/operator approval required |

The figures are demand scenarios, not forecasts. No provider candidate is
licensed or active for YNX benchmark redistribution today.

## Revenue and user-protection rules

If fees are introduced, users must see and affirm the exact subscription,
provider/data, compute, and applicable tax before purchase. YNX Oracle does not
take hidden spread, charge on unrealized profit, promise gains, manufacture
volume, or describe token mint/burn as revenue. Refund/dispute handling, service
credits, cancellation, data export, and shutdown exit terms must be approved
before any paid plan.

## Scale / kill decision

Scale only after 30 days of evidence shows source compliance, SLO attainment,
positive gross-margin candidate after all direct costs, acceptable support load,
and no unresolved safety incident. Pause expansion if provider cost per million
reads is rising for two review periods, source independence falls below three,
or incident/support cost makes the service unsustainable. Kill or redesign if
approved YNX market rights cannot be obtained or consumers cannot safely fail
closed.
