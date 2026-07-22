# Observability

## Implemented local signals

- JSON structured daemon logs through `slog`.
- `X-Request-ID` validation/generation and response propagation.
- W3C `traceparent` parsing; valid incoming trace IDs are continued with a new span ID, while invalid or zero identifiers are replaced.
- Every request log includes request ID, trace ID, span ID, method, path, status, and duration.
- Public failures include a random error ID and never expose cryptographic details, credentials, stack traces, or state paths.
- `/health` reports product/schema/policy versions, active versus required source count, source limitation, emergency pause, pause reason, audit ID, and observation time.
- `/version` reports product, release, schema, policy, and source commit build field.
- Prometheus text metrics are served only by a separate loopback listener. `/metrics` is absent from the public mux.

## Metrics

| Metric | Meaning |
|---|---|
| `ynx_oracle_http_requests_total` | Completed public API requests |
| `ynx_oracle_http_request_errors_total` | Responses with status 400 or greater |
| `ynx_oracle_ingest_accepted_total` | Signed observations accepted or idempotently acknowledged |
| `ynx_oracle_ingest_rejected_total` | Schema, identity, signature, replay, rate, or persistence rejections |
| `ynx_oracle_price_good_total` | Safe price responses |
| `ynx_oracle_price_unsafe_total` | Unavailable, stale, limited, divergent, paused, or invalid price responses |
| `ynx_oracle_replay_requests_total` | Historical replay requests |
| `ynx_oracle_http_request_duration_milliseconds_bucket` | Cumulative request duration buckets from 1 ms through 5 s and `+Inf` |

Metrics contain no market symbol, account, provider credential, source URL, or unbounded user-controlled label.

## Required alert policy

The following alerts are defined for Monitor integration but require measured capacity baselines before final thresholds are approved:

- No safe price for a governed settlement market
- Any emergency pause
- Active source count below policy minimum
- Stale or future-dated observation rejection rate above baseline
- Divergence circuit breaker
- Reporter replay/signature/hash rejection
- Provider rate limiting or outage
- Aggregate persistence failure or store integrity failure
- Error-rate and p95/p99 latency SLO burn
- Backup age, restore failure, or event-chain mismatch
- Provider registry, key, weight, license, or policy version change

## Dashboard and status integration

The SLO dashboard must show provider count, market/type coverage, updates per second, safe/stale/unavailable rates, divergence, confidence, coverage, request latency, historical query latency, storage growth, failover, and last successful backup/restore drill. The public status page must report service impact and source limitations without exposing provider credentials or security-response details.

No hosted dashboard, Monitor alert, or public status integration is currently claimed. `integratedCentral`, `deployedStaging`, and `deployedPublic` remain false.
