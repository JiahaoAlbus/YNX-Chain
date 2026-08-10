# YNX Data Fabric Observability

## Implemented locally

- Structured daemon and HTTP request logs through Go `slog`.
- W3C `traceparent` validation/continuation; invalid context is replaced, trace ID is logged, and a child context is propagated to canonical introspection.
- Request ID echo and bounded logging; no request bodies, session tokens, signatures, key material or payload values are logged.
- Opaque Error ID in API failures.
- Audit IDs in canonical events, journal entries, Saga instances, reconciliation runs and write responses.
- `/healthz` performs the persistent integrity audit and fails with `503` without exposing internal details.
- `/version` exposes service, release and exact source commit.
- `/metrics` exposes requests, errors, events, pending Outbox records, Inbox effects, DLQ records, journal entries, running/recovery Sagas, reconciliation runs and erasure requests.
- `/metrics` also exposes the oldest eligible Outbox timestamp, reconciliation exceptions and pseudonymous analytics fact count.
- `/metrics` includes cumulative request-duration histogram buckets, count and sum.
- `infra/data-fabric/prometheus-rules.yml` defines integrity-health, DLQ, stalled-Outbox, Saga-recovery, reconciliation and elevated-error alerts.
- `infra/data-fabric/grafana-dashboard.json` defines a source-only integrity and recovery dashboard without invented values or endpoints.

## Required alert conditions

- Health integrity failure: page immediately and remove writes.
- Any DLQ record: page the owning product and Data Fabric operator.
- Outbox age above the tested SLO: page; do not report cross-product completion.
- Saga deadline or manual recovery: notify product support and show a user-visible recovery state.
- Reconciliation mismatch or unavailable required source: open a case; block settlement finality where policy requires.
- Ledger verification failure: stop all ledger writes and settlement claims.
- Canonical introspection outage or denial spike: alert Gateway/Auth owners; remain fail closed.

## Deployment boundary

The alert and dashboard definitions are locally validated source, not deployed monitor evidence. Trace context and latency histograms exist, but distributed trace export/storage, per-route exemplars, Alertmanager routing, log shipping/retention, public status page, on-call integration and live monitor receipts remain incomplete. Internal stack traces and filesystem paths must remain outside API responses when those integrations are added.
