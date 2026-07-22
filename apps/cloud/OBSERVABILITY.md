# Observability

Public `GET /health` and `/health/live` expose only process liveness, release version/commit, source, and `asOf`. Detailed `GET /api/v1/health` requires a canonical Wallet session with `audit.read`; it reports schema, object/upload counts, provider boundaries, and configured limits. API errors are bounded and do not expose stack traces, credentials, or server paths. Audit events have IDs, actor, action, object, timestamp, and details.

Every HTTP response receives a generated request ID; failures also receive an error ID. Requests produce JSON structured logs with method, route, status, byte count, and duration. Restricted `GET /api/v1/metrics` returns current-process request/status counts and cumulative latency with explicit source, `asOf`, start time, and restart-limited coverage.

The server applies fixed-window limits to the direct TCP peer (never untrusted `X-Forwarded-For`) and fail-fast bounded concurrency. Defaults are 120 requests/minute/client and 128 in-flight requests; operators can lower them with `-requests-per-minute` and `-max-concurrent` only after load evidence. Rejections return `429` or `503`, an error ID, and `Retry-After`, and are counted separately in restricted metrics. This is single-process protection, not a distributed global limiter.

Production observability is not complete. Required next implementation: persistent RED histograms; object-store, scanner, queue, quota, and Wallet verifier latency/error metrics; traces across control plane and provider; authenticated readiness checks; alert rules and a dashboard tied to measured SLOs. No dashboard or status-page URL is claimed.

Operators must use `OPERATIONS.md` for local recovery. Public alerts, monitor integration, incident evidence, and support escalation remain unproven.
