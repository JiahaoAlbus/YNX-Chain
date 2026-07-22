# SLO and capacity plan

Candidate Testnet objectives, not production claims:

| Path | Availability | p50 / p95 / p99 target | Capacity gate | Timeout / rate limit |
|---|---:|---:|---:|---:|
| Authorization parse/verify | 99.95% | 10 / 30 / 75 ms | 250 req/s per Gateway instance | 1 s / 20 req/s per device |
| Session completion/introspection | 99.95% | 20 / 75 / 150 ms | 200 req/s; 2,000 concurrent products | 2 s / 30 req/s per session |
| Sponsorship evaluation | 99.9% | 5 / 20 / 50 ms | 200 req/s; sponsor budget serializable | 1 s / 5 req/min per anti-Sybil subject |
| Bundler submission/receipt | 99.0% | provider-measured | provider quota plus queue age alert | 10 s submit; 120 s receipt |

Local benchmark evidence on 2026-07-22 evaluated 20,000 sponsorship requests in approximately 0.91 seconds on the development host; this is parser/policy throughput only, not network or user capacity. The soak gate performs 10,000 evaluations and asserts budget invariants.

The canonical Gateway adapter benchmark ran 1,000 complete in-process proof/introspection operations on Node v24.5.0, Darwin arm64 with zero failures: p50 2.931 ms, p95 3.318 ms, p99 4.208 ms, max 7.201 ms and 333.48 operations/second. It includes P-256 proof signing/verification, strict session introspection and sorted replay-state update. It excludes HTTP, disk, database, provider and public-network latency and therefore does not prove staging availability or user capacity. Machine-readable evidence is `proof/gateway-benchmark-local.json`.

Capacity measurements required before staging are provider latency, cold start, p50/p95/p99, throughput to saturation, concurrent sessions, queue age, storage growth per million sessions/audits, rate-limit response, error rate and 24-hour soak. Candidate recovery objectives are RTO 60 minutes and RPO 5 minutes for Gateway state; proof requires an encrypted backup/restore drill. Public SLO is not declared until staging measurement exists.
