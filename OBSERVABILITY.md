# YNX Shop Observability

Updated: 2026-07-29

Current implementation source: `a9f9ff932ede1091882509a219755b4b18a88c92`

Metrics implementation source: `14984342ebf49f0b9a1f5ec516b1aef99c6e8879`

## Runtime endpoints

- `GET /health` returns the exact build version and commit, process start time, persistence/integrity state, and explicit availability for Wallet Gateway, Pay, Trust, and AI.
- `GET /version` returns the exact service build identity.
- `GET /metrics` returns Prometheus text exposition for Shop-owned runtime and persistence state.

The metrics endpoint is implemented and locally tested. It is not currently deployed on Staging or a public Shop runtime.

## Metric families

### HTTP runtime

- `ynx_shop_build_info{version,commit}`
- `ynx_shop_uptime_seconds`
- `ynx_shop_http_in_flight`
- `ynx_shop_http_requests_total{method,route_group,status_class}`
- `ynx_shop_http_request_duration_seconds{route_group}`

Route labels are selected from a fixed set such as `api_products`, `api_orders`, `api_privacy`, `api_seller`, `api_ai`, `shop_assets`, and `not_found`. Raw paths, account addresses, order IDs, product IDs, tokens, remote addresses, query strings, and request bodies are never labels.

### Commerce state

- `ynx_shop_persistence_schema_version`
- `ynx_shop_state_stores`
- `ynx_shop_state_products`
- `ynx_shop_state_published_products`
- `ynx_shop_state_variants`
- `ynx_shop_state_inventory_units`
- `ynx_shop_state_reserved_units`
- `ynx_shop_state_orders`
- `ynx_shop_state_orders_by_status{status}`
- `ynx_shop_state_buyer_profiles`
- `ynx_shop_state_carts`
- `ynx_shop_state_ai_jobs`
- `ynx_shop_state_audit_events`
- `ynx_shop_state_idempotency_records`
- `ynx_shop_state_active_rate_windows`

Order status is a bounded state-machine value. The endpoint does not export buyer identity, delivery address, product content, settlement transaction data, Trust case details, AI prompts, or audit-event text.

### Dependency boundaries

`ynx_shop_provider_available{provider}` exposes only binary availability for:

- `wallet_gateway`
- `pay`
- `trust`
- `ai`

A value of `1` means the required configuration is present according to the Shop boundary. It does not prove provider health, transaction success, production approval, or public availability.

## Proposed SLO alert inputs

The following alerts are release-candidate recommendations, not claims about a deployed monitoring stack:

1. Availability: 5xx ratio above 1% for five minutes, excluding intentional dependency-unavailable 503s from a separate dependency alert.
2. Latency: public catalog p95 above 250 ms for ten minutes after current-source Staging exists.
3. Dependency: Wallet Gateway or Pay availability is `0` on an environment configured to execute authenticated checkout.
4. Persistence: schema version differs from `2`, integrity protection is false in a non-local environment, or process restart loses state digest continuity.
5. Inventory: reserved units exceed inventory units, or a negative reservation is observed. Current code prevents these states; the alert is defense in depth.
6. Order workflow: sustained growth in `payment_pending`, `refund_requested`, or `disputed` beyond operator-defined age thresholds.

## Collection and exposure policy

- Keep the Shop daemon on loopback or a private service network.
- Expose `/metrics` only to the approved monitoring path; do not place it behind the public buyer route by default.
- Apply network authentication or mTLS at the ingress/collector layer.
- Scrape no more frequently than operationally required; 15–30 seconds is a reasonable starting range for Staging.
- Retain aggregate metrics according to the Security/SRE policy. Do not derive user tracking or buyer profiles from observability data.
- Do not log bearer tokens, service keys, HMAC keys, Wallet signatures, payment evidence bodies, addresses, or AI prompt content.

## Verification

Passed on Apple M2 / darwin arm64:

- `go test ./internal/commerce/...`
- `go test -race ./internal/commerce/... -count=1`
- `TestPrometheusMetricsExposeBoundedRuntimeAndState`
- `TestHealthReportsExactRuntimeAndDependencyBoundaries`
- `TestObservePreservesFlushCapability`
- `TestShopConcurrentReadLoadBaseline`
- `make no-placeholder-check`
- `make secret-scan`

The race run emitted a non-fatal macOS linker warning about `LC_DYSYMTAB`; the test process completed successfully.
