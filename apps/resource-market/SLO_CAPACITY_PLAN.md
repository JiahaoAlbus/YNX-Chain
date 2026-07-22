# SLO and capacity plan

## Service indicators

The product will measure availability, request latency p50/p95/p99, error rate, matching throughput, quote latency, provider response latency, reservation success, signed-meter lag, settlement confirmation lag, queue depth, store growth, active sessions, worker cold start and recovery time. Metrics must include source, observation time, version and coverage.

## Current measured evidence

On 2026-07-22, `./scripts/verify/resource-market-capacity.sh` issued 1,000 local-loopback matching reads against two ephemeral providers at concurrency 25. It observed zero failures, 6,845.38 requests/second, p50 3.037 ms, p95 7.448 ms, p99 11.032 ms and max 11.487 ms. Exact evidence is `evidence/local-capacity-20260722.json`.

This proves only the in-process matching read on this host. It does not establish public availability, multi-region latency, chain settlement throughput, durable write throughput or production capacity.

## Candidate Testnet objectives

| Indicator | Candidate objective | Current status |
| --- | --- | --- |
| API availability | 99.5% monthly excluding announced maintenance | Unmeasured remotely |
| Matching read p95 | ≤ 250 ms at 50 concurrent public clients | Local-only evidence |
| Quote p95 | ≤ 750 ms excluding external Wallet approval | Unmeasured remotely |
| Provider reservation p95 | ≤ 5 s excluding offline provider | Unmeasured |
| Meter ingestion success | ≥ 99.9% for valid signed meters | Unmeasured under sustained writes |
| Settlement accounting mismatch | 0 accepted mismatches | Enforced in unit tests |
| RTO | ≤ 60 minutes | Drill not yet recorded |
| RPO | ≤ 5 minutes after backup integration | Backup schedule not deployed |

## Capacity and growth model

Initial public testing must cap 100 concurrent product sessions, 20 active providers, 10,000 active offers, 100 write requests/second and 10 GiB of metering evidence before a measured scale review. These are safety limits, not demonstrated capacity. Alerts fire at 70% sustained utilization and block new reservations at 90% while preserving meter, dispute, export and exit operations.

Meter records are append-oriented. Storage forecasting uses `daily meters × average encoded bytes × retention days × replication factor`, measured from production-shaped fixtures before deployment. Provider API rate limits and cold-start distributions must be recorded per adapter; unavailable providers fail closed and are removed from matching.
