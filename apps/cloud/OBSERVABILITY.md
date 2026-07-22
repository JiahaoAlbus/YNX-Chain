# Observability

Public `GET /health` and `/health/live` expose only process liveness, release version/commit, source, and `asOf`. Detailed `GET /api/v1/health` requires a canonical Wallet session with `audit.read`; it reports schema, object/upload counts, provider boundaries, and configured limits. API errors are bounded and do not expose stack traces, credentials, or server paths. Audit events have IDs, actor, action, object, timestamp, and details.

Every HTTP response receives generated request and trace IDs; failures also receive an error ID. Requests produce JSON structured logs with correlated IDs, normalized route template, status, byte count, and duration. Object IDs and share tokens are never used as metric route keys.

Restricted `GET /api/v1/metrics` returns schema-v2 persistent RED telemetry: request/error/response-byte totals, bounded non-cumulative latency bins, saturation/rejection state, persistence health, exact source and coverage, and evaluated alerts. The integrity-checked `telemetry.json` is atomically replaced after fsync and survives process restart. Corrupt telemetry is preserved rather than overwritten and makes authenticated readiness fail. Recent request traces are capped at 200 and available through restricted `GET /api/v1/traces`; each record correlates trace, request, and error IDs without request bodies, credentials, object IDs, or raw paths.

Authenticated `GET /api/v1/ready` requires `audit.read` and checks state integrity, Wallet verifier binding, object-store/scanner binding, and telemetry persistence. Liveness remains a narrower public process signal and must not be used as readiness.

The server applies fixed-window limits to the direct TCP peer (never untrusted `X-Forwarded-For`) and fail-fast bounded concurrency. Defaults are 120 requests/minute/client and 128 in-flight requests; operators can lower them with `-requests-per-minute` and `-max-concurrent` only after load evidence. Rejections return `429` or `503`, an error ID, and `Retry-After`, and are counted separately in restricted metrics. This is single-process protection, not a distributed global limiter.

Machine-readable local dashboard and alert definitions are in `observability/dashboard.json` and `observability/alerts.json`. The service evaluates telemetry persistence, route error-rate, route p95, and backpressure alerts. Alert delivery is deliberately `not-configured`; these files do not claim a hosted dashboard, monitor integration, paging, or public status page.

Production observability is not complete. Remaining implementation includes object-store, scanner, queue, quota, and Wallet verifier child-span latency/error metrics; distributed trace export; multi-replica aggregation; persistent long-window histograms; hosted dashboard/alerts; status-page and support escalation integration. Current trace coverage is the control-plane HTTP boundary only.

Operators must use `OPERATIONS.md` for local recovery. Public alerts, monitor integration, incident evidence, and support escalation remain unproven.
