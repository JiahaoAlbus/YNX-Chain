# SLO and capacity plan

No production SLO is claimed from local functional tests.

Candidate staging targets: API availability 99.9% monthly; metadata read p95 under 300 ms and p99 under 800 ms; upload-init p95 under 500 ms excluding object transfer; error rate under 0.5%; RPO 15 minutes; RTO 4 hours. These are targets, not measured results.

Required benchmark matrix: p50/p95/p99 latency, throughput and errors at 1/10/100/1,000 concurrent clients; 1k/100k/1m metadata objects; 1 MiB/100 MiB/5 GiB multipart objects; queue depth/backpressure; provider latency and rate-limit behavior; cold start; region failure; restore duration and data loss. Record hardware, provider/region, dataset, command, start/end time, source commit, and raw results.

Capacity decisions must follow measurements: stateless API replicas, durable queue workers, metadata partition key `(owner, objectId)`, provider-native multipart, checksum on every boundary, hot/cold/archive policy, CDN only for authorized immutable content, and explicit regional placement. Replication or erasure coding may be claimed only from provider configuration and restore evidence.

Implemented local protection: configurable 128 default in-flight cap with immediate `503` backpressure, and 120/minute/direct-client fixed-window rate limit with `429`. Both expose `Retry-After` and restricted counters. These bounds prevent unbounded local queues but do not prove target throughput or distributed enforcement.
