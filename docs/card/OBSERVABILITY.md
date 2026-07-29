# YNX Card Observability

Source commit: `d79872f5df4da0566e11ef40e5314ea68d9846f4`  
Schema: `ynx.card.observability.v1`

## Implemented local signals

### Correlation headers

Every HTTP request receives bounded correlation identifiers:

- `X-Request-ID`: accepts only `req_` plus 16–64 lowercase hexadecimal characters; invalid input is replaced.
- `X-Trace-ID`: a 32-character lowercase hexadecimal trace ID, propagated from a valid W3C `traceparent` or generated locally.
- `X-Audit-ID`: returned when a successful mutation appends an audit event.
- `X-Error-ID`: generated for error responses.
- `X-YNX-Error-Code`: stable Card error code for operator and client correlation.

Provider and AI outbound contexts use the current trace through a generated W3C `traceparent`. Correlation identifiers are operational metadata and are removed from account exports; account deletion pseudonymizes matching persisted audit entries and removes request/trace IDs.

### Structured logs

The service emits newline-delimited JSON when a log writer is configured. The request event includes:

- UTC RFC3339-nanosecond timestamp;
- severity (`info` or `error` for HTTP 5xx);
- service and event name;
- request and trace IDs;
- normalized HTTP method;
- canonical route template rather than raw path;
- response status, duration in microseconds and response bytes;
- audit ID when a mutation succeeded;
- error ID and stable error code when an error response was produced.

Issuer availability changes produce `issuer_availability_changed` events with availability state and current request/trace IDs. Logs do not intentionally include account IDs, merchant names, provider Card IDs, request bodies, PAN, CVV, PIN, credentials or signing material.

### Prometheus text metrics

`GET /metrics` exposes bounded labels only:

- `ynx_card_http_requests_total{method,route,status}`
- `ynx_card_http_request_duration_seconds_sum{method,route,status}`
- `ynx_card_http_request_duration_seconds_count{method,route,status}`
- `ynx_card_http_response_bytes_total{method,route,status}`
- `ynx_card_issuer_state_known`
- `ynx_card_issuer_available`
- `ynx_card_issuer_state_transitions_total{state}`

Method values are from a fixed allowlist, unknown values become `OTHER`, and routes use registered route templates or `unmatched`. Account, Card, merchant, event, provider and correlation IDs are not metric labels.

### Health surfaces

- `/health`: process and configured issuer health, without claiming readiness.
- `/ready`: fails closed when the issuer adapter is unavailable.
- `/version`: build identity and schema versions, including data-lifecycle and retention disclosures.

## Initial alert contract for owner 13 / owner 30

The following alerts are proposed, not deployed:

| Alert | Condition | Initial severity | Required evidence before production |
|---|---|---:|---|
| CardIssuerUnavailable | `ynx_card_issuer_state_known == 1` and `ynx_card_issuer_available == 0` for 5 minutes | Critical | Staging scrape, paging route and runbook drill |
| CardIssuerFlapping | More than 4 issuer transitions in 15 minutes | High | Baseline and false-positive review |
| CardServerErrorRatio | HTTP 5xx / all requests above 1% for 10 minutes, minimum 50 requests | High | Histogram or recording rules and traffic baseline |
| CardUnauthorizedSpike | HTTP 401 rate exceeds established baseline | Medium | Central Gateway deployment and abuse baseline |
| CardDeleteFailure | Any failed `DELETE /v1/account/data` request | High | Dedicated metric or structured-log rule and privacy incident routing |
| CardRetentionStale | No successful retention audit within the scheduled interval | Medium | Scheduled retention runner and last-success metric |
| CardBackupStale | No verified encrypted off-host backup within approved RPO | Critical | Off-host backup job and immutable success evidence |

## Privacy and cardinality requirements

- Never place account, Card, merchant, provider, event, dispute, request, trace or error IDs in metric labels.
- Never log request or response bodies on Card routes.
- Never export PAN-like values, secrets, assertion signatures or provider webhook signatures.
- Central log retention must be no longer than the approved privacy schedule and must support coordinated deletion where legally required.
- Public dashboards must aggregate and redact; raw operational logs are not public evidence.

## Verification status

Observability unit and route tests are part of `go test ./internal/cardproduct/...` and the race suite. Local structured logging, correlation propagation, stable error/audit headers and bounded metric rendering are implemented and tested. Prometheus scraping, centralized log ingestion, alert delivery, tracing backend integration, SLO dashboards and incident paging are not deployed or evidenced.
