# YNX Pay SLO and capacity plan

## Scope and evidence rules

This plan covers the Pay product API, Merchant Console, native Pay clients and their calls through the canonical App Gateway to the authoritative Pay API. A target is not a measurement. Results may be added only with the source commit, UTC interval, workload, tool, raw log and environment.

## Service objectives

| Signal | Testnet objective | Measurement source | Current evidence |
|---|---:|---|---|
| Product API availability | 99.5% per 30 days | external probe of `/health` and a signed read | not measured |
| Settlement submission availability | 99.0% per 30 days | Gateway and product metrics, excluding Wallet rejection | not measured |
| Product API latency | p50 <= 150 ms; p95 <= 500 ms; p99 <= 1 s | server histogram by route | local loopback read gate: 1,000 requests at concurrency 25, 0 failures, 32,067.0 req/s, p50 0.633 ms, p95 1.495 ms, p99 2.888 ms |
| Authoritative settlement confirmation | p95 <= 30 s after committed block is queryable | intent-to-receipt trace | not measured |
| Webhook first attempt | p95 <= 5 s after persisted event | delivery queue histogram | not measured |
| Error rate | < 1% server errors per 30 minutes | route counter, excluding validated 4xx | not measured |
| RTO / RPO | 4 h / 15 min | timed restore drill and backup schedule | not proven |

Public Testnet and third-party provider latency must be reported separately from YNX-controlled latency. Quote creation, Wallet review, chain finality and webhook delivery are separate spans.

The 2026-07-29 loopback result covers only `/health` and `/version` in one process on a developer machine. It proves the repeatable harness and local observability overhead, not staging capacity, settlement throughput, multi-replica safety or the objectives above.

## Required load matrix

Run 1, 10, 50 and 100 concurrent clients for at least 15 minutes per level against a staging deployment. Cover invoice lookup, merchant state, signed settlement verification, refund request, dispute creation and webhook retry. Record p50/p95/p99, requests per second, concurrency, CPU, memory, open files, store growth, queue depth, provider latency, cold start and error classification. The current file-backed store has no supported multi-replica writer claim; capacity beyond a single process is unproven.

## Limits and backpressure

- Request bodies are limited to 1 MiB.
- Gateway assertions expire within five minutes and nonces are one-time.
- Webhook attempts use bounded exponential backoff and terminate in an operator-visible dead-letter state.
- Provider and chain rate limits must fail closed and surface `unavailable`; they must never synthesize settlement.
- Admission controls must be defined from measured saturation, not from the objectives above.

## Storage growth

Measure bytes per merchant, invoice, settlement, audit entry, dispute, refund and webhook attempt from real serialized snapshots. Until compaction and archive tests exist, retention growth is unbounded and production capacity is not established.
