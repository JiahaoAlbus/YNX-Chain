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

The local Smart Account benchmark ran 50 sequential bounded-session UserOperations through EntryPoint on Hardhat EDR with zero failures: 435.42 operations/second, p50 2.173 ms, p95 2.961 ms and p99 4.470 ms. It excludes external Bundler, RPC, persistence, network and YNX Testnet latency and is not a public capacity claim. Machine-readable evidence is `proof/smart-account-hardhat-local.json`.

The source-bound sponsorship run reserved and executed 25 Paymaster-funded operations with zero failures: 266.60 operations/second, p50 3.738 ms, p95 4.182 ms and p99 4.284 ms on local Hardhat EDR. The isolated ERC-7769 fixture processed 100 strict estimate responses with zero failures: 790.95 operations/second, p50 0.829 ms, p95 2.668 ms and p99 4.949 ms. Both exclude public provider, network, persistence and queue latency and are regression evidence only; see `proof/sponsorship-bundler-hardhat-local.json`.

Capacity measurements required before staging are provider latency, cold start, p50/p95/p99, throughput to saturation, concurrent sessions, queue age, storage growth per million sessions/audits, rate-limit response, error rate and 24-hour soak. Candidate recovery objectives are RTO 60 minutes and RPO 5 minutes for Gateway state; proof requires an encrypted backup/restore drill. Public SLO is not declared until staging measurement exists.
