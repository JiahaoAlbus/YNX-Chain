# YNX Pay observability

## Required telemetry

Structured logs must include UTC timestamp, service/version, environment, request ID, trace ID, route template, status, latency, error ID and—when applicable—a non-secret audit ID. Never log credentials, Gateway signatures, session tokens, webhook secrets, private keys, full request bodies or internal stack traces to clients.

Metrics cover request count/latency/errors, Gateway rejection reason, settlement verification outcome, chain/provider latency, invoice state transitions, webhook queue/attempt/dead-letter count, AI provider status/units, store bytes, backup age and restore result. Traces separate Gateway, product, authoritative Pay API, RPC/indexer and webhook-provider spans.

## Health and version

Liveness proves only that the process can answer. Readiness must verify the store and mandatory upstream configuration without creating a transaction. Deep health is authenticated and reports each dependency with `source`, `asOf`, `version`, status and failure reason. A healthy process must not imply a healthy chain or provider.

## Alerts

Alert on sustained server-error rate, settlement verification failure, no committed-payment observations during known traffic, webhook dead-letter growth, backup age, restore failure, integrity failure, Gateway replay spikes, provider outage and SLO burn. Alerts link to the incident runbook and status-page component.

## Current evidence

Local tests verify audit persistence and fail-closed protocol behavior. No deployed metrics endpoint, trace backend, dashboard, monitor integration, alert delivery or public status component has been directly verified for this source version.

