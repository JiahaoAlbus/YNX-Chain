# SLO and capacity plan

## Proposed service objectives

These are targets, not measured production achievements.

| Signal | Testnet target | Measurement source |
|---|---:|---|
| Merchant authenticated read availability | 99.9% / 30 days | Gateway and product-service request counters |
| State read latency | p95 <= 300 ms, p99 <= 750 ms | server trace histogram excluding client network |
| Mutation latency excluding provider | p95 <= 500 ms | route histogram |
| Provider-backed settlement submission | p95 <= 5 s | child span by official provider/version |
| Webhook enqueue success | 99.95% | persisted delivery/audit records |
| Webhook delivery | 99% within 5 minutes | delivery attempts and terminal state |
| RTO / RPO | 60 min / 15 min | timed restore drill / backup cadence |

## Measured local component baseline

Apple M2, darwin/arm64, 2026-07-22, one benchmark process:

| Component | Result | Allocations |
|---|---:|---:|
| RBAC decision | 14.52 ns/op | 0 B/op, 0 allocs/op |
| Webhook signing material | 280.2 ns/op | 344 B/op, 4 allocs/op |
| Settlement evidence validation | 16.60 ns/op | 0 B/op, 0 allocs/op |

Local recovery functional baseline: a 427-byte empty snapshot completed backup, independent verification, guarded restore and rollback verification between `2026-07-22T14:48:47.514235Z` and `2026-07-22T14:48:47.586604Z`. This approximately 72 ms interval is not an RTO claim; production-size and remote storage measurements remain required.

These measurements do not prove HTTP throughput, concurrent-user capacity or provider capacity. Before staging release, run 1/10/50/100 concurrency levels for at least 30 minutes each and record p50/p95/p99, throughput, error rate, CPU, RSS, file-store growth, queue depth and provider latency.

The service now exposes a monitor-key-protected, process-local snapshot of request count, response bytes and bounded duration buckets by route template/status. This is sufficient to validate instrumentation behavior locally, but it resets on restart and is not the durable multi-instance source required for the objectives above.

## Capacity constraints

- Current persistence serializes mutations through one integrity-protected file store. Do not claim horizontal scale.
- Webhook delivery and provider calls require bounded concurrency, rate-limit budgets and backpressure before public load.
- Storage growth must be measured per invoice, audit record, webhook attempt, dispute and AI run; retention/deletion policy is not yet implemented.
- Cold start, restore time and 30-day soak remain release gates.
