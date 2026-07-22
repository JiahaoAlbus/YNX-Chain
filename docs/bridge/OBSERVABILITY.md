# Bridge Observability

`GET /health` reports build identity, state integrity, route/relayer counts, coordinator status, pause state, and explicit `liveBridge=false` and `externalSubmissionEnabled=false` boundaries.

`GET /metrics` exports transfer, ready, local-finalization, audit-event, pause, coordinator-outstanding, and external-submission metrics. Metrics contain no API key, relayer private material, addresses, transaction payloads, evidence references, or error text.

Every HTTP response includes a random `X-Request-ID`; error responses include `X-Error-ID` and both IDs in JSON. Structured access logs contain request ID, method, matched route pattern, status, and duration. They omit request/response bodies, credentials, account addresses, transaction hashes, evidence references, query strings, internal file paths, and stack traces. `ynx_bridge_rate_limit_denied_total` and health `rateLimit` expose abuse-control state without disclosing client identities.

`GET /bridge/transparency` exposes source-qualified public accounting. Coordinator exposure is derived from persisted transfer state. External reconciliation is labeled operator-submitted and not independently verified. Alerting must treat pause, route-limit saturation, reconciliation difference, stale reconciliation, persistence failure, and API unavailability as separate conditions.

No remote Prometheus target, alert delivery, dashboard, or public status-page evidence exists for `ynx-bridged` yet.
