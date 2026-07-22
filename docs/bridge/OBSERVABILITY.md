# Bridge Observability

`GET /health` reports build identity, state integrity, route/relayer counts, coordinator status, pause state, and explicit `liveBridge=false` and `externalSubmissionEnabled=false` boundaries.

`GET /metrics` exports transfer, ready, local-finalization, audit-event, pause, coordinator-outstanding, and external-submission metrics. Metrics contain no API key, relayer private material, addresses, transaction payloads, evidence references, or error text.

`GET /bridge/transparency` exposes source-qualified public accounting. Coordinator exposure is derived from persisted transfer state. External reconciliation is labeled operator-submitted and not independently verified. Alerting must treat pause, route-limit saturation, reconciliation difference, stale reconciliation, persistence failure, and API unavailability as separate conditions.

No remote Prometheus target, alert delivery, dashboard, or public status-page evidence exists for `ynx-bridged` yet.
