# Observability

Current evidence: `/health` reports service, Testnet network, asset, fee and settlement authority; mutations append integrity-protected audit entries; webhook attempts preserve HTTP status and retry state.

Required before staging SLO claims:

- Structured JSON logs with request ID, error ID, audit ID, route template, status, duration and redacted principal.
- OpenTelemetry traces across Gateway, Merchant service, Pay, Trust and provider adapters.
- Metrics for requests, latency, auth rejection reason, session expiry/revoke, invoices, settlement outcome, webhook queue/attempts, reconciliation lag, provider rate limits and store growth.
- Alerts tied to error budget, queue age, provider outage, integrity failure and backup age.
- Versioned health/readiness endpoints, SLO dashboard, status page and incident/runbook links.

Never log bearer tokens, Gateway signatures, webhook secrets, merchant HMAC, private keys, request bodies containing secrets, local paths or provider credentials. UI errors must use supportable error IDs and never expose stack traces.
