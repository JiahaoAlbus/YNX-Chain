# YNX Docs Observability

## Scope and truth boundary

This document describes the local YNX Docs runtime observability contract implemented by YNX 35 at source commit `3c404c4f4d2c9967e660882349a19c94aebd08f1`. It does not claim Monitor ingestion, alert delivery, staging deployment or public availability.

## Runtime endpoints

| Endpoint | Purpose | Authentication | Truth requirement |
|---|---|---|---|
| `GET /health` | Process and bounded runtime status | None | Includes build identity, schema, storage/Trust boundaries and `local-bounded-docs-runtime-not-publicly-deployed` |
| `GET /ready` | Readiness after state load and adapter configuration | None | Reports only initialized local readiness; it does not imply upstream or public readiness |
| `GET /version` | Product, contract, schema and build identity | None | Build fields default to `unknown`/`local` unless injected at build time |
| `GET /metrics` | Prometheus text exposition | None | Uses the `ynx_docs_` namespace and contains no document content, account identifiers or object names |

## Correlation contract

- A syntactically safe `X-Request-ID` is preserved; otherwise a fresh identifier is generated.
- A syntactically safe `X-Trace-ID` is preserved; otherwise it inherits the request identifier.
- HTTP failures include a generated `X-Error-ID`.
- Identifiers are limited to 128 ASCII letters, digits, hyphen, underscore, period or colon.
- Correlation identifiers are operational metadata and must not contain secrets, document content or personal data.

## Structured request log

The runtime emits the `ynx_docs_http_request` structured event with:

- `request_id`
- `trace_id`
- `method`
- `path`
- `status`
- `bytes`
- `duration_ms`

Authorization headers, request bodies, document content, account values and query values are not logged by this middleware.

## Metrics

The current local contract exposes:

- `ynx_docs_http_requests_total`
- `ynx_docs_http_errors_total`
- `ynx_docs_http_in_flight`
- `ynx_docs_http_response_bytes_total`
- `ynx_docs_http_request_duration_seconds_sum`
- `ynx_docs_http_request_duration_seconds_count`
- `ynx_docs_info`

This is a bounded local metric set. Histograms, route/status labels, availability SLOs, alert thresholds and production retention remain pending YNX 13/30 acceptance to avoid cardinality or privacy regressions.

## Build identity

`apps/cloud/cmd/ynx-cloudd` accepts immutable build identity through linker variables:

- `buildCommit`
- `buildRelease`
- `buildTime`

A release pipeline must inject values from the exact source commit and retain provenance. Default local values are deliberately non-production: `unknown`, `local`, `unknown`.

## Verification

The following passed for the source commit:

- `go test ./internal/cloud -count=1`
- `go test -race ./internal/cloud -count=1`
- `go vet ./internal/cloud`
- `go test ./apps/cloud/cmd/ynx-cloudd`
- `TestDocsRuntimeObservabilityEndpointsAndCorrelationIDs`

## Central acceptance required

YNX 13, YNX 29 and YNX 30 must freeze the metric/trace schema, ingest the endpoint output, prove dashboard behavior, execute alert and incident probes, and bind evidence to the exact deployed SHA before `integratedCentral`, `deployedStaging` or `deployedPublic` can become true.
