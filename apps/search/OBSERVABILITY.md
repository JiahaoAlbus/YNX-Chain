# YNX Search observability

Status: implemented locally; staging and public verification remain pending.

## Correlation contract

Every HTTP response carries:

- `x-request-id`: a bounded caller-supplied identifier when valid, otherwise a generated UUID.
- `x-trace-id`: the W3C `traceparent` trace ID when valid, otherwise a generated 128-bit identifier.
- `x-error-id`: generated only for bounded error responses and repeated in the JSON response body as `errorId`.

The service does not expose stack traces, local paths, process details, source authorization references, or provider credentials in error responses.

## Structured logs

`request-completed` records contain:

- timestamp, level and service;
- request, trace and optional error identifiers;
- HTTP method;
- normalized route template;
- status code;
- elapsed milliseconds.

`request-error` records contain the same identifiers plus the error class and retryable classification. They deliberately exclude query strings, request bodies, client IP addresses, error messages, source snippets, Wallet data and authorization evidence.

`YNX_SEARCH_STRUCTURED_LOGS=off` is permitted only for bounded local verification utilities that would otherwise emit high-volume request logs. Runtime deployments must leave structured logging enabled.

## Metrics

`GET /api/metrics` exposes Prometheus text only when an operator configures `YNX_SEARCH_METRICS_TOKEN` and supplies the matching bearer authorization. The endpoint returns `503` when it is not configured and `401` when authorization is wrong.

Metrics currently include:

- `ynx_search_requests_total` by method, normalized route and status;
- `ynx_search_request_duration_milliseconds_sum`;
- `ynx_search_request_duration_milliseconds_max`;
- `ynx_search_server_errors_total`;
- `ynx_search_process_uptime_seconds`.

Metric labels never contain query strings, source URLs, case reasons, document titles or user identifiers.

## Health and status

`GET /api/health` reports the availability of Request IDs, Trace IDs, Error IDs, structured logs and the protected metrics endpoint. This health response describes only the running Search service; it does not claim external provider, Wallet, Trust, staging, public or production availability.

## Monitor handoff

The Monitor owner should scrape `/api/metrics` through a private authenticated path and alert on:

1. five-minute server error rate above 1%;
2. sustained p95 latency above the accepted staging SLO;
3. process restarts or missing scrapes;
4. source indexing failures and backoff states from `/api/index/status`;
5. stale deployed commit compared with the accepted release record.

Central Monitor acceptance and public status-page integration are not yet proven.
