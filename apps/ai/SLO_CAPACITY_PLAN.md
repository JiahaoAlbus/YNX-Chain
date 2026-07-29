# YNX AI SLO and capacity plan

## Measurement status

YNX AI has a reproducible local health-path capacity gate. Shared-Testnet, provider-backed streaming, cross-region, soak, public availability, storage-growth, queueing, and disaster-recovery measurements do not yet exist and are not claimed.

The protected local evidence at source commit `1cfc0c5085032a3a83745a8e65879d87aa223c63` ran 1,000 requests with concurrency 25 and recorded:

- 0 failures;
- 17,745.2 requests/second;
- p50 0.799 ms;
- p95 4.916 ms;
- p99 9.368 ms.

This result covers only the in-process `/healthz` path on one development host. It excludes Wallet verification, Gateway network transit, Provider latency, SSE duration, attachment I/O, mobile networks, public routing, and multi-region behavior.

## Enforced local gate

`TestLocalHealthCapacityEvidence` fails when any of these conditions is true:

- any request fails;
- p99 exceeds 250 ms;
- throughput falls below 100 requests/second.

Run it with:

```sh
go test -count=1 -run TestLocalHealthCapacityEvidence -v ./internal/aiproduct
```

These thresholds are regression guards, not production SLOs.

## Proposed staged measurements

Before `deployedStaging=true`, owner 14 and owner 30 must capture immutable evidence for:

1. liveness and dependency readiness separately;
2. API p50, p95, and p99 for read/write routes;
3. generation time-to-first-token and complete-stream duration;
4. active and peak concurrent streams;
5. Gateway and Provider latency contribution;
6. quota, local rate-limit, timeout, cancellation, malformed-stream, and dependency-failure rates;
7. queue depth and backpressure behavior when concurrency exceeds the configured limit;
8. cold-start time and restart recovery;
9. encrypted state growth per conversation, message, and attachment;
10. sustained soak behavior and memory/file-descriptor growth;
11. backup duration, restore duration, achieved RPO, and achieved RTO;
12. regional and public-route availability after deployment.

No numeric production target should be promoted to an SLO until the corresponding workload, traffic class, region, dependency set, and measurement window are frozen.

## Capacity controls already present

- session-bound request limiting;
- stricter generation request limiting;
- bounded JSON bodies, prompts, lists, context, and attachments;
- bounded generation timeout;
- owner-bound cancellation;
- low-cardinality metrics;
- fail-closed production authentication;
- truthful Provider and Gateway failure states.

## Required next harnesses

- authenticated API mixed-workload load test;
- concurrent SSE stream and cancellation test;
- Provider latency and quota fault injection;
- encrypted-store growth and restart soak test;
- backup/restore drill with checksum verification;
- staging cross-region probe;
- Monitor alert and incident-runbook rehearsal.

Until those measurements exist, `testnetVerified`, `deployedStaging`, `deployedPublic`, and public availability claims remain false.
