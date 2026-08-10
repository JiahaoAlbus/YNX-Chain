# Bridge SLO and Capacity Plan

Current state: no remote Bridge deployment and no production-capacity claim.

The local coordinator must be measured separately for authenticated mutations, public transparency reads, persistence latency, relayer/provider latency, and destination confirmation latency. Required release evidence includes p50/p95/p99, sustained throughput, concurrent clients, queue depth, state-file growth, cold start, error rate, rate-limit behavior, and reconciliation age.

Provisional Testnet objectives, pending measurement:

- Coordinator API availability: 99.5% monthly, excluding declared maintenance.
- Public transparency freshness: at most five minutes after a persisted mutation.
- RPO: zero accepted coordinator mutations, using synchronous atomic persistence.
- RTO: 60 minutes after state restore and integrity verification.
- Provider outage behavior: fail closed; no destination-success transition without evidence.

The process-level verifier proves bounded correctness, not capacity. Load evidence must record hardware, OS, Go version, source commit, route count, transfer count, payload distribution, duration, and raw result artifact before any objective is promoted to a measured SLO.

`make bridge-capacity-check` launches the real compiled daemon and measures cold start, 500 empty transparency reads, 100 persisted transfer creates at concurrency four, and 500 loaded-state transparency reads at concurrency twenty. It records all samples and storage growth. This bounded local profile does not measure provider, destination-chain, remote network, or multi-instance behavior.

## Bounded local measurement

Evidence `capacity-evidence.json` is bound to source commit `2c391b0a0c6dcbc80bd22fc06e5c0ed66390b9a4` on Apple M2 / 8 logical CPUs / 8 GiB RAM / darwin-arm64:

- Cold start: 295.81 ms.
- Empty transparency, 500 requests at concurrency 20: p50 2.32 ms, p95 7.44 ms, p99 13.64 ms, 6,188.78 requests/s, zero failures.
- Persistent create, 100 requests at concurrency 4: p50 37.36 ms, p95 69.76 ms, p99 70.63 ms, 101.75 requests/s, zero failures.
- Loaded transparency, 500 requests at concurrency 20: p50 1.45 ms, p95 2.89 ms, p99 4.25 ms, 12,001.84 requests/s, zero failures.
- State grew 246,616 bytes for 100 transfer records.

These figures are one bounded local run. They do not establish the provisional availability objective, remote throughput, concurrent-user capacity, provider latency, destination finality, queue behavior, or production cost.
