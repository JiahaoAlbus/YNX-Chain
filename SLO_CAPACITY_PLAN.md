# YNX Data Fabric SLO and Capacity Plan

## Measurement status

No public capacity or availability claim is approved yet. The current single-node JSON state file rewrites the complete state on every commit and is not suitable for a high-throughput or multi-writer claim.

## Exploratory local measurement

`internal/datafabricapi/account_isolation_test.go` now exercises 100 simultaneous canonical account sessions against the real local file Store and API handler under Go Race. The Store is preloaded with one signed event per product/account/session, all requests start together, and every response must contain exactly the requesting account's event. All 100 passed with zero isolation or request failures. This is a bounded concurrency and authorization-correctness test; it does not measure producer append throughput, latency percentiles, PostgreSQL, JetStream, hot partitions, backpressure, shared Testnet or public capacity.

`evidence/capacity/api-1000-producers-clean-source-20260814.json` records a clean-source run at `59c60864ac433bdf474ce16f9199533907017deb` on Darwin arm64, Go 1.25.13 and 8 logical CPUs. One thousand independently keyed producer clients were released from one start barrier through real loopback HTTP. A server-side admission limit of 64 reached an observed peak of exactly 64 and returned 15,971 bounded `429 producer_backpressure` responses across 16,971 attempts; every client honored `Retry-After` with jitter, and all 1,000 events eventually committed with zero business errors. End-to-end producer p50/p95/p99 were 18,715.501/39,943.625/41,917.306 ms, maximum 42,683.958 ms, and aggregate throughput was 23.366 events/s. The undrained transactional Outbox queue depth was exactly 1,000. State size was 1,810,846 bytes, or 1,810.846 bytes per event.

This result validates bounded concurrency, explicit backpressure, retry-safe nonces, queue accounting and correctness for the local file Store. Its 94.108% attempt-level backpressure rate and nearly 40-second p95 also show that the atomic JSON implementation is not a production throughput path. The run did not include TLS termination, PostgreSQL, JetStream publication, a partition hotspot, database restart, consumer crash, long replay, availability, RTO/RPO or public network behavior and must not be extrapolated to them.

`evidence/capacity/local-clean-source-20260729.json` records a clean-source sample bound to `645c1080f2ff054ec16a62800a778f62c861cc6d` on Darwin arm64, Go 1.25.12, 8 logical CPUs, 500 events and concurrency 8. Append p50/p95/p99 were 117.887/149.999/177.217 ms, maximum 194.093 ms, with 67.226 events/s overall. Dispatching 500 records to the append-and-fsync event log took 11,575.723 ms; idempotent replay took 10,018.630 ms. Cold reopen took 7.073 ms, integrity audit 5.747 ms, state was 1,082,505 bytes and event log 774,757 bytes. No operation error occurred. This is exact local evidence for the bounded single-process file implementation, not a PostgreSQL, JetStream, shared-Testnet, availability or public-scale claim.

`evidence/capacity/local-working-tree-20260722.json` records a dirty-working-tree sample on Darwin arm64, Go 1.25.7, 8 logical CPUs, 200 events and concurrency 4. Append p50/p95/p99 were 65.353/73.031/120.950 ms, maximum 125.897 ms, with 61.623 events/s overall. Dispatching 200 records to the append-and-fsync event log took 5121.913 ms; idempotent replay took 4085.531 ms. Cold reopen took 2.921 ms, integrity audit 2.282 ms, state was 413,877 bytes and event log 294,089 bytes. No operation error occurred.

This measurement is exploratory because the working tree was uncommitted and the sample is small. It directly contradicts any high-throughput claim and establishes the database/broker replacement gate. Final evidence must rerun at the exact committed source and larger controlled workloads.

`evidence/capacity/postgresql-17.10-dirty-20260722.json` records a second dirty-worktree sample against one local PostgreSQL 17.10 process: 1,000 one-event partitions at concurrency 8, with zero observed errors. Atomic event+Outbox commit latency was p50/p95/p99 1.378/5.045/7.040 ms, maximum 9.761 ms, and aggregate throughput 4,667.967 events/s. Leasing and acknowledging the 1,000 Outbox rows took 135.227 ms (7,377.082 records/s); full integrity audit took 33.895 ms; the database occupied 12,859,059 bytes. The initial attempt exposed severe serializable cross-partition predicate conflicts, which were removed by using a transaction-scoped partition lock and aggregate sequence row at `READ COMMITTED`; the successful sample was run only after direct duplicate/gap/integrity tests passed again.

This is still a small single-process sample on a dirty tree. Each event used a distinct aggregate, broker publication was excluded, and no hot partition, sustained load, journal, Saga, reconciliation, replica, failover, disk-full, backup/restore, or public network behavior was measured. It must not be extrapolated to the candidate SLO or public capacity.

## Candidate Testnet objectives

These are targets to test, not achieved values:

- Canonical event commit availability: 99.9% monthly in Testnet, excluding declared maintenance.
- Event commit latency: p95 below 250 ms and p99 below 750 ms at the tested steady-state load.
- Outbox dispatch delay: p95 below 1 second while the local bus is healthy.
- Ledger posting latency: p95 below 300 ms while full balance/link validation is enabled.
- Reconciliation completion: 99% of scheduled runs within 15 minutes when every required authority is available.
- RPO: zero committed journal entries; RPO for the event-log copy must be measured under crash injection.
- RTO: 30 minutes for the first Testnet objective, subject to a timed restore drill.

## Required experiments

Measure p50/p95/p99, throughput and error rate for event append, dispatch, Inbox effect, journal post, Saga transition, reconciliation and audit export. Run cold start and warm start at increasing event/journal sizes. The 1,000-producer local HTTP gate is now evidenced; repeat it on PostgreSQL plus JetStream, then test aggregate partition skew and hot accounts, bounded broker queue/backpressure behavior, duplicates, sequence gaps, consumer crash, crash after publish/before acknowledgement, broker outage, DLQ recovery, long replay, schema rejection, disk-full, truncated state, storage growth and restored cold start.

Record hardware, OS, Go version, source commit, release, command, duration, sample count, concurrency and raw output. A small local sample can characterize only that sample and must not be extrapolated to public scale.

## Scaling decision

The transaction-capable PostgreSQL repository and JetStream adapter now exist and have bounded local execution evidence. Before staging, prove them together under sustained load, hot-partition skew, replica/leader failure, network partition and crash-boundary injection. Preserve the same envelope, Outbox, Inbox, ordering and ledger invariants. CDC is a candidate for Outbox publication only after crash/duplicate semantics and source transaction boundaries are verified.
