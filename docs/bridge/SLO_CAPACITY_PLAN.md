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

Evidence `capacity-evidence.json` is bound to source commit `03bdf94ccfa879b4df390ffa189f8b0e2c553168` on Apple M2 / 8 logical CPUs / 8 GiB RAM / darwin-arm64:

- Cold start: 333.77 ms.
- Empty transparency, 500 requests at concurrency 20: p50 2.61 ms, p95 7.62 ms, p99 9.29 ms, 6,125.40 requests/s, zero failures.
- Persistent create, 100 requests at concurrency 4: p50 38.02 ms, p95 42.02 ms, p99 51.03 ms, 109.25 requests/s, zero failures.
- Loaded transparency, 500 requests at concurrency 20: p50 1.63 ms, p95 4.48 ms, p99 11.76 ms, 8,494.41 requests/s, zero failures.
- State grew 172,916 bytes for 100 transfer records.

These figures are one bounded local run. They do not establish the provisional availability objective, remote throughput, concurrent-user capacity, provider latency, destination finality, queue behavior, or production cost.
