# Observability

This is the evidence boundary for Chain Core telemetry. Endpoint or script presence is local implementation evidence; only captured current-source responses from an eligible public vantage prove deployment.

## Implemented surfaces

| Surface | Current source | Evidence boundary |
| --- | --- | --- |
| Chain health and metrics | `ynx-chaind` `/health`, `/metrics` | Authoritative process state only |
| BFT Gateway health | `/health` with height, validator count, cutover readiness, implemented/missing capabilities and build | Comet dependency must be reachable; readiness remains false without cutover evidence |
| Indexer metrics | last indexed height, source earliest height, native symbol | Does not prove public freshness without a timestamped response |
| Explorer/Faucet/service health | service `/health` endpoints and build/dependency fields where implemented | Each service must fail when its authoritative upstream is unavailable |
| Deployment monitoring | `scripts/deploy/deploy-authoritative-monitoring.sh` | Requires operator-controlled host access; configuration is not proof of active alerts |
| Four-node verification | strict host-key and exact-release verification scripts | Recovered topology is producer/followers, not four-validator quorum |
| Public diagnostics | bounded public-ingress and multi-service probes | Fake-IP/proxy routes are explicitly ineligible for direct proof |
| Audit evidence | consensus fee, Quant, AA, staking, Pay, Trust and resource audit records | AppHash-bound record evidence; not a substitute for operational logs/traces |

## Required labels and correlation

Operational logs must carry UTC time, service, release/commit, node role, outcome, and a request, transaction, audit, or error identifier appropriate to the event. Logs must not contain raw prompts, private keys, seeds, bearer/API secrets, validator material, full credentials, or local secret-file contents. Metrics labels must remain bounded; addresses, transaction hashes, request IDs, and error text are not permitted as unbounded labels.

## Alert conditions

Operators must alert on stalled height, catching-up validators, validator-count or AppHash divergence, absent precommits, repeated CheckTx/FinalizeBlock failures, indexer lag, queue growth, service dependency failure, backup failure, state-sync failure, disk pressure, restart loops, mutation-freeze overrun, and rollback failure. Safety Module, liquid-staking, external reserve, APY, liquidity, and revenue values must never be emitted as live metrics while they remain models or unavailable coverage.

## Missing proof

No current-source public SLO dashboard, trace backend, status page, paging integration, alert-delivery receipt, long-soak dataset, production log-retention record, or incident drill tied to `9d0b254cef3cd15db6d58564349951402cef6ba0` exists. Existing deployed telemetry belongs to an older release and must not be attributed to this source commit.

Before public release, preserve exact `/health`, `/version` where available, `/metrics`, block-height/AppHash, validator/precommit, service dependency, alert, and dashboard responses with UTC timestamps, source commit, release ID, URL, SHA-256, and eligible vantage classification.
