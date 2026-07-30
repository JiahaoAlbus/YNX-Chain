# Observability

All services emit structured logs, RED metrics, traces, and health/readiness/version responses. Correlation fields are `requestId`, `traceId`, `errorId`, and, for privileged operations, `auditId`. Logs must never contain credentials, authorization headers, user seed material, private keys, raw payment data, internal stack traces in public responses, or unrestricted personal data.

Alerts cover availability, latency, error budget, queue age, saturation, certificate expiry, credential expiry, failed authorization, replay, artifact verification, backup age, restore failure, replication lag, WAF/DDoS events, cost anomalies, crawler availability, sitemap fetch, redirect loops, noindex drift, canonical drift, spam injection, and internal-data leakage.

Health means process liveness only. Readiness verifies required dependencies without claiming third-party authority. Version responses include source commit and build provenance. Provider failures report provider, observed time, last good time, and failure class; they never return synthetic health.

Dashboard and alert configuration currently present under `infra/monitoring/` is recovered input, not proof that every service is integrated or that alerts reach an operator. Those claims require public probe and alert-delivery evidence.
