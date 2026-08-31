# Exchange market-data SSE read handoff

Status: source-tested only. This document is not a public-runtime, Wallet, order, or trade-execution claim.

## Endpoint

`GET /v1/market-data/stream` is a product-owned Server-Sent Events endpoint for the owned Testnet market. It emits:

- an immediate `snapshot` event with the durable order book and matched trades;
- `reconciled` only after the persisted state fingerprint changes; and
- comment keepalives while the durable state is unchanged.

Every model includes `SourceMetadata` with the authority, Testnet classification, truthful `live` or `degraded_single_host` status, coverage, backend, and multi-instance flag. The endpoint does not synthesize price, volume, liquidity, or trades.

## Reconnect and concurrency boundary

The stream reloads the durable store before every snapshot instead of holding the ordinary request serializer for the lifetime of a connection. Subscribers therefore do not block Exchange REST requests or each other. File snapshots are transparently marked `degraded_single_host`; a PostgreSQL store is still required for deployable multi-instance readiness.

The SSE event identifier uses the persisted revision plus integrity fingerprint so that a file-snapshot state change is not missed when its numeric revision remains zero. The fingerprint is used only for event identity; it does not grant an action capability.

## Safety and evidence

The endpoint is read-only: it does not call Wallet, authenticate an account, place/cancel an order, mint test credit, or broadcast a chain transfer. On a durable-state failure it emits a retryable `FIN_SOURCE_UNAVAILABLE` stream event and closes, allowing a client to reconnect without replaying a prior write.

`go test ./internal/exchangeproduct ./apps/exchange/server ./cmd/ynx-exchange-seed-testnet` covers the initial truthful snapshot, persisted-state reconciliation, and disconnect closure. Public deployment, client reconnection evidence, Wallet approval, orders, matching, settlement, downloads, and installed runtime evidence remain unproven.
