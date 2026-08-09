# Finance SLO and capacity plan

## Testnet objectives

These are targets, not production achievements.

| Signal | Testnet target | Evidence source |
|---|---:|---|
| Authenticated read availability | 99.9% over 30 days | protected route counters |
| Read latency | p95 ≤ 300 ms, p99 ≤ 750 ms | route latency histogram |
| Owner-source latency | p95 ≤ 2 s | source-specific observations |
| Error rate | < 0.5% excluding rejected input | status-class counters |
| Backup RPO | ≤ 15 minutes | backup scheduler evidence |
| Restore RTO | ≤ 60 minutes | isolated restore drill |

## Measured local baseline

Apple M2, darwin/arm64, 2026-07-29. `TestFinanceHTTPReadCapacity`
sent 1,000 `/health` reads through the complete Finance middleware stack at
concurrency 25:

| Requests | Failures | Throughput | p50 | p95 | p99 |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 0 | 163,793.5 req/s | 13.042 µs | 872.792 µs | 1.94625 ms |

This is an in-process handler baseline. It does not prove public-network,
multi-instance, central Wallet, Explorer, Pay, Exchange, DEX, Quant, Economics,
or production capacity.

The store backup suite directly proves authenticated backup, verification,
restore, rollback preservation, strict version rejection, wrong-key rejection,
and tamper rejection. It does not yet establish deployed RTO or RPO; those
remain false in the release record until a scheduled remote backup and isolated
restore drill are timed.

## Capacity and measurement boundaries

- Route metrics expose bounded latency buckets, status classes, in-flight
  requests, total requests, and source availability without account or financial
  data.
- Metrics are process-local and reset on restart. Central Monitor ingestion,
  durable aggregation, alerts, traces, and 30-day availability are external
  integration gates.
- Local state serializes atomic writes. Staging must measure file growth per
  account, note, category, budget, audit event, AI job, and nonce.
- Each accepted owner source must publish its rate limit and latency/error
  budget. Pending sources remain unavailable rather than receiving invented
  capacity.
- Before staging promotion, repeat at concurrency 1/10/25/50/100 for at least
  30 minutes and record CPU, RSS, queue depth, storage growth, source latency,
  cold start, and error rate.

