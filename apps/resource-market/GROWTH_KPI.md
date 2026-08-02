# Founder KPI and decision framework

Metrics are computed from consented product events and authoritative state. No synthetic users, social proof, rankings or transactions count toward growth.

| KPI | Definition | Guardrail |
| --- | --- | --- |
| Activation | Wallet-authorized user completes a valid quote and views its fee/risk breakdown | Quote is not counted as purchase or settlement |
| Task completion | Started buyer/provider workflows reaching their intended non-error terminal state | Exclude abandoned automation and test fixtures |
| 7/30-day retention | Activated accounts returning for a real quote, provider task, usage review or dispute | Account-level, privacy-preserving cohorts |
| Crash-free session | Sessions ending without frontend crash or unhandled server 5xx | Segment by version and platform |
| Support load | Human support minutes and cases per 100 active accounts | Include disputes and refund work |
| Abuse rate | Confirmed fraudulent/self-dealing/meter-tamper events per 1,000 orders | Reviewer-confirmed, appeal-aware |
| Provider cost | Settled provider net plus directly attributable provider API cost per completed task | Never infer from quoted prices |
| Gross-margin candidate | Confirmed protocol fees minus attributable infrastructure, provider API, payment, refund and support cost | Subsidy reported separately |
| Public Testnet usage | Unique authorized accounts, verified providers, confirmed meters and receipts on published Testnet | Requires public endpoint and source-commit evidence |
| Conversion | Activated users reaching asset-settlement-confirmed service | No dark patterns or default opt-in |

Scale only after measured reliability meets SLO, settlement mismatches remain zero, abuse and dispute workload are supportable, and contribution after refunds/support is sustainable. Pause new reservations when integrity, exit, support or provider-capacity guardrails fail. Kill or redesign a resource category if repeated cohorts cannot meet safety and sustainable-cost thresholds without hidden fees or issuance subsidy.
