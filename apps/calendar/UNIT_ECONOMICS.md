# YNX Calendar unit economics

Current product source: `828120e6d81efaf874a930793660e185a394ba4f`
Public Web runtime source: `828120e6d81efaf874a930793660e185a394ba4f`

## Current evidence boundary

Calendar has a public Testnet runtime but no representative measured workload, provider invoices tied to active users, production support load or revenue. Therefore no cost-per-user, gross margin, conversion, revenue or sustainable-scale claim is available.

## Cost model

Measure monthly cost by authoritative category:

- compute for API, Web assets and reminder workers;
- primary state/storage, encrypted backup and restore drill storage;
- outbound bandwidth and public monitoring;
- Wallet/Auth verification allocation;
- Mail invitation/reminder delivery;
- push notification provider;
- AI tokens, model routing and streaming;
- Data Fabric events and retention;
- observability logs, metrics, traces and status probes;
- artifact hosting, signing, notarization and store fees;
- support, abuse, privacy and incident operations.

For each category record provider, contract version, currency, billing unit, free tier, quantity, gross cost, allocated Calendar cost, as-of time and confidence/coverage. Do not infer a missing invoice from list price without labeling it as an estimate.

## Per-active-user formula

`monthly Calendar cost / monthly active Calendar users`

Also measure:

- cost per activated user;
- cost per approved event mutation;
- cost per external invitation/reminder delivered;
- cost per AI draft requested and approved;
- backup storage cost per retained GiB-month;
- support cases per 1,000 active users;
- abuse/privacy incidents per 10,000 active users.

## Revenue boundary

Calendar currently has no approved monetization. Any future subscription, team plan, compute/data fee or provider pass-through must be disclosed before purchase, auditable, cancellable and separated from Wallet assets. Calendar must not hide provider markup, sell private event data, fabricate savings, or claim guaranteed productivity gains.

## Testnet budget gate

Before expanding the public Testnet beyond the current bounded preview, define:

- monthly user and event budget;
- AI request and token caps;
- Mail/push delivery caps;
- backup retention and restore drill budget;
- observability retention limits;
- abuse/rate-limit thresholds;
- kill/scale thresholds when provider or support cost exceeds budget.

## KPI decision framework

Scale only when direct evidence shows acceptable activation, 7/30-day retention, task completion, crash-free sessions, provider success, support load, abuse rate and cost per active user. Kill or redesign when core task completion is poor, privacy/recovery risk is unresolved, provider cost is structurally unsustainable, or users cannot reliably export and exit.
