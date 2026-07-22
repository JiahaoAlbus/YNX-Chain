# Economics Observability

`/api/economics/disclosure` accepts a valid `X-Request-ID` or generates one, returns it in the header and JSON, and publishes source commit, source, as-of, version, coverage, confidence and failure state. `/api/economics/health` is an independent process-local reference-model health boundary and includes build identity. It does not claim RPC, indexer, public ingress or third-party health.

Prometheus output on `/metrics` includes:

- `ynx_explorer_economics_disclosure_requests_total`
- `ynx_explorer_economics_disclosure_errors_total`
- `ynx_explorer_economics_disclosure_latency_seconds` histogram at 1, 5, 10, 50, 100 and 500 ms plus infinity

The local implementation has request correlation, metrics, health and build version. Distributed traces, Error IDs distinct from Request IDs, a hosted dashboard, alert receiver, external monitor, status page and support integration are not implemented or deployed. Proposed alert thresholds are in `SLO_CAPACITY_PLAN.md`; they are not active alerts.

Operators must never log API keys, wallet signatures, state file contents or internal stack traces to users. Incidents should preserve Request ID, build commit, health response, metrics window, deployment identity and redacted logs. The public UI already renders unavailable states rather than internal errors.
