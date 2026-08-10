# YNX Exchange observability

Status date: 2026-07-22. This document distinguishes implemented local signals from deployment objectives.

## Implemented signals

- `GET /health`: process liveness and immutable product/build identity. `status=live` does not claim dependency readiness or public availability.
- `GET /ready`: verifies the in-memory persisted-state integrity hash, audit chain, execution-event chain and current schema. Success is `ready_local_engine`; it also reports integration state and `deployedPublic=false`.
- `GET /metrics`: Prometheus text counters for non-WebSocket HTTP requests, internal HTTP 5xx responses, in-flight requests and cumulative request duration.
- `X-Request-ID`: an incoming 8–128 character `[A-Za-z0-9._-]` identifier is propagated; invalid or absent values are replaced with a random 128-bit hexadecimal identifier.
- Failed HTTP responses include a stable low-cardinality `code`, the safe existing `error` message, `requestId` and random `errorId`; headers repeat both identifiers. Unknown internal errors are redacted.
- The server process emits JSON logs for startup, scheduler failures and HTTP completion. Request logs contain request/error ID, method, normalized route pattern, status and duration; they do not include authorization, body, account, signature or raw object path.
- A bounded direct-peer fixed-window limiter permits 300 requests/minute and caps peer state; a 128-slot process concurrency gate fails excess work with correlated `429`/`503`, `Retry-After`, and rejection logs. Forwarded headers are not trusted by this control.
- Persisted IDs and chains: every ledger, audit and execution object has a stable ID; audit and execution events are hash chained. Market/User/Drop Copy streams expose monotonic execution sequences.
- Build identity: `/health` and `/version` report product ID, version and build commit.

Direct evidence: `TestHTTPStrictParsingScopeAndSmoke`, execution-chain tamper/replay tests, and `internal/exchangeproduct/server.go`.

## Signal semantics and gaps

`/health` is only liveness. `/ready` proves local engine/state readiness but does not prove Gateway, custody, indexer, public ingress, storage durability class, or production signing. Integration status remains explicit in the readiness response.

Current metrics are process-lifetime aggregates. The limiter is single-process and fixed-window; distributed ingress enforcement and deployment-specific tuning remain required. Histograms, route/method labels, WebSocket connection/lag/slow-consumer metrics, matching latency, queue depth, storage/fsync duration, provider latency, business rejection reasons, dead-man/TWAP scheduler lag and ledger-conservation gauges remain missing. Distributed traces, dashboards, alerts, status-page publication and monitor integration remain missing.

## Required low-cardinality metrics

- HTTP count/duration by normalized route, method and status class; never raw account, order ID, address or request path.
- Accepted/rejected/filled/cancelled orders by market/order policy/reason; explicit maker/taker fees.
- Open orders, reserved balance totals, event sequence, replay lag, WebSocket connections and dropped/slow consumers.
- Persistence bytes, fsync/rename duration, backup age/result and restore result.
- Gateway/indexer request count, latency, timeout, rate limit and circuit state.
- Dead-man expiry/sweep lag and TWAP due/executed/rejected lag.

## Alert objectives

- Page: readiness fails for 2 minutes; state integrity failure immediately; ledger conservation failure immediately; backup/restore verification failure; p99 order acceptance >100 ms for 10 minutes; internal error rate >1% for 5 minutes.
- Ticket: p95 >50 ms for 30 minutes; storage growth >reviewed forecast; replay lag >10 seconds; integration degraded for 15 minutes.
- Every alert must carry service, environment, source commit, runbook link, first/last seen and a redacted request/error/audit correlation identifier.

No SLO dashboard or status page is claimed as deployed. Targets and measured local capacity are in `SLO_CAPACITY_PLAN.md`.
