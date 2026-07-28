# YNX Exchange SLO and capacity plan

Evidence date: 2026-07-22. Evidence source: `evidence/capacity/exchange-local-2026-07-22.txt`. Benchmark implementation: `internal/exchangeproduct/benchmark_test.go`.

## Measured local baseline

| Path | Sample | p50 | p95 | p99 | Throughput |
|---|---:|---:|---:|---:|---:|
| Durable non-crossing order submission | 5 × 200 serial operations | 13.10–16.46 ms | 19.47–29.14 ms | 22.38–38.76 ms | 59.9–74.7 operations/s |
| 1,000-order public book snapshot | 5 × 200 serial operations | not sampled | not sampled | not sampled | 848–1,348 snapshots/s from mean latency |

The durable path includes Wallet signature verification, reservation, event/audit generation, whole-state serialization, fsync, atomic rename and directory sync. One 200-order storage sample measured 4,007 state bytes/order. Matching, WebSocket fan-out, concurrent accounts, network/Gateway/indexer latency and failure injection are not covered; no capacity claim is made for them.

## Testnet objectives

- Order acceptance: p50 ≤ 25 ms, p95 ≤ 50 ms, p99 ≤ 100 ms at 40 durable submissions/s on the designated staging machine.
- Read snapshot: p99 ≤ 25 ms at 1,000 open orders and 100 reads/s.
- Error rate: <0.1% internal errors over a 30-minute steady-state run; authorization and business rejections are counted separately.
- Availability target: 99.5% monthly for public Testnet after monitoring exists. Current measured availability: unavailable.
- Queue objective: no unbounded queue; reject with a stable error before memory growth. Current queue implementation/evidence: missing.
- Cold start: target ≤5 s with 100,000 persisted orders. Current measurement: missing.
- RTO/RPO objectives: RTO ≤30 minutes, RPO ≤1 committed state transition. Restore-drill evidence: missing.

These are engineering objectives, not achieved SLOs. They become achieved only after reproducible staging load, alert, incident and restore evidence points to an immutable source commit.

## Capacity and growth boundaries

The current whole-state JSON persistence makes write cost grow with history and is unsuitable for claiming large-scale production capacity. At the observed 4,007 bytes/order, one million retained order transitions would be approximately 4.0 GB before filesystem and backup overhead; this is a linear estimate, not a measured million-order result. A public launch gate requires an append-oriented transactional store, bounded event retention with auditable archive/export, backup verification, and migration vectors.

Required next measurements:

1. 1/10/100 concurrent accounts with mixed submit/amend/cancel/match traffic.
2. p50/p95/p99 Gateway and indexer latency, timeout and rate-limit behavior.
3. WebSocket fan-out, reconnect/replay lag and slow-consumer memory bounds.
4. 10k/100k/1m state cold start, storage growth, backup and restore.
5. 30-minute steady state, burst, soak and kill/restart reconciliation.
6. CPU, RSS, disk IOPS, queue depth, error rate and saturation point.

## Gate policy

No local benchmark may set `deployedStaging`, `deployedPublic`, availability, concurrent-user capacity or production-scale claims to true. Results must record hardware, OS, command, duration, workload, source SHA and raw output. Regression gates should compare like-for-like samples and fail when p99 or allocation/storage growth exceeds the reviewed threshold by more than 20%.
