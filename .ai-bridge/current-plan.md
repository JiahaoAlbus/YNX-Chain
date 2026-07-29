# YNX Finance Active Plan

## Current stage

FREEZE. The latest validated product source is `d2e20f4dcb17012b3d30eae7aa348ab245f37324` on `codex/final-finance`; it was pushed and local/remote source SHA equality was verified. Authenticated recovery remains protected at `23bcdea565bcfcb7d211512e654f916faf817df3`, and the fail-closed source consumer boundary remains protected at `592195a1a4c5bed434d984482a1e87202de213ce`.

## Protected scope

- Explorer health/native-asset validation, bounded activity and explicit provenance.
- Account/snapshot-bound HMAC-SHA-256 activity cursors.
- Version-1 strict Finance state validation, authenticated backup and offline restore.
- Finance-owned `finance-source-read-envelope-v1` consumer proposal and fail-closed pending sources.
- Validated/generated `X-Request-ID` correlation and stable `YNX-FIN-*` error IDs.
- Structured JSON route/status/latency logs with financial data, tokens, bodies, query strings and remote addresses excluded.
- Protected `GET /metrics` using a distinct `YNX_FINANCE_OPERATIONS_KEY`.
- Versioned `finance-metrics-v1` process counters for route/status/latency and source outcomes with explicit restart reset semantics.

## Verified gates

- `go test ./internal/finance ./apps/finance/cmd/server ./apps/finance/cmd/admin -count=1`
- `go test -race ./internal/finance ./apps/finance/cmd/server ./apps/finance/cmd/admin -count=1`
- `npm run smoke --prefix apps/finance` — Finance security gate and 8/8 product/Web/Wallet vectors passed.
- `bash scripts/validate/no-placeholder-check.sh`
- `bash scripts/validate/secret-scan.sh`
- `git diff --check`

Dedicated observability tests cover request-ID propagation and replacement, stable error correlation, fail-closed metrics authentication, route/status/source counters, financial-data exclusions and process restart reset. No central Monitor integration, persistence, deployed alerting or production capacity is claimed.

## GitHub truth

- Source branch pushed: true.
- PR for `codex/final-finance`: none found before the current metadata checkpoint.
- Workflow runs attached to source SHA: none returned before a PR trigger.
- GitHub Release for source SHA: not claimed.

## Next autonomous slice

Create a deterministic account-free Finance API capacity harness. Measure local request count, concurrency, throughput, error rate and p50/p95/p99 latency for `/health`, protected-auth rejection and authenticated `/metrics`. Publish `apps/finance/SLO_CAPACITY_PLAN.md` with local-only thresholds, alert semantics and explicit non-production limits.

## Following priority

Create `UNIT_ECONOMICS.md`, prepare the exact `finance-metrics-v1` handoff for Monitor/Data Fabric, open the Finance PR and verify CI for its exact final SHA. Central Wallet acceptance, owner source contracts, authorized Pay smoke, shared Testnet proof, staging, public deployment and production signing remain incomplete.
