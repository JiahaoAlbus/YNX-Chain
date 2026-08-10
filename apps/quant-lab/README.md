# YNX Quant Lab — Paper & Testnet Preview

Run locally:

```sh
YNX_QUANT_EXCHANGE_URL=http://127.0.0.1:6442 \
YNX_QUANT_STATE_PATH=.ynx/quant-lab/state.json \
go run ./apps/quant-lab/server
```

The configured Exchange must expose `/api/v1/market-data/trades` when the Exchange server is used with its `/api` prefix, so set `YNX_QUANT_EXCHANGE_URL=http://127.0.0.1:6442/api` for the combined Exchange Web server. The tape contains actual YNX-owned venue matches only. Fewer than 20 actual trades makes backtest unavailable; no prices are synthesized.

Writes are loopback-only in this local preview and require the UI's `X-YNX-Preview-Mode: local-paper` boundary. A public staging deployment must replace this local boundary with canonical Central Gateway session authorization; it must not expose the local write mode remotely.

Configuration:

- `YNX_QUANT_HTTP_ADDR` — listener, default `127.0.0.1:6444`.
- `YNX_QUANT_STATE_PATH` — integrity-protected persistent state.
- `YNX_QUANT_EXCHANGE_URL` — Exchange API base for actual matched trades.

When `YNX_QUANT_EXCHANGE_URL` is configured, the shipped server also injects the stateless Exchange execution adapter. Each mandate registration and order submission must carry that user's own short-lived, Wallet-authenticated Exchange session in `X-YNX-Exchange-Session`; tokens are never accepted as persisted mandate/order fields, persisted, or shared between users. The mandate uses the exact `ynx-quant-execution-adapter-v1` payload and binds the strategy through `quant:<strategyHash>`. Every order requires a separate signature over the exact Exchange order payload. Missing Exchange configuration, session authorization, signatures, or authoritative response fails closed.

The Testnet page previews both exact signing payloads and accepts the resulting Wallet signatures. The current central product registry still marks Quant Lab pending/disabled, so this is locally verified source capability—not a claim that the public deployment or central Wallet handoff is enabled. Real-money execution has no adapter or route.
