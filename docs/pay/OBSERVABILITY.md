# YNX Pay observability

## Required telemetry

Structured logs must include UTC timestamp, service/version, environment, request ID, trace ID, route template, status, latency, error ID and—when applicable—a non-secret audit ID. Never log credentials, Gateway signatures, session tokens, webhook secrets, private keys, full request bodies or internal stack traces to clients.

Metrics cover request count/latency/errors, Gateway rejection reason, settlement verification outcome, chain/provider latency, invoice state transitions, webhook queue/attempt/dead-letter count, AI provider status/units, store bytes, backup age and restore result. Traces separate Gateway, product, authoritative Pay API, RPC/indexer and webhook-provider spans.

## Health and version

Liveness proves only that the process can answer. Readiness must verify the store and mandatory upstream configuration without creating a transaction. Deep health is authenticated and reports each dependency with `source`, `asOf`, `version`, status and failure reason. A healthy process must not imply a healthy chain or provider.

## Alerts

Alert on sustained server-error rate, settlement verification failure, no committed-payment observations during known traffic, webhook dead-letter growth, backup age, restore failure, integrity failure, Gateway replay spikes, provider outage and SLO burn. Alerts link to the incident runbook and status-page component.

## Current evidence

The source now implements dependency-aware liveness/readiness, version metadata, bounded Prometheus metrics, structured JSON completion logs, request/trace/error correlation, `traceparent` propagation and panic redaction. Local and Race tests verify healthy/degraded dependency states, route-template cardinality, correlation propagation, private-value redaction and bounded client errors.

No deployed trace backend, dashboard, Monitor integration, alert delivery or public status component has been directly verified for this source version.
