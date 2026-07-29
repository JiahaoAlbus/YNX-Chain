# YNX Music observability

Runtime source commit: `22653153c62529f782f44b0a35177b531ae7e8af`

## Implemented evidence

- `GET /health` verifies persisted-state integrity before returning healthy.
- Health output identifies `ynx-musicd`, product ID, persistence class, media engine, Wallet boundary and normalized build information.
- Health truth explicitly keeps `centralIntegrated`, `licensedPublicCatalog` and `productionStreaming` false.
- Domain mutations append actor, event type, object ID, timestamp, payload hash, previous hash and event hash.
- HTTP rate limits bound each remote address to 120 requests per minute.
- UI surfaces include loading, offline, retry, upload failure, download progress/failure and authentication rejection states.

## Missing production gates

- Structured request logs with request ID, route template, status, latency, account pseudonym and central dependency status.
- Stable error IDs returned to clients without stack traces or paths.
- Metrics for request count/latency/error, playback Range traffic, upload bytes, media validation failures, queue depth, state-save latency, AI units and central dependency latency.
- Distributed traces across Wallet, Pay, Trust, AI and Data Fabric.
- Separate liveness and readiness endpoints; readiness must fail when required central dependencies or durable storage are unavailable.
- SLO dashboard, burn-rate alerts, storage growth alert, central outage alert and artifact/version drift alert.
- Monitor owner integration and public status-page evidence.
- Tested incident, support, refund/dispute and recovery workflows with exact error/audit IDs.

## Proposed identifiers

- `X-Request-ID`: generated or validated at ingress, returned on every API response.
- `errorId`: opaque identifier for an individual failure instance.
- `auditId`: hash-chain event identifier for a persisted mutation.
- `traceparent`: accepted and propagated under the central tracing policy.

Identifiers must never contain a private key, session binding, full device key, provider secret, local path or raw listener history.

## Proposed minimum metrics

| Metric | Type | Required labels |
| --- | --- | --- |
| `ynx_music_http_requests_total` | Counter | route, method, status_class |
| `ynx_music_http_duration_seconds` | Histogram | route, method |
| `ynx_music_state_save_duration_seconds` | Histogram | result |
| `ynx_music_state_integrity_failures_total` | Counter | stage |
| `ynx_music_media_range_bytes_total` | Counter | result |
| `ynx_music_upload_bytes_total` | Counter | mime, result |
| `ynx_music_central_requests_total` | Counter | dependency, operation, result |
| `ynx_music_central_duration_seconds` | Histogram | dependency, operation |
| `ynx_music_ai_units_total` | Counter | provider, model, result |
| `ynx_music_open_cases` | Gauge | kind, status |
| `ynx_music_review_settlements` | Gauge | status |

Account, track and case identifiers must not be unbounded metric labels.

## Alert candidates

- State integrity failure: immediate page.
- Durable save error rate above zero for five minutes: immediate page.
- Wallet introspection error rate above 5% for ten minutes: page and fail closed.
- Media 5xx rate above 2% for ten minutes: page.
- Storage free space below 20% or projected exhaustion below seven days: page.
- Version or source-commit mismatch between runtime, artifact and release record: release block.

Until these are implemented and accepted by YNX Monitor and Security/SRE, observability remains partial.
