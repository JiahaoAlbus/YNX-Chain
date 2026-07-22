# Observability

`GET /health` reports release version, exact commit when configured, object-store boundary, AI availability, and truthful health. API errors are bounded and do not expose stack traces, credentials, or server paths. Audit events have IDs, actor, action, object, timestamp, and details.

Production observability is not complete. Required next implementation: structured request logs with request/error/audit IDs; RED metrics; object-store, scanner, queue, quota, and Wallet verifier latency/error metrics; traces across control plane and provider; restricted readiness versus public liveness; alert rules and a dashboard tied to SLOs. No dashboard or status-page URL is claimed.

Operators must use `OPERATIONS.md` for local recovery. Public alerts, monitor integration, incident evidence, and support escalation remain unproven.
