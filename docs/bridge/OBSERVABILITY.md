# Bridge Observability

`GET /health` reports build identity, state integrity, route/relayer counts, coordinator status, pause state, and explicit `liveBridge=false` and `externalSubmissionEnabled=false` boundaries.

`GET /metrics` exports transfer, ready, local-finalization, audit-event, pause, aggregate and per-route coordinator exposure, per-route exposure caps, reconciliation balance/timestamps, rate-limit rejection, and external-submission metrics. Route labels are bounded deployment policy identifiers. Metrics contain no API key, relayer private material, user addresses, transaction payloads, evidence references, or error text.

Every HTTP response includes a random `X-Request-ID`; error responses include `X-Error-ID` and both IDs in JSON. The server accepts a valid W3C `traceparent`, preserves its trace ID, creates a new server span ID, and returns both `traceparent` and `X-Trace-ID`. Invalid or all-zero contexts are discarded and replaced. Structured access logs contain request ID, trace ID, method, matched route pattern, status, and duration. They omit request/response bodies, credentials, account addresses, transaction hashes, evidence references, query strings, internal file paths, and stack traces. `ynx_bridge_rate_limit_denied_total` and health `rateLimit` expose abuse-control state without disclosing client identities.

`GET /bridge/transparency` exposes source-qualified public accounting. Coordinator exposure is derived from persisted transfer state. External reconciliation is labeled operator-submitted and not independently verified. Loadable Prometheus rules in `infra/monitoring/ynx-bridge-alerts.yml` independently alert on availability, fail-closed boundary changes, pause duration, route-limit saturation, reconciliation imbalance/age, and rate-limit abuse. The importable `infra/monitoring/grafana-bridge-dashboard.json` covers those safety and lifecycle signals without user or transaction labels. Alert delivery and dashboard installation are deployment-owned and are not implied by these local definitions.

`GET /bridge/status` is the local product-readiness summary. It separates process availability, pause state, open exposure count, and operator reconciliation from external provider, contract, execution, public deployment, support, refund, and emergency-exit readiness. It is not an independently hosted public status page.

No remote Prometheus target, alert delivery, installed/rendered dashboard, or public status-page evidence exists for `ynx-bridged` yet.
