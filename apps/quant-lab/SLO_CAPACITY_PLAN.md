# SLO and capacity plan

## Measured local baselines

Measured 2026-07-29 on one macOS arm64 host with 8 logical CPUs and Go 1.25.7,
bound to source commit `369807b7a6d865db4009a67e305480d39de6a154`.
The repeatable harness retained every raw wall-clock sample. This is a
development-host baseline, not a public-capacity claim.

| Endpoint | p50 | p95 | p99 | Throughput | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| `GET /health` | 2.737 ms | 4.120 ms | 4.404 ms | 6,660.5 req/s | 0/500 |
| `GET /v1/snapshot` | 2.376 ms | 3.325 ms | 4.027 ms | 7,842.8 req/s | 0/500 |

| Workload | Count | p50 | p95 | p99 | Throughput | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| deterministic backtest, 512 bars | 40 | 2.984 ms | 4.304 ms | 4.811 ms | 354.0 runs/s | 0 |
| signed worker service, 512 bars | 40 | 3.464 ms | 4.852 ms | 4.891 ms | 277.1 jobs/s | 0 |
| worker queue age | 40 | 64.963 ms | 135.261 ms | 144.437 ms | — | 0 |

The 40 API backtests grew the atomic JSON state by 243,181 bytes. The 40 worker
jobs grew state by 242,033 bytes and produced 2,396,354 outbox bytes. These are
short synthetic samples, not retention or long-soak forecasts. Raw evidence is
in `evidence/local-api-backtest-capacity-20260729.json` and
`evidence/local-worker-capacity-20260729.json`.

The earlier 2026-07-22 cold-start sample across 20 process starts measured p50
5.990 ms, p95 9.594 ms,
p99/max 337.302 ms. The outlier is retained. No warm-up result is substituted.

Not yet measured: public network latency, authenticated Gateway overhead,
Exchange/DEX provider latency, sustained mixed writes, large datasets, WebSocket
fan-out, desktop launch, container cold start, queue saturation, long-soak
storage growth, or multi-region behavior.

## Candidate SLOs

These are targets, not achieved status:

- authenticated read availability: 99.9% per rolling 30 days
- read p95 below 250 ms and p99 below 750 ms at the public edge
- accepted write p95 below 750 ms excluding venue acknowledgement
- bounded execution acknowledgement p95 below 5 seconds, with explicit pending
  or unavailable state rather than fabricated success
- WebSocket reconnect success above 99% within 30 seconds
- RTO 60 minutes; RPO 5 minutes after durable database migration
- job queue age p95 below 60 seconds and hard admission control at capacity

## Capacity gates

Before public staging, run 30-minute mixed read/write and WebSocket tests with
the canonical Gateway, representative state size, and real provider sandbox.
Record concurrent users, active sockets, queue depth/age, CPU, RSS, open files,
disk IOPS, state growth, lock wait, provider latency/rate limits, and errors.
Scale is not approved from this small loopback sample.

The current JSON store and atomic lock are a single-node candidate. Kubernetes
replicas remain fixed at one until a transactional shared database, migration,
and failover drill replace this boundary.
