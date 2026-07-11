# Pay Merchant API

The deployable merchant boundary is `cmd/ynx-payd`, implemented by `internal/paygateway`. It authenticates merchant requests, injects the configured merchant identity, requires mutation idempotency keys, manages webhook signing through an environment-only key, rate limits clients, rejects oversized bodies, assigns request IDs, and stores redacted JSONL access audit records.

Canonical payment intents, invoices, refunds, webhook signature metadata, and Pay events remain persisted by `ynx-chaind`. In deployed configuration, a dedicated upstream key prevents clients from bypassing `ynx-payd` through the general chain API.

Run `make pay-api-check` for the local real-process verification. This is local verification only until the Pay public endpoint passes remote smoke and current-release identity checks.
