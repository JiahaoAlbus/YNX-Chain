# Monitor SLO and capacity plan

## Testnet objectives

These are targets, not production achievements.

| Signal | Target | Evidence source |
|---|---:|---|
| Control-plane read availability | 99.9% / 30 days | route counters and probes |
| Health/read latency | p95 ≤ 300 ms, p99 ≤ 750 ms | server histogram |
| Critical alert delay | p95 ≤ 60 seconds | source event to alert audit |
| Incident acknowledgement | p95 ≤ 10 minutes | incident timeline |
| Backup RPO | ≤ 15 minutes | registered backup evidence |
| Restore RTO | ≤ 60 minutes | independently verified restore drill |

## Local baseline

`Monitor records a bounded local HTTP capacity baseline` sends 1,000 health
requests at concurrency 25 through a real loopback Express listener and records
failures, throughput and p50/p95/p99.

Apple M2, darwin/arm64, 2026-07-29:

| Requests | Failures | Throughput | p50 | p95 | p99 |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 0 | 918.9 req/s | 14.189 ms | 125.261 ms | 237.726 ms |

This is a local control-plane baseline. It does not prove public-network,
multi-region, source-provider, notification, 30-day availability, alert-delay or
production capacity. The test output is the authoritative measured value for
the exact run; staging evidence must repeat it with CPU, RSS, queue, telemetry
storage growth and owner-source latency.

## Remaining gates

- Repeat concurrency 1/10/25/50/100 for 30 minutes under representative probes.
- Measure source event → alert → delivery latency and false-positive/negative rate.
- Measure telemetry cardinality and storage growth per service, incident and audit.
- Execute provider/region outage, queue saturation and notification rate-limit drills.
- Register, independently verify and time a production-volume backup/restore.
- Preserve process, staging and production results as separate release classes.
