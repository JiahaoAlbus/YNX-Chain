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
