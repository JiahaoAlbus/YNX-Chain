# SLO and capacity plan

No production SLO is claimed from local functional tests.

## Measured local metadata candidate

Exact evidence: `evidence/CAPACITY_077bfc1.json`, source commit `077bfc1423ae8b6be15b93b039e0ea3eb37abef3`. On Apple M2 / 8 GiB / Go 1.25.7, 100 repeated first-page scans over 1,000,000 in-memory owner objects (page size 200) measured p50 140.20 ms, p95 156.21 ms, p99 163.72 ms, max 224.05 ms, and 6.97 pages/s. Total allocation across 100 samples was 126,228,992 bytes.

This proves only a bounded-memory, single-process metadata candidate. It excludes persistence, HTTP, provider latency, grants-heavy authorization, concurrent users, sharding and replication. It cannot substantiate the candidate staging SLO or public scale. The benchmark is opt-in (`YNX_CAPACITY_PROFILE=1`) so ordinary tests do not allocate one million objects.

Candidate staging targets: API availability 99.9% monthly; metadata read p95 under 300 ms and p99 under 800 ms; upload-init p95 under 500 ms excluding object transfer; error rate under 0.5%; RPO 15 minutes; RTO 4 hours. These are targets, not measured results.

Required benchmark matrix: p50/p95/p99 latency, throughput and errors at 1/10/100/1,000 concurrent clients; 1k/100k/1m metadata objects; 1 MiB/100 MiB/5 GiB multipart objects; queue depth/backpressure; provider latency and rate-limit behavior; cold start; region failure; restore duration and data loss. Record hardware, provider/region, dataset, command, start/end time, source commit, and raw results.

Capacity decisions must follow measurements: stateless API replicas, durable queue workers, metadata partition key `(owner, objectId)`, provider-native multipart, checksum on every boundary, hot/cold/archive policy, CDN only for authorized immutable content, and explicit regional placement. Replication or erasure coding may be claimed only from provider configuration and restore evidence.

Implemented local protection: configurable 128 default in-flight cap with immediate `503` backpressure, and 120/minute/direct-client fixed-window rate limit with `429`. Both expose `Retry-After` and restricted counters. These bounds prevent unbounded local queues but do not prove target throughput or distributed enforcement.
