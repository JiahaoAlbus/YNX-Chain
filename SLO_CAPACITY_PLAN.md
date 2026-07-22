# YNX Oracle SLO and Capacity Plan

## Scope and claim boundary

This plan covers the read API, signed-observation ingestion, aggregation, and
durable event store. The measurements below are an in-process macOS engineering
baseline from `TestLocalPerformanceProfile`; they exclude TLS, ingress,
provider latency, network loss, multi-zone storage, and public users. They are
not evidence of public capacity.

## Measured local baseline

Run on 2026-07-23 with `YNX_ORACLE_PROFILE=1 go test ./internal/oracle -run
'^TestLocalPerformanceProfile$' -count=1 -v`.

| Route | Requests / concurrency | p50 | p95 | p99 | Throughput | Error rate |
|---|---:|---:|---:|---:|---:|---:|
| `/health` | 2,000 / 1 | 0.004 ms | 0.007 ms | 0.023 ms | 131,355 req/s | 0% |
| `/version` | 2,000 / 1 | 0.005 ms | 0.006 ms | 0.019 ms | 128,617 req/s | 0% |
| `/prices` | 500 / 1 | 0.013 ms | 0.018 ms | 0.073 ms | 57,285 req/s | 0% |
| `/prices` | 1,000 / 8 | 0.042 ms | 0.236 ms | 0.324 ms | 92,543 req/s | 0% |

The sample uses three generated test reporters and an `httptest` handler. It
does not establish concurrent-user, provider, disk durability, or WAN limits.

## Testnet objectives

| Indicator | Initial objective | Window / action |
|---|---:|---|
| Read availability | 99.5% | 30 days; exclude announced maintenance |
| Fresh authoritative price availability | 99.0% | 30 days; failure is preferable to unsafe publication |
| Read p95 / p99 | ≤250 ms / ≤750 ms | ingress-to-response |
| Ingest-to-publication p95 / p99 | ≤2 s / ≤5 s | signed event received to price visible |
| Stale authoritative responses | 0 | stale data is returned only as rejected last-good context |
| Minimum independent sources | 3 | breaker opens below threshold |
| Provider divergence | ≤50,000 ppm | breaker opens above threshold |
| API error rate | <1% | exclude consumer validation failures |
| RPO / RTO | ≤5 min / ≤30 min | encrypted backup and restore drill required |

## Capacity envelope and scaling triggers

Start with 100 provider updates/s per provider and burst 200, the enforced
process limits. Admission remains closed until a 60-minute staging soak proves
provider latency, queue depth, CPU, memory, event-store growth, and recovery.
Scale or shard when any of these persists for 15 minutes: CPU >60%, memory
>70%, write queue >1 second, disk >65%, p95 >200 ms, or rejected provider
updates >0.5% for reasons other than policy.

At 10 scalar observations/s/source, three sources, and a conservative 2 KiB per
normalized/event-chain record, raw growth is about 5.2 GiB/day before backups
and indexes. Actual encoded size and retention must be measured in staging.
Thirty days therefore requires at least 160 GiB primary capacity plus backup,
headroom, and restore workspace. Structured books/trades require separate
sampling and cannot inherit this estimate.

## Missing measurements before public API activation

- Official provider count, latency, quotas, cost, and YNXT/YUSD_TEST coverage.
- Cold start, TLS/ingress, regional failover, queue saturation, and 60-minute soak.
- Structured order-book/trade storage growth and historical-query p99.
- Backup restore duration, multi-zone RPO/RTO, and disaster failover.
- Real concurrent users and public error-budget burn.

Alerts and rollback actions are defined in `OBSERVABILITY.md` and
`OPERATIONS.md`. Breaching a safety invariant opens the breaker; it never
relaxes source or freshness policy automatically.
