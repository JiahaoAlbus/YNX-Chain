# Economics Observability

`/api/economics/disclosure` accepts a valid `X-Request-ID` or generates one, accepts W3C `traceparent` correlation or generates a Trace ID, and returns both in headers and JSON. Failures add an opaque Error ID. A structured JSON log records these IDs, status and handler latency without request bodies or credentials. This is local trace correlation, not an exported distributed trace. The response also publishes source commit, source, as-of, version, coverage, confidence and failure state. `/api/economics/health` is an independent process-local reference-model health boundary and includes build identity. It does not claim RPC, indexer, public ingress or third-party health.

Prometheus output on `/metrics` includes:

- `ynx_explorer_economics_disclosure_requests_total`
- `ynx_explorer_economics_disclosure_errors_total`
- `ynx_explorer_economics_disclosure_latency_seconds` histogram at 1, 5, 10, 50, 100 and 500 ms plus infinity
- `ynx_explorer_economics_disclosure_last_success_timestamp_seconds`

The repository Grafana dashboard and Prometheus rules cover request/error rate, p50/p95/p99 and last-success freshness. They are locally configured but no hosted dashboard, alert receiver, external monitor, status page or support integration is deployed. No OpenTelemetry exporter or cross-service span graph is claimed.

Operators must never log API keys, wallet signatures, state file contents or internal stack traces to users. Incidents should preserve Request ID, build commit, health response, metrics window, deployment identity and redacted logs. The public UI already renders unavailable states rather than internal errors.
