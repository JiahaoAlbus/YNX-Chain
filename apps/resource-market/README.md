# YNX Resource Market

Standalone capacity product for balances, staking evidence, delegation, rental, sponsored pools, fee quotes, income history, policy, expiry, revocation and disputes.

```sh
YNX_RESOURCE_MARKET_DEV_HEADER_AUTH=1 go run ./apps/resource-market
```

The store defaults to `tmp/resource-market/state.json`. Trusted headers are disabled by default and require the explicit development flag above. Production access completes the canonical Wallet authorization at `POST /api/auth/session/complete`; sessions are exact product/device/scope bound and legacy local challenge endpoints return `410`.

Configure the central HTTPS Gateway with `YNX_CENTRAL_GATEWAY_URL` and the registered client ID through `YNX_RESOURCE_MARKET_CLIENT_ID`. Until the registry and authority routes are merged and deployed, quotes and signed intents fail closed. Sponsorship moves bounded capacity only. A quote, signed intent, or authority acceptance is never reported as asset settlement without separate authoritative evidence. Recovery operators can inspect or restore the atomic `.bak` store with `go run ./apps/resource-market/cmd/recover`.
