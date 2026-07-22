# SLO and capacity plan

No production-scale capacity claim is made. The current evidence is local unit/integration execution only.

Target staging SLOs, to be accepted only after measured load evidence:

| Signal | Staging target |
| --- | --- |
| Public read availability | 99.9% monthly |
| Protected mutation availability | 99.5% monthly, excluding rejected policy requests |
| Public read latency | p95 under 300 ms, p99 under 800 ms |
| Protected mutation latency | p95 under 800 ms, excluding external BFT finality |
| Error rate | under 0.5% server errors |
| RPO | zero acknowledged local mutations because persistence precedes success |
| RTO | 30 minutes after verified backup selection |

Capacity tests must separately measure proposal list/detail, signed mutation verification, snapshot persistence as proposal/vote history grows, concurrent readers, backup duration, restore duration, state bytes per proposal/vote, cold start, and external Gateway/BFT latency. Required report fields are p50/p95/p99, throughput, concurrency, sample size, machine profile, state cardinality, error count, source commit, and timestamp.

Alerts are required for SLO burn, integrity-check failure, restart loop, storage growth, backup age, active emergency nearing expiry, timelock execution delay, and rollback verification failure. Dashboard and alert installation remain unverified.
