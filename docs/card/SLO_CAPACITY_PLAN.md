# YNX Card SLO and Capacity Plan

Source baseline: `d79872f5df4da0566e11ef40e5314ea68d9846f4`  
Local benchmark host: Apple M2, macOS arm64, Go benchmark process only  
Status: local engineering evidence; no staging or production SLO claim

## Proposed service indicators

| Indicator | Measurement |
|---|---|
| Availability | Successful non-client-error requests / eligible requests, excluding planned maintenance |
| Read latency | p50, p95 and p99 for `/v1/account/state`, `/v1/account/export`, `/health`, `/ready` |
| Mutation latency | p50, p95 and p99 for application, controls, transition, dispute and privacy deletion routes |
| Issuer readiness | Time with issuer known and available, plus transition count |
| Correctness | Rate of stable Card error codes, audit creation failures, replay rejection and state-integrity failures |
| Privacy operations | Export success, delete success/failure, retention last-success age and provider-closure failure |
| Recovery | Verified backup age, restore drill duration and rollback verification |

## Initial Testnet objectives

These are targets to validate on shared Testnet, not achieved production SLOs:

- Monthly API availability: 99.5% for the Card service excluding periods when the configured issuer is intentionally unavailable.
- Read-path p95: under 250 ms at the service boundary.
- Local-state mutation p95 excluding issuer network time: under 500 ms.
- Provider-backed mutation p95: under 2 seconds, with explicit timeout and no fabricated success.
- Error budget: 0.5% monthly for service-originated eligible failures.
- Privacy export completion: under 5 seconds for the approved maximum account-state size.
- Account deletion: no partial local erasure; provider closure failure must result in zero local deletion.
- Retention job freshness: one successful run within each approved schedule interval.
- Backup RPO/RTO: to be set only after encrypted off-host storage and timed restore evidence exist.

## Local benchmark evidence

Command:

```text
go test -run ^$ -bench Benchmark -benchtime=1s -benchmem ./internal/cardproduct
```

Result after no-op persistence elimination:

| Benchmark | Result | Allocated bytes | Allocations |
|---|---:|---:|---:|
| `BenchmarkCardStateRead-8` | 54,236 ns/op | 20,493 B/op | 133 allocs/op |
| `BenchmarkAccountExport-8` | 145,528 ns/op | 45,855 B/op | 315 allocs/op |

A first benchmark exposed account export at approximately 33.1 ms/op because retention performed a durable state rewrite even when no records expired. `Store.Update` now skips persistence when the post-callback snapshot is deeply equal to the pre-update snapshot. The Card package tests remained green, and export improved to approximately 0.146 ms/op on the same host/run class.

These microbenchmarks are single-process, warm-cache, local-filesystem measurements. They do not include HTTP, TLS, Gateway, issuer, shared storage, container, network, tracing or concurrent-load overhead and must not be presented as staging or production capacity.

## Capacity test matrix still required

1. HTTP load at 1, 10, 50 and 100 concurrent clients with realistic account-state sizes.
2. Separate issuer-unavailable, issuer-latency and issuer-error scenarios.
3. Large event histories up to the approved maximum state size.
4. Concurrent idempotent mutations, replay attempts and privacy operations.
5. Retention over large notification/AI/idempotency/replay maps.
6. Backup, verify and restore under representative state sizes and storage classes.
7. Memory, file-descriptor and goroutine growth under a 60-minute soak.
8. Mobile cold start, deep-link callback and secure-state unlock on representative Android/iOS devices.

## Scaling and safety rules

- Keep HTTP metric labels bounded; never add account/Card/provider/event identifiers.
- Do not scale by weakening HMAC, replay, audit or persistence guarantees.
- Provider timeouts and circuit breaking must preserve explicit unavailable/error states.
- Privacy deletion remains serialized per service instance and fail-closed against provider closure.
- Horizontal scaling requires a shared authoritative store, distributed nonce/idempotency semantics and tested audit ordering; the current local file store is not a multi-replica production database.
- Capacity claims require the exact source SHA, configuration, host class, dataset, command, raw results and failure thresholds.

## Promotion gate

Before `deployedStaging=true`, owner 13/30 must accept scrape and alert contracts, a shared Testnet load run must meet the initial objectives, and the resulting evidence must bind to the deployed SHA. Before any production SLO, an official issuer, shared state architecture, backup/restore RPO/RTO and incident escalation path must be approved and tested.
