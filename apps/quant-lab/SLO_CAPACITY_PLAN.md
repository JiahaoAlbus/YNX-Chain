# SLO and capacity plan

## Measured local baseline

Measured 2026-07-22 on one local macOS arm64 host using the compiled Go
`ynx-quantd` binary, loopback HTTP, 500 requests per endpoint, concurrency 20.
This is a development-host baseline, not a public-capacity claim.

| Endpoint | p50 | p95 | p99 | Throughput | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| `GET /health` | 1.264 ms | 3.142 ms | 13.054 ms | 5,158.1 req/s | 0/500 |
| `GET /v1/snapshot` | 1.187 ms | 3.013 ms | 3.700 ms | 7,839.3 req/s | 0/500 |

Cold start, measured across 20 process starts: p50 5.990 ms, p95 9.594 ms,
p99/max 337.302 ms. The outlier is retained. No warm-up result is substituted.

Not yet measured: public network latency, authenticated Gateway overhead,
Exchange/DEX provider latency, sustained mixed writes, large datasets, WebSocket
fan-out, desktop launch, container cold start, queue saturation, storage growth,
or multi-region behavior.

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
