# YNX Shop SLO and Capacity Plan

Updated: 2026-07-29

Current implementation source: `a9f9ff932ede1091882509a219755b4b18a88c92`

Metrics and load-test implementation source: `14984342ebf49f0b9a1f5ec516b1aef99c6e8879`

## Current evidence boundary

YNX Shop has a reproducible local read-capacity test and Prometheus instrumentation. It does not yet have current-source Staging, public traffic, multi-host load, production provider latency, database saturation evidence, or a public SLO history. The numbers below must not be presented as Internet or production capacity.

## Measured local baseline

Environment:

- Apple M2, darwin arm64
- in-memory Shop persistence
- `httptest` HTTP server on loopback
- 24 published products and 48 variants
- 3,000 `GET /api/products?q=field` requests
- concurrency 32
- zero request failures

Observed once on 2026-07-29:

| Measure | Result |
| --- | ---: |
| p50 | 1.475 ms |
| p95 | 4.455 ms |
| p99 | 5.860 ms |
| Throughput | 16,060.64 requests/second |
| Elapsed | 186.792 ms |

The test also reconciled the Prometheus request counter to exactly 3,000 successful catalog reads.

A separate Go benchmark produced three samples between 1,764 and 4,064 ns/op, with 2,244 B/op and 27 allocations/op. That benchmark measures handler execution, not network service capacity.

## Candidate service objectives

These are proposed gates for current-source Staging and require measured evidence before becoming contractual SLOs.

| Signal | Candidate target | Measurement boundary |
| --- | --- | --- |
| Public catalog availability | 99.9% monthly | successful non-5xx catalog responses from at least two probes |
| Catalog latency | p95 ≤ 250 ms, p99 ≤ 750 ms | end-to-end Staging request including ingress and persistence |
| Authenticated order API availability | 99.5% monthly | excludes declared Wallet/Pay maintenance windows; dependency failures remain visible |
| Mutation durability | zero acknowledged mutation loss | restart/restore digest and workflow replay evidence |
| Oversell correctness | zero successful oversells | concurrent checkout invariant and audit reconciliation |
| Metrics freshness | 99% of scrapes within two intervals | private monitoring path only |
| Recovery point objective | ≤ 15 minutes candidate | requires automated backup cadence and verified artifact timestamps |
| Recovery time objective | ≤ 60 minutes candidate | requires full environment restore drill |

No error-budget calculation is active until a current-source environment and retained measurements exist.

## Capacity gates before public release

1. Run the same fixed fixture against packaged current-source Shop on Staging, not `httptest`.
2. Measure read and authenticated mutation workloads separately.
3. Exercise inventory contention, idempotent replay, order creation, privacy export, and terminal deletion.
4. Include Wallet Gateway, Pay, Trust, persistence, ingress, TLS, and monitoring overhead.
5. Run at least 15 minutes per steady-state tier and a bounded burst test.
6. Record CPU, memory, file descriptor, persistence latency, request latency, errors, queueing, and state growth.
7. Prove backup and restore under representative state volume.
8. Define the safe operating limit below the first saturation knee; do not publish the maximum synthetic result as supported capacity.
9. Re-run after schema, provider, hardware, ingress, or runtime changes.

## Initial workload matrix

| Workload | Concurrency tiers | Required checks |
| --- | --- | --- |
| Catalog search/read | 1, 16, 32, 64, 128 | latency, allocation, response size, no state mutation |
| Product detail | 1, 16, 32, 64 | latency, media metadata bounds, 404 behavior |
| Cart/profile | 1, 8, 16, 32 | authenticated binding, persistence latency, rate limit |
| Inventory/order create | 2, 8, 16, 32 contenders | no oversell, exact reservation count, idempotency |
| Payment confirmation | 1, 4, 8 | Pay evidence matching, timeout, replay, unavailable state |
| Privacy export/delete | 1, 4 | bounded output, active-order refusal, retained evidence |
| Seller catalog mutation | 1, 4, 8 | role enforcement, revision history, persistence and audit |

## Scaling constraints

- Current persistence is a single atomic snapshot protected by one Store mutex. This favors correctness and simple recovery but limits horizontal mutation scaling.
- Every persistent rate-window update can trigger state persistence. High mutation traffic must be measured with the real filesystem and integrity HMAC enabled.
- Provider calls introduce external latency and failure modes that the local catalog baseline does not include.
- Public assets, APK hosting, CDN behavior, and browser performance are separate from API capacity.
- Horizontal Shop replicas require a centrally owned persistence/consistency design; independently writable snapshot replicas are not approved.

## Release decision rule

A release candidate passes capacity review only when the exact source commit, artifact digest, environment configuration class, fixture size, command, raw output, and limitations are recorded. A local pass cannot set `deployedStaging`, `deployedPublic`, or a production SLO field to true.
