# YNX Chain SLO and Capacity Plan

Status: pre-production planning document  
Evidence date: 2026-07-22  
Release gates: all public-product booleans remain `false`

## Decision boundary

YNX Chain has no production service-level agreement and no evidenced production capacity figure. The objectives below are proposed launch gates. They become commitments only after an owner approves them, a representative environment passes the listed tests, and monitoring can calculate each indicator from retained telemetry.

## Proposed service objectives

| Surface | Indicator | Proposed objective | Measurement window | Current evidence |
|---|---|---:|---|---|
| Public read API | successful non-rate-limited requests / valid requests | 99.9% | rolling 30 days | Local-only baseline; production unverified |
| Public read API | p95 server response latency | <= 500 ms | rolling 30 minutes | Local `/health` + `/status` p95 70.3 ms |
| Transaction submission | accepted-or-deterministically-rejected responses | 99.5% | rolling 30 days | Smoke tests only |
| Block production | expected blocks produced while quorum is healthy | 99.9% | rolling 24 hours | Local single-process progression only |
| Indexer | indexed height lag behind canonical height | <= 2 blocks p95 | rolling 30 minutes | Smoke sync only |
| Critical incident acknowledgement | elapsed time to human acknowledgement | <= 15 minutes | per incident | Pager process not yet proven |

Exclude scheduled maintenance only when announced and recorded before the window. Do not exclude overload, dependency failure, operator error, or security controls that block legitimate traffic. Invalid requests and documented client-side cancellations may be excluded if their classification is measurable.

## Error-budget policy

For a 99.9% 30-day availability objective, the budget is approximately 43.2 minutes. At 50% consumption, freeze discretionary reliability-risking changes and require an owner review. At 100%, stop feature releases to the affected surface until the cause is remediated and a recovery test passes. Security containment overrides the error budget.

## Measured development baseline

The reproducible runner is `scripts/loadtest/local-read-benchmark.mjs`; raw evidence is `release/evidence/local-read-benchmark-2026-07-22.json`.

| Parameter/result | Value |
|---|---:|
| Source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Host | Apple M2, 8 logical CPUs, 8 GiB RAM, macOS arm64 |
| Topology | one local process, loopback HTTP, devnet |
| Workload | 5,000 reads across `/health` and `/status`; 250 warm-up reads |
| Concurrency | 50 |
| Success | 5,000 / 5,000 |
| Throughput | 2,757.18 requests/second |
| Aggregate latency | p50 9.21 ms; p95 70.32 ms; p99 120.24 ms; max 164.46 ms |
| Process start to healthy probe | 1,007 ms, including polling granularity |
| State directory during measured interval | 8 KiB to 12 KiB |

This result does not measure transaction writes, consensus quorum, persistent database contention, WAN latency, TLS, gateway controls, hostile traffic, provider calls, or failover. It is useful for regression detection only. It must not be used in marketing, validator sizing, or launch capacity claims.

## Capacity test matrix required before launch

| Test | Minimum shape | Pass evidence |
|---|---|---|
| Read saturation | representative node hardware; TLS/gateway path; stepped concurrency | throughput knee, p50/p95/p99, CPU, memory, open files, error rate |
| Transaction submission | signed valid/invalid mix; duplicate and nonce conflict cases | accepted rate, deterministic rejects, inclusion latency, queue depth |
| Consensus | at least 4 validators across failure domains | block interval, finality proxy, missed rounds, validator CPU/network |
| Soak | representative peak load for >= 24 hours | memory trend, storage growth, compaction, error budget use |
| Provider degradation | injected latency, 429s, malformed payloads, outage | timeout behavior, circuit breaking, bounded queues, recovery |
| Failover | remove validator, API replica, indexer, and provider independently | recovery time and data-loss observation |
| Adversarial | oversized bodies, connection churn, invalid signatures, replay | resource ceilings, rejection rate, no state corruption |

Each run must record commit, configuration digest, dataset, host/cloud shape, topology, start/end timestamps, raw metrics, and known deviations. A median of at least three comparable runs is required for a published figure.

## Initial sizing rule

No hardware minimum is approved. After representative tests, size each tier so forecast peak consumes no more than 50% of the first demonstrated bottleneck and N-1 loss remains below the proposed SLO. Forecasts must include organic growth, retry amplification, indexing, and safety headroom. Queue limits must be finite; overload must fail closed for value-moving writes and shed noncritical reads first.

## Recovery targets

Proposed, not yet evidenced: API RTO 30 minutes; indexer RTO 60 minutes; authoritative state RPO one finalized checkpoint or better. These targets require a documented backup format, encrypted off-host copies, restore automation, and a timed restore drill. Until that drill exists, recovery status is `unverified`.

## Monitoring and ownership gaps

Before launch, assign owners for API, consensus, indexer, security response, and provider dependencies. Add dashboards and alerts for request count/status/latency, block height and interval, peer/quorum health, queue depth, transaction inclusion, indexer lag, disk growth, process resources, provider latency/error/rate-limit state, and certificate expiry. Define paging routes and escalation contacts outside the repository.

## Gate

Capacity readiness remains false until the representative matrix, N-1 test, 24-hour soak, restore drill, and owner sign-off are attached to the release evidence index. Passing the local benchmark does not change any release boolean.
