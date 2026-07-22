# Observability

## Implemented local signals

- `/health` reports direct process liveness and local-store readability while keeping central Pay and Gateway readiness `unverified`; it does not emit a fixed success boolean.
- Every HTTP response carries `X-Request-ID` and `X-Trace-ID`. Errors also carry a random `X-Error-ID`, and the JSON error body contains the same request/error IDs plus a stable error code.
- JSON request logs contain request ID, trace ID, matched route template, status, duration, response bytes, redacted merchant role and error ID. They never include URL query, request body, authorization header or credentials.
- Central Pay and AI outbound requests propagate the request ID and W3C `traceparent`.
- `GET /internal/metrics` returns direct in-process counts, response bytes, total/max duration and bounded duration buckets by HTTP method, matched route template and status. It fails closed unless `YNX_PAY_PRODUCT_MONITOR_KEY` contains at least 24 characters and the caller sends it as `X-YNX-Monitor-Key`.
- Provider connection tests persist source/version/coverage/check time/last success/failure code. Mutations append integrity-protected audit entries; webhook attempts preserve HTTP status and retry state.

The runtime metrics are process-local and reset on restart. They are evidence inputs, not a production availability or capacity claim.

Required before staging SLO claims:

- OpenTelemetry traces across Gateway, Merchant service, Pay, Trust and provider adapters.
- Durable metrics export for auth rejection reason, session expiry/revoke, invoices, settlement outcome, webhook queue/attempts, reconciliation lag, provider rate limits and store growth.
- Alerts tied to error budget, queue age, provider outage, integrity failure and backup age.
- Versioned health/readiness endpoints, SLO dashboard, status page and incident/runbook links.

Never log bearer tokens, Gateway signatures, webhook secrets, merchant HMAC, private keys, request bodies containing secrets, local paths or provider credentials. UI errors must use supportable error IDs and never expose stack traces.
