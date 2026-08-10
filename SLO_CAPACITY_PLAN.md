# SLO and Capacity Plan

No current-source load or long-soak dataset exists. The values below are proposed acceptance thresholds, not measured performance, contractual commitments, or achieved SLOs. The recovered public runtime is an older producer/follower release and cannot supply performance evidence for this branch.

## Proposed service objectives

| Signal | Proposed threshold | Measurement window | Current evidence |
| --- | --- | --- | --- |
| Consensus liveness | no unexplained block-production stall over 2 expected block intervals | rolling 30 days | unavailable for current source |
| Committed transaction latency | p50 ≤ 6 s, p95 ≤ 12 s, p99 ≤ 24 s | at least 10,000 signed transactions across 3 regions | unavailable |
| RPC read latency | p50 ≤ 150 ms, p95 ≤ 500 ms, p99 ≤ 1,500 ms | at least 100,000 requests, cached and uncached separated | unavailable |
| Gateway mutation latency | p50 ≤ 7 s, p95 ≤ 15 s, p99 ≤ 30 s | committed responses only; failures reported separately | unavailable |
| Gateway read latency | p50 ≤ 200 ms, p95 ≤ 750 ms, p99 ≤ 2,000 ms | each route family reported separately | unavailable |
| Public availability | ≥ 99.9% monthly per critical read endpoint | independent eligible vantage, one-minute probes | unavailable |
| Error rate | < 0.1% unexpected 5xx; business rejections excluded and counted separately | rolling 30 days | unavailable |
| Indexer freshness | p95 lag ≤ 2 blocks, p99 ≤ 5 blocks | rolling 24 hours under load | unavailable |
| Recovery | proposed RTO ≤ 60 min, RPO = last committed AppHash | isolated restore drill | no current-source drill |

These thresholds must be revised from measured baselines before release. A timeout, retry, cache, or reduced test load cannot be changed merely to make a threshold pass without recording the change.

## Required capacity experiment

Test 4, 7, 13, and 21 validators in at least three regions. For each topology, run stepped load through native transfers, UserOperations, staking, Quant, Pay, Trust, resource, EVM, and read-only traffic. Report offered/accepted/committed throughput, p50/p95/p99, queue depth, mempool rejection, block size, CPU, memory, disk IOPS, network, state growth, indexer lag, and error classes. Separate warm/cold starts, cache hits/misses, valid/business-rejected/malformed requests, and provider latency.

Each run must record source commit, immutable binary and configuration hashes, hardware, OS, topology, validator power, workload seed, duration, client concurrency, request mix, payload sizes, failure injection, raw samples, UTC start/end, and cleanup. Minimum acceptance runs are 60 minutes per step, 24 hours at expected peak, and a 7-day soak. StreamBFT additionally requires Comet differential replay and identical state roots.

## Fault and congestion matrix

Measure normal operation, one validator stopped and recovered, Byzantine leader, equivocation, 10/50/200 ms injected latency, 1/5/10% loss, regional partition, clock drift, disk pressure, process crash, state sync, snapshot restore, RPC dependency loss, indexer restart, and ingress failure. Trading, liquidation, cancel, Pay, Trust appeal, Wallet recovery, and bulk traffic must be independently shaped so one congested lane cannot starve safety-critical lanes.

## Storage and retention

Measure block, AppHash state, index, audit, log, snapshot, backup, and metrics growth per 1,000 transactions and per day. Retention and pruning policy remain undecided until those measurements and legal/data-right requirements exist. Capacity approval must include 30/90/365-day projections, free-space alerts, compaction impact, backup bytes/time, restore bytes/time, and state-sync serving cost.

## Evidence format

Publish raw machine-readable samples plus a summary containing count, p50, p95, p99, maximum, throughput, concurrency, error rate, confidence/coverage, source, as-of time, version, and failure state. Public claims require an eligible independent vantage and exact deployed release equality. Local unit/race tests and bounded smoke probes do not count as capacity results.
