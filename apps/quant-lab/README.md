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

Testnet order submission additionally requires injected `MandateVerifier` and `TestnetBroker` implementations. The shipped server injects neither and therefore fails closed. Real-money execution has no adapter or route.
