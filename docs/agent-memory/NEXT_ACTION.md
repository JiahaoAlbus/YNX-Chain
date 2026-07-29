# Next action

Create a deterministic, account-free Finance API capacity harness that exercises `/health`, protected-auth rejection and `/metrics` using local fixtures; record request count, concurrency, elapsed time, throughput, p50/p95/p99 latency and error rate. Then publish `apps/finance/SLO_CAPACITY_PLAN.md` with explicit local-only limits, alert thresholds, restart semantics and a statement that no production traffic capacity is claimed.

Acceptance for the next slice:

- benchmark input contains no Wallet account, bearer token, balance, activity or planning record;
- results are reproducible from a committed command or Go benchmark;
- metrics and logs remain free of financial data;
- targeted and race tests remain green;
- evidence is bound to a pushed source SHA.
