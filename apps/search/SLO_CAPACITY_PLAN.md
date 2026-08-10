# YNX Search SLO and capacity plan

Status: local benchmark tooling implemented; staging and public SLO evidence remain pending.

## Service boundaries

The Search service covers the registered-authorized-source index, query API, source status, remedy intake, Wallet handoff preparation, citation-bound AI preparation and the web UI. External Search, central Wallet/Auth, central Trust, AI provider execution, Website deployment and public ranking are separate dependencies and must be reported separately.

## Candidate service objectives

These are targets for staging acceptance, not current production claims.

| Signal | Staging target | Public target | Current proof |
| --- | ---: | ---: | --- |
| Search API availability | 99.5% monthly | 99.9% monthly | Not yet measured remotely |
| Search API p50 | ≤ 100 ms | ≤ 100 ms | Local benchmark only |
| Search API p95 | ≤ 300 ms | ≤ 300 ms | Local benchmark only |
| Search API p99 | ≤ 750 ms | ≤ 750 ms | Local benchmark only |
| Server error rate | < 1% over 5 minutes | < 0.5% over 5 minutes | Runtime metrics implemented |
| Registered-source freshness | Per-source `freshnessSloSeconds` | Per-source contract | Source status implemented; remote corpus empty |
| Recovery time objective | ≤ 30 minutes | ≤ 30 minutes | Separate-path local restore drill passed |
| Recovery point objective | ≤ 24 hours | ≤ 24 hours | Backup schedule not yet deployed |

## Reproducible local benchmark

Run:

```bash
cd apps/search
npm run capacity
```

Optional bounded inputs:

- `YNX_CAPACITY_REQUESTS`: 1–110, default 80;
- `YNX_CAPACITY_CONCURRENCY`: 1–32, default 8;
- `YNX_CAPACITY_DOCUMENTS`: 1–500, default 40;
- `YNX_BUILD_COMMIT`: exact source commit to bind into the output.

The benchmark creates a temporary version-4 index with one authorized source, executes warm-up requests, runs loopback HTTP queries and emits machine-readable p50, p95, p99, maximum latency, throughput, status counts and environment details. Its scope is deliberately labeled local single-process loopback. It must not be used to claim staging, public or production scale.

## Required staging measurements

Before `deployedStaging` may represent the current source commit, capture:

1. exact deployed commit from `/api/health`;
2. 1, 10, 50 and 100 concurrent query profiles;
3. p50, p95 and p99 latency for empty, nominal and upper-bound approved corpora;
4. CPU, resident memory, event-loop lag and storage growth;
5. source crawl latency, backoff and freshness breach behavior;
6. metrics scrape continuity and alert delivery;
7. restart, backup, restore and rollback timing;
8. dependency unavailable behavior for Wallet, Trust, AI and external Search.

## Capacity gates

No capacity increase should be accepted unless all of the following remain true:

- no query or source content appears in metric labels or structured logs;
- rate limits remain fail-closed and return bounded errors;
- the index stays within the authorized data classes and retention rights;
- latency evidence is tied to an exact source and deployed commit;
- backup size, restore duration and reindex duration are measured at the same corpus size;
- third-party provider quotas and costs are recorded separately from local index capacity.

## Scaling path

1. Keep the current single-process implementation for bounded Testnet evaluation.
2. Establish staging measurements and corpus-size thresholds.
3. Add durable metric storage and central Monitor acceptance.
4. Introduce worker isolation for crawling before increasing source count.
5. Evaluate a versioned external index backend only after migration, rollback, data-right and recovery tests exist.
6. Re-run the same acceptance profile after every index schema, ranking or storage change.

## Known limits

- The process-local metric registry resets on restart.
- Latency percentiles in `/api/metrics` are not exported as histogram buckets yet; the reproducible benchmark produces exact sample percentiles.
- Current staging runs an older commit and an intentionally empty approved corpus.
- No external provider quota, public concurrent-user or production availability evidence exists.
