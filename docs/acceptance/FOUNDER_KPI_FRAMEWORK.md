# Founder KPI Framework

Status: definitions and decision rules; targets require representative data

## Principle

Use verified product events and costs, segmented by release class and network. Do not combine simulator, preview, unsigned, signed-local, testnet, and production activity. Bots, internal tests, faucets, retries, and duplicate idempotency keys must be separately visible.

| KPI | Definition | Required cuts | Decision use |
|---|---|---|---|
| Activation | eligible new users completing the product's first verified value event / eligible new users | product, acquisition source, release class, network | onboarding quality |
| D7/D30 retention | activated cohorts completing another verified value event in day 7/30 window | cohort, product, geography where lawful | durable utility |
| Workflow completion | completed workflows / valid starts | workflow and failure class | product reliability |
| Transaction inclusion | accepted signed submissions included within target / accepted submissions | fee band, client, node route | chain UX |
| Crash-free sessions | sessions without fatal client termination / eligible sessions | app/version/platform/device class | release quality |
| Support contact rate | unique cases / 1,000 active users or workflows | category/severity/product | friction and harm |
| Abuse loss rate | confirmed abuse loss / processed value, with count alongside value | vector/product/recovery state | safety |
| Provider unit cost | provider invoice cost / successful attributable unit | provider/model/region/product | dependency economics |
| Contribution margin candidate | converted protocol revenue minus variable costs | scenario/product; with conversion method | scale economics |
| Public usage | independently observable valid public events, excluding tests/bots | event/network/source confidence | external traction |
| Conversion | next-stage verified users / eligible prior-stage users | funnel step/cohort/source | growth efficiency |

Value events must be product-specific: for a wallet, a user-controlled signed action; for Pay, a completed merchant workflow; for Developer, a verified deploy/call; for Exchange/Custody, a proven integration milestone. Page views and faucet claims are not activation by themselves.

## Data contract

Each KPI record must declare `metricVersion`, source, as-of time, release class, network, inclusion/exclusion rules, numerator, denominator, confidence, known gaps, and owner. Changes to definitions require a new version and backfill or an explicit discontinuity. Store personal data only when necessary and approved; prefer aggregate events with bounded retention.

## Guardrails

Track security incidents, severe abuse, irreversible user loss, unauthorized value movement, privacy complaints, support backlog age, provider concentration, validator concentration, error-budget consumption, and legal/compliance blockers beside growth. A growth metric never overrides a guardrail.

## Candidate scale/hold/kill rules

These are governance prompts, not approved targets:

- Scale a product only after two consecutive review periods show improving activation/retention, completion within its SLO, sustainable provider cost under the downside case, no unresolved critical security issue, and no worsening severe-harm guardrail.
- Hold when evidence is incomplete, attribution is weak, error budget is exhausted, support capacity is exceeded, or a material provider/legal dependency is unresolved.
- Kill or withdraw a capability when it cannot fail closed, causes repeated unauthorized or irreversible harm, requires unsupported claims to acquire users, cannot meet an approved unit-economics floor after a defined remediation period, or loses a required license/provider/custody basis.

Numeric thresholds should be set only after a baseline period with representative users. The founder review must record the decision, evidence version, dissent/uncertainty, owner, and next review date.
